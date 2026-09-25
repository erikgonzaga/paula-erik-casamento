begin;

alter table public.gift_contributions
  add column contributor_email text;

update public.gift_contributions
set contributor_email = 'legacy-contribution-' || id::text || '@invalid.local'
where contributor_email is null;

alter table public.gift_contributions
  alter column contributor_email set not null,
  alter column contributor_email set default 'legacy@invalid.local',
  alter column expires_at set default (now() + interval '30 minutes'),
  drop constraint contributions_expiry_consistent,
  add constraint contributions_email_valid check (
    length(contributor_email) between 3 and 254
    and contributor_email = lower(btrim(contributor_email))
    and contributor_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  add constraint contributions_expiry_valid check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  );

-- A goal is an opening condition, not a hard financial ceiling. New pending
-- contributions are admitted only while confirmed funds remain below the goal.
-- Contributions already admitted may later confirm in full above the goal.
create or replace function public.validate_gift_contribution() returns trigger
language plpgsql set search_path = '' as $$
declare gift public.gifts; total numeric; confirmed_count bigint;
begin
  if TG_OP = 'UPDATE' and new.gift_id <> old.gift_id then
    raise exception 'contribution_gift_immutable';
  end if;

  update public.gifts set updated_at = now() where id = new.gift_id
    returning * into gift;
  if not found then raise exception 'gift_unavailable'; end if;

  if new.payment_status in ('pending','confirmed') then
    if not gift.active then raise exception 'gift_unavailable'; end if;
    if gift.gift_type = 'insanos' and nullif(btrim(new.vest_name),'') is null then
      raise exception 'vest_name_required';
    end if;
    if gift.funding_mode = 'fixed' and new.amount <> gift.target_amount then
      raise exception 'fixed_amount_required';
    end if;

    select coalesce(sum(amount),0), count(*) into total, confirmed_count
      from public.gift_contributions
      where gift_id = gift.id and payment_status = 'confirmed' and id <> new.id;

    if not gift.allow_multiple and confirmed_count > 0 then
      raise exception 'gift_already_funded';
    end if;

    if gift.funding_mode = 'goal' and total >= gift.target_amount then
      if TG_OP = 'INSERT' then
        raise exception 'gift_goal_reached';
      elsif new.payment_status = 'pending' and old.payment_status <> 'pending' then
        raise exception 'gift_goal_reached';
      end if;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.validate_gift_contribution() from public,anon,authenticated;

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null unique references public.gift_contributions(id) on delete restrict,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_idempotency_key uuid not null unique,
  external_reference text not null unique check (
    length(external_reference) between 1 and 255
    and external_reference = btrim(external_reference)
    and external_reference !~ '[[:cntrl:]]'
  ),
  provider_order_id text unique,
  provider_payment_id text unique,
  provider_status text not null default 'creating' check (length(provider_status) between 1 and 64),
  provider_status_detail text check (provider_status_detail is null or length(provider_status_detail) between 1 and 128),
  amount numeric(10,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  currency text not null default 'BRL' check (currency = 'BRL'),
  expires_at timestamptz not null,
  pix_qr_code text,
  pix_qr_code_base64 text,
  ticket_url text,
  creation_lease_until timestamptz,
  provider_checked_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempt_provider_ids_valid check (
    (provider_order_id is null or (length(provider_order_id) between 1 and 255 and provider_order_id = btrim(provider_order_id)))
    and (provider_payment_id is null or (length(provider_payment_id) between 1 and 255 and provider_payment_id = btrim(provider_payment_id)))
  ),
  constraint payment_attempt_pix_data_valid check (
    (pix_qr_code is null or length(pix_qr_code) between 1 and 8192)
    and (pix_qr_code_base64 is null or length(pix_qr_code_base64) between 1 and 262144)
    and (ticket_url is null or (length(ticket_url) between 1 and 2048 and ticket_url ~ '^https://'))
  )
);

create index payment_attempts_pending_idx
  on public.payment_attempts(expires_at, provider_status)
  where confirmed_at is null;

create trigger payment_attempt_updated before update on public.payment_attempts
  for each row execute function public.wedding_touch_updated_at();

create function public.protect_payment_attempt_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.contribution_id is distinct from old.contribution_id
     or new.provider is distinct from old.provider
     or new.provider_idempotency_key is distinct from old.provider_idempotency_key
     or new.external_reference is distinct from old.external_reference
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_attempt_identity_immutable';
  end if;
  return new;
end $$;

revoke all on function public.protect_payment_attempt_identity() from public,anon,authenticated;
create trigger payment_attempt_identity_immutable before update on public.payment_attempts
  for each row execute function public.protect_payment_attempt_identity();

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  event_key text not null,
  resource_id text not null check (length(resource_id) between 1 and 255),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome is null or length(outcome) between 1 and 64),
  unique(provider, event_key)
);

