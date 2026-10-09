-- Stage 2 backend contract only. No new card data columns or historical backfill.
begin;

create function public.claim_gift_payment_attempt_method_core(
  p_contribution_id uuid,
  p_provider_idempotency_key uuid,
  p_lease_seconds integer, p_payment_method text, p_installments numeric, p_method_id text
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
  if not found or contribution.payment_status <> 'pending'
     or contribution.payment_environment is null then
    raise exception 'contribution_not_payable';
  end if;

  if contribution.payment_method is distinct from p_payment_method then
    raise exception 'payment_attempt_method_mismatch';
  end if;

  select * into gift from public.gifts where public.gifts.id = contribution.gift_id for update;
  if not found or not gift.active then raise exception 'gift_unavailable'; end if;

  select * into attempt from public.payment_attempts
  where public.payment_attempts.contribution_id = contribution.id for update;

  if found then
    if attempt.payment_environment is distinct from contribution.payment_environment then
      raise exception 'payment_environment_mismatch';
    end if;
    if attempt.payment_method is distinct from p_payment_method
       or attempt.installments is distinct from p_installments
       or attempt.provider_payment_method_id is distinct from p_method_id then
      raise exception 'payment_attempt_method_mismatch';
    end if;
    if attempt.provider_order_id is null
       and (attempt.creation_lease_until is null or attempt.creation_lease_until <= now()) then
      update public.payment_attempts
      set creation_lease_until = now() + make_interval(secs => p_lease_seconds)
      where public.payment_attempts.id = attempt.id returning * into attempt;
      claim := true;
    end if;
  else
    if contribution.payment_environment = 'production' and exists (
      select 1 from public.gift_contributions gc where gc.gift_id = gift.id
        and gc.payment_environment is null and gc.payment_status in ('pending','confirmed')
    ) then raise exception 'legacy_financial_hold'; end if;
    if not gift.allow_multiple and (
      exists (
        select 1 from public.gift_contributions gc
        where gc.gift_id=gift.id and gc.id<>contribution.id and gc.payment_status='confirmed'
          and gc.payment_environment = contribution.payment_environment
      ) or exists (
        select 1 from public.payment_attempts pa
        join public.gift_contributions gc on gc.id=pa.contribution_id
        where gc.gift_id=gift.id and gc.id<>contribution.id and gc.payment_status='pending'
          and gc.payment_environment = contribution.payment_environment
          and pa.confirmed_at is null and pa.expires_at>now()
          and pa.provider_status in ('creating','created','processing','action_required')
      )
    ) then
      raise exception 'gift_already_reserved';
    end if;

    if gift.funding_mode = 'goal' then
      select coalesce(sum(gc.amount),0) into committed
      from public.gift_contributions gc
      where gc.gift_id = gift.id and gc.payment_status = 'confirmed'
        and gc.payment_environment = contribution.payment_environment;

      if committed >= gift.target_amount then
        raise exception 'gift_goal_reached';
      end if;
    end if;

    insert into public.payment_attempts(
      contribution_id,payment_environment,provider_idempotency_key,external_reference,amount,expires_at,creation_lease_until,
      payment_method,installments,provider_payment_method_id
    ) values (
      contribution.id,contribution.payment_environment,p_provider_idempotency_key,'gift-contribution-' || contribution.id::text,
      contribution.amount,contribution.expires_at,now() + make_interval(secs => p_lease_seconds),
      p_payment_method,p_installments,p_method_id
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
revoke all on function public.claim_gift_payment_attempt_method_core(uuid,uuid,integer,text,numeric,text)
  from public, anon, authenticated, service_role;

create or replace function public.claim_gift_payment_attempt_before_expiry_guard(
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
declare method text; installments numeric; method_id text;
begin
  select gc.payment_method, pa.installments, pa.provider_payment_method_id
    into method, installments, method_id from public.gift_contributions gc
    left join public.payment_attempts pa on pa.contribution_id=gc.id where gc.id=p_contribution_id;
  if method='pix' then method_id := 'pix'; end if;
  if method='credit_card' and (installments is null or method_id is null) then
    raise exception 'payment_attempt_method_mismatch';
  end if;
  return query select * from public.claim_gift_payment_attempt_method_core(
    p_contribution_id,p_provider_idempotency_key,p_lease_seconds,method,installments,method_id);
end $$;
revoke all on function public.claim_gift_payment_attempt_before_expiry_guard(uuid,uuid,integer)
  from public, anon, authenticated, service_role;

create function public.claim_gift_card_payment_attempt(
  p_contribution_id uuid, p_environment text, p_provider_idempotency_key uuid,
  p_installments numeric, p_method_id text, p_lease_seconds integer default 30
) returns table(
  id uuid, contribution_id uuid, provider_idempotency_key uuid,
  external_reference text, provider_order_id text, provider_payment_id text,
  provider_status text, provider_status_detail text, amount numeric,
  expires_at timestamptz, pix_qr_code text, pix_qr_code_base64 text,
  ticket_url text, provider_checked_at timestamptz, can_create boolean,
  order_submission_state text, payment_environment text,
  payment_method text, installments numeric, provider_payment_method_id text
) language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare attempt public.payment_attempts;
declare claimed record;
begin
  if p_environment is null or p_environment not in ('test','production') then
    raise exception 'invalid_payment_environment';
  end if;
  if p_installments is null or p_installments not between 1 and 12
     or p_installments <> trunc(p_installments)
     or p_method_id is null or p_method_id='pix'
     or length(p_method_id) not between 1 and 64
     or p_method_id <> btrim(p_method_id) or p_method_id ~ '[[:cntrl:]]' then
    raise exception 'invalid_card_payment_method';
  end if;
  select * into contribution from public.gift_contributions gc where gc.id=p_contribution_id for update;
  if not found or contribution.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  if contribution.payment_method <> 'credit_card' then
    raise exception 'payment_attempt_method_mismatch';
  end if;
  select * into attempt from public.payment_attempts pa where pa.contribution_id=contribution.id;
  if found then
    if attempt.payment_environment is distinct from p_environment then
      raise exception 'payment_environment_mismatch';
    end if;
    if attempt.payment_method <> 'credit_card' or attempt.installments is distinct from p_installments
       or attempt.provider_payment_method_id is distinct from p_method_id then
      raise exception 'payment_attempt_method_mismatch';
    end if;
  end if;
  if attempt.id is not null or contribution.expires_at <= now() then
    -- Reuse the existing durable expiry/uncertain-submission guard unchanged.
    select * into claimed from public.claim_gift_payment_attempt(
      p_contribution_id,p_provider_idempotency_key,p_lease_seconds);
  else
    select * into claimed from public.claim_gift_payment_attempt_method_core(
      p_contribution_id,p_provider_idempotency_key,p_lease_seconds,'credit_card',p_installments,p_method_id);
  end if;
  if not found then return; end if;
  select * into attempt from public.payment_attempts pa where pa.id=claimed.id;
  return query select claimed.id,claimed.contribution_id,claimed.provider_idempotency_key,
    claimed.external_reference,claimed.provider_order_id,claimed.provider_payment_id,
    claimed.provider_status,claimed.provider_status_detail,claimed.amount,claimed.expires_at,
    claimed.pix_qr_code,claimed.pix_qr_code_base64,claimed.ticket_url,claimed.provider_checked_at,
    claimed.can_create,attempt.order_submission_state,attempt.payment_environment,
    attempt.payment_method,attempt.installments,attempt.provider_payment_method_id;
end $$;
revoke all on function public.claim_gift_card_payment_attempt(uuid,text,uuid,numeric,text,integer)
  from public, anon, authenticated;
grant execute on function public.claim_gift_card_payment_attempt(uuid,text,uuid,numeric,text,integer) to service_role;

commit;
