begin;

-- The historical identity trigger protects all ordinary updates. Temporarily
-- remove it only inside this transaction, with an exclusive table lock.
drop trigger payment_attempt_identity_immutable on public.payment_attempts;

with eligible as (
  select attempt.id, attempt.contribution_id
  from public.payment_attempts as attempt
  join public.gift_contributions as contribution
    on contribution.id = attempt.contribution_id
  where attempt.provider_status = 'creating'
    and attempt.provider_order_id is null
    and attempt.provider_payment_id is null
    and attempt.external_reference = 'gift-contribution:' || attempt.contribution_id::text
    and contribution.external_reference = attempt.external_reference
    and contribution.payment_status = 'pending'
), migrated as (
  update public.payment_attempts as attempt
  set external_reference = 'gift-contribution-' || attempt.contribution_id::text
  from eligible
  where attempt.id = eligible.id
  returning attempt.contribution_id, attempt.external_reference
)
update public.gift_contributions as contribution
set external_reference = migrated.external_reference
from migrated
where contribution.id = migrated.contribution_id;

create trigger payment_attempt_identity_immutable before update on public.payment_attempts
  for each row execute function public.protect_payment_attempt_identity();

-- Keep the existing RPC signature and all admission/idempotency behavior.
-- Only the reference generated for a brand-new attempt changes.
create or replace function public.claim_gift_payment_attempt(
  p_contribution_id uuid,
  p_provider_idempotency_key uuid,
  p_lease_seconds integer default 30
) returns table(
  id uuid,
  contribution_id uuid,
  provider_idempotency_key uuid,
  external_reference text,
  provider_order_id text,
  provider_payment_id text,
  provider_status text,
  provider_status_detail text,
  amount numeric,
  expires_at timestamptz,
  pix_qr_code text,
  pix_qr_code_base64 text,
  ticket_url text,
  provider_checked_at timestamptz,
  can_create boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  contribution public.gift_contributions;
  gift public.gifts;
  attempt public.payment_attempts;
  committed numeric;
  claim boolean := false;
begin
  if p_lease_seconds < 5 or p_lease_seconds > 120 then
    raise exception 'invalid_payment_lease';
  end if;

  select * into contribution from public.gift_contributions
  where public.gift_contributions.id = p_contribution_id for update;
  if not found or contribution.payment_status <> 'pending' then
    raise exception 'contribution_not_payable';
  end if;

  select * into gift from public.gifts where public.gifts.id = contribution.gift_id for update;
  if not found or not gift.active then raise exception 'gift_unavailable'; end if;

  select * into attempt from public.payment_attempts
  where public.payment_attempts.contribution_id = contribution.id for update;

  if found then
    if attempt.provider_order_id is null
       and (attempt.creation_lease_until is null or attempt.creation_lease_until <= now()) then
      update public.payment_attempts
      set creation_lease_until = now() + make_interval(secs => p_lease_seconds)
      where public.payment_attempts.id = attempt.id returning * into attempt;
      claim := true;
    end if;
  else
    if not gift.allow_multiple and (
      exists (
        select 1 from public.gift_contributions gc
        where gc.gift_id=gift.id and gc.id<>contribution.id and gc.payment_status='confirmed'
      ) or exists (
        select 1 from public.payment_attempts pa
        join public.gift_contributions gc on gc.id=pa.contribution_id
        where gc.gift_id=gift.id and gc.id<>contribution.id and gc.payment_status='pending'
          and pa.confirmed_at is null and pa.expires_at>now()
          and pa.provider_status in ('creating','created','processing','action_required')
      )
    ) then
      raise exception 'gift_already_reserved';
    end if;

    if gift.funding_mode = 'goal' then
      select coalesce(sum(gc.amount),0) into committed
      from public.gift_contributions gc
      where gc.gift_id = gift.id and gc.payment_status = 'confirmed';

      if committed >= gift.target_amount then
        raise exception 'gift_goal_reached';
      end if;
    end if;

    insert into public.payment_attempts(
      contribution_id,provider_idempotency_key,external_reference,amount,expires_at,creation_lease_until
    ) values (
      contribution.id,p_provider_idempotency_key,'gift-contribution-' || contribution.id::text,
      contribution.amount,contribution.expires_at,now() + make_interval(secs => p_lease_seconds)
    ) returning * into attempt;

    update public.gift_contributions
    set external_reference = attempt.external_reference
    where public.gift_contributions.id = contribution.id;
    claim := true;
  end if;

  return query select attempt.id,attempt.contribution_id,attempt.provider_idempotency_key,
    attempt.external_reference,attempt.provider_order_id,attempt.provider_payment_id,
    attempt.provider_status,attempt.provider_status_detail,attempt.amount,attempt.expires_at,
    attempt.pix_qr_code,attempt.pix_qr_code_base64,attempt.ticket_url,
    attempt.provider_checked_at,claim;
end $$;

commit;