alter table public.payment_attempts enable row level security;
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_attempts from public,anon,authenticated;
revoke all on public.payment_webhook_events from public,anon,authenticated;
grant select,insert,update,delete on public.payment_attempts to service_role;
grant select,insert,update,delete on public.payment_webhook_events to service_role;

create function public.claim_gift_payment_attempt(
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
      contribution.id,p_provider_idempotency_key,'gift-contribution:' || contribution.id::text,
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

revoke all on function public.claim_gift_payment_attempt(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_gift_payment_attempt(uuid,uuid,integer) to service_role;

create function public.reconcile_gift_payment_attempt(
  p_attempt_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_provider_status_detail text,
  p_amount numeric,
  p_external_reference text,
  p_expires_at timestamptz,
  p_pix_qr_code text default null,
  p_pix_qr_code_base64 text default null,
  p_ticket_url text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  attempt public.payment_attempts;
  contribution public.gift_contributions;
  contribution_status text;
begin
  select * into attempt from public.payment_attempts
  where public.payment_attempts.id = p_attempt_id for update;
  if not found then raise exception 'payment_attempt_not_found'; end if;

  select * into contribution from public.gift_contributions
  where public.gift_contributions.id = attempt.contribution_id for update;

  if p_provider_order_id is null or btrim(p_provider_order_id) = ''
     or p_external_reference <> attempt.external_reference
     or p_amount <> attempt.amount then
    raise exception 'payment_attempt_mismatch';
  end if;
  if attempt.provider_order_id is not null and attempt.provider_order_id <> p_provider_order_id then
    raise exception 'payment_order_mismatch';
  end if;
  if attempt.provider_payment_id is not null
     and p_provider_payment_id is not null
     and attempt.provider_payment_id <> p_provider_payment_id then
    raise exception 'payment_id_mismatch';
  end if;

  update public.payment_attempts set
    provider_order_id = p_provider_order_id,
    provider_payment_id = coalesce(p_provider_payment_id,provider_payment_id),
    provider_status = p_provider_status,
    provider_status_detail = p_provider_status_detail,
    expires_at = coalesce(p_expires_at,expires_at),
    pix_qr_code = coalesce(p_pix_qr_code,pix_qr_code),
    pix_qr_code_base64 = coalesce(p_pix_qr_code_base64,pix_qr_code_base64),
    ticket_url = coalesce(p_ticket_url,ticket_url),
    provider_checked_at = now(),
    creation_lease_until = null,
    confirmed_at = case when p_provider_status = 'processed' and p_provider_status_detail = 'accredited'
      then coalesce(confirmed_at,now()) else confirmed_at end
  where public.payment_attempts.id = attempt.id;

  if p_provider_status = 'processed' and p_provider_status_detail = 'accredited' then
    update public.gift_contributions set payment_status='confirmed',confirmed_at=coalesce(confirmed_at,now())
    where public.gift_contributions.id=contribution.id and payment_status <> 'confirmed';
  elsif p_provider_status = 'expired' then
    update public.gift_contributions set payment_status='expired',confirmed_at=null
    where public.gift_contributions.id=contribution.id and payment_status='pending';
  elsif p_provider_status = 'failed' then
    update public.gift_contributions set payment_status='failed',confirmed_at=null
    where public.gift_contributions.id=contribution.id and payment_status='pending';
  elsif p_provider_status = 'canceled' then
    update public.gift_contributions set payment_status='cancelled',confirmed_at=null
    where public.gift_contributions.id=contribution.id and payment_status='pending';
  end if;

  select payment_status into contribution_status from public.gift_contributions
  where public.gift_contributions.id=contribution.id;
  return contribution_status;
end $$;

revoke all on function public.reconcile_gift_payment_attempt(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  from public,anon,authenticated;
grant execute on function public.reconcile_gift_payment_attempt(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  to service_role;

-- Local expiry remains safe only before a provider attempt exists. Once Pix is
-- issued, reconciliation with Mercado Pago is authoritative.
create or replace function public.expire_gift_contribution_pending(
  p_idempotency_key uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.gift_contributions as contribution
  set payment_status = 'expired'
  where contribution.payment_status = 'pending'
    and contribution.expires_at <= now()
    and not exists (
      select 1 from public.payment_attempts attempt where attempt.contribution_id = contribution.id
    )
    and (
      p_idempotency_key is null
      or contribution.id = p_idempotency_key
      or contribution.idempotency_key = p_idempotency_key
    );
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.expire_gift_contribution_pending(uuid) from public,anon,authenticated;
grant execute on function public.expire_gift_contribution_pending(uuid) to service_role;

commit;
