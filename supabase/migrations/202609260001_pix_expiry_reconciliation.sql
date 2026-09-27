begin;

alter table public.payment_attempts
  add column order_submission_started_at timestamptz,
  add column reconciliation_lease_until timestamptz,
  add column terminal_followup_until timestamptz,
  add column order_submission_state text not null default 'legacy'
    constraint payment_attempt_order_submission_state_valid
    check (order_submission_state in ('legacy', 'not_started', 'started'));

-- The fast default classifies every pre-existing attempt as legacy without
-- rewriting historical confirmed payments. Only future inserts are known to
-- be unsubmitted. A legacy NULL Order ID is never proof of no submission.
alter table public.payment_attempts
  alter column order_submission_state set default 'not_started';

-- Existing terminal Orders get a finite observation period from rollout.
-- No confirmed contribution is updated by this backfill.
update public.payment_attempts pa
set terminal_followup_until = now() + interval '24 hours'
from public.gift_contributions gc
where gc.id = pa.contribution_id
  and gc.payment_status in ('failed', 'expired')
  and pa.provider_order_id is not null;

create index payment_attempts_reconciliation_idx
  on public.payment_attempts(provider_checked_at, expires_at)
  where provider_order_id is not null and confirmed_at is null;

-- Preserve the historical admission rules, but make the deadline check atomic
-- under the contribution lock. The renamed implementation is not callable by
-- application roles: all callers must go through the guarded function.
alter function public.claim_gift_payment_attempt(uuid,uuid,integer)
  rename to claim_gift_payment_attempt_before_expiry_guard;
revoke all on function public.claim_gift_payment_attempt_before_expiry_guard(uuid,uuid,integer)
  from public, anon, authenticated, service_role;

create function public.claim_gift_payment_attempt(
  p_contribution_id uuid, p_provider_idempotency_key uuid,
  p_lease_seconds integer default 30
) returns table(
  id uuid, contribution_id uuid, provider_idempotency_key uuid,
  external_reference text, provider_order_id text, provider_payment_id text,
  provider_status text, provider_status_detail text, amount numeric,
  expires_at timestamptz, pix_qr_code text, pix_qr_code_base64 text,
  ticket_url text, provider_checked_at timestamptz, can_create boolean,
  order_submission_state text
)
language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare attempt public.payment_attempts;
declare had_attempt boolean;
declare claimed record;
begin
  select * into contribution from public.gift_contributions gc
  where gc.id = p_contribution_id for update;
  if not found or contribution.payment_status <> 'pending' then
    raise exception 'contribution_not_payable';
  end if;

  -- A contribution lock serializes claim, begin, and reconciliation. Identity
  -- is immutable, so this read does not need an attempt lock before admission.
  select * into attempt from public.payment_attempts pa
  where pa.contribution_id = contribution.id;
  had_attempt := found;

  if contribution.expires_at <= now() then
    if not had_attempt or (attempt.provider_order_id is null
      and attempt.order_submission_state = 'not_started') then
      update public.gift_contributions gc set payment_status = 'expired'
      where gc.id = contribution.id and gc.payment_status = 'pending';
    end if;
  end if;

  -- Neither a sent attempt nor an ambiguous legacy attempt can be reclaimed,
  -- even if its historical creation lease has expired.
  if contribution.expires_at <= now()
     or (had_attempt and (attempt.provider_order_id is not null
       or attempt.order_submission_state <> 'not_started')) then
    if had_attempt then
      return query select attempt.id, attempt.contribution_id,
        attempt.provider_idempotency_key, attempt.external_reference,
        attempt.provider_order_id, attempt.provider_payment_id,
        attempt.provider_status, attempt.provider_status_detail, attempt.amount,
        attempt.expires_at, attempt.pix_qr_code, attempt.pix_qr_code_base64,
        attempt.ticket_url, attempt.provider_checked_at, false,
        attempt.order_submission_state;
    end if;
    return;
  end if;

  select * into claimed from public.claim_gift_payment_attempt_before_expiry_guard(
    p_contribution_id, p_provider_idempotency_key, p_lease_seconds
  );
  if not found then return; end if;
  select * into attempt from public.payment_attempts pa where pa.id = claimed.id;
  return query select claimed.id, claimed.contribution_id,
    claimed.provider_idempotency_key, claimed.external_reference,
    claimed.provider_order_id, claimed.provider_payment_id,
    claimed.provider_status, claimed.provider_status_detail, claimed.amount,
    claimed.expires_at, claimed.pix_qr_code, claimed.pix_qr_code_base64,
    claimed.ticket_url, claimed.provider_checked_at, claimed.can_create,
    attempt.order_submission_state;
end $$;
revoke all on function public.claim_gift_payment_attempt(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.claim_gift_payment_attempt(uuid,uuid,integer)
  to service_role;

-- Called immediately before the HTTP POST. A lost response leaves a durable
-- indication that an Order may exist, even though its ID is not yet known.
create function public.begin_gift_order_submission(p_attempt_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts;
declare contribution public.gift_contributions;
begin
  select gc.* into contribution from public.gift_contributions gc
    join public.payment_attempts pa on pa.contribution_id = gc.id
    where pa.id = p_attempt_id for update of gc;
  if not found then return false; end if;
  select * into attempt from public.payment_attempts pa
    where pa.id = p_attempt_id for update;
  if contribution.payment_status <> 'pending'
     or contribution.expires_at <= now() + interval '5 seconds'
     or attempt.provider_order_id is not null
     or attempt.order_submission_state <> 'not_started'
     or attempt.creation_lease_until is null
     or attempt.creation_lease_until <= now() then
    return false;
  end if;
  update public.payment_attempts pa
    set order_submission_state = 'started',
        order_submission_started_at = now()
    where pa.id = p_attempt_id;
  return true;
end $$;
revoke all on function public.begin_gift_order_submission(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_gift_order_submission(uuid) to service_role;

-- Periodic local expiry applies only when no provider submission began.
-- Locking the contribution before inspecting its attempt serializes this
-- decision with claim/begin. Known or uncertain Orders remain provider-owned.
create or replace function public.expire_gift_contribution_pending(
  p_idempotency_key uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare affected integer := 0;
begin
  for contribution in
    select gc.* from public.gift_contributions gc
    where gc.payment_status = 'pending' and gc.expires_at <= now()
      and (p_idempotency_key is null or gc.id = p_idempotency_key
        or gc.idempotency_key = p_idempotency_key)
      and not exists (
        select 1 from public.payment_attempts pa
        where pa.contribution_id = gc.id
          and (pa.provider_order_id is not null
            or pa.order_submission_state <> 'not_started')
      )
    order by gc.expires_at, gc.id
    for update of gc skip locked limit 100
  loop
    if not exists (
      select 1 from public.payment_attempts pa
      where pa.contribution_id = contribution.id
        and (pa.provider_order_id is not null
          or pa.order_submission_state <> 'not_started')
    ) then
      update public.gift_contributions gc set payment_status = 'expired'
      where gc.id = contribution.id and gc.payment_status = 'pending';
      affected := affected + 1;
    end if;
  end loop;
  return affected;
end $$;
revoke all on function public.expire_gift_contribution_pending(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_gift_contribution_pending(uuid)
  to service_role;

-- Only known Orders are selected. No job path is allowed to create an Order.
create function public.claim_due_gift_payment_reconciliation(
  p_limit integer default 10, p_lease_seconds integer default 120
) returns table(id uuid, contribution_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit < 1 or p_limit > 25 or p_lease_seconds < 30
     or p_lease_seconds > 300 then
    raise exception 'invalid_reconciliation_batch';
  end if;
  return query
  with due as (
    select pa.id from public.payment_attempts pa
      join public.gift_contributions gc on gc.id = pa.contribution_id
    where (gc.payment_status = 'pending'
      or (gc.payment_status in ('failed', 'expired')
        and pa.terminal_followup_until > now()))
      and pa.provider_order_id is not null
      and (pa.reconciliation_lease_until is null
        or pa.reconciliation_lease_until <= now())
      and (pa.provider_checked_at is null or pa.provider_checked_at <= now() -
        case when gc.payment_status in ('failed', 'expired') then interval '30 minutes'
          when pa.expires_at > now() then interval '5 minutes'
          when pa.expires_at > now() - interval '2 hours' then interval '10 minutes'
          else interval '1 hour' end)
    order by (gc.payment_status = 'pending') desc,
      (pa.expires_at <= now()) desc, pa.expires_at,
      coalesce(pa.provider_checked_at, pa.created_at)
    for update of pa skip locked limit p_limit
  )
  update public.payment_attempts pa
    set reconciliation_lease_until = now() + make_interval(secs => p_lease_seconds)
    from due where pa.id = due.id
    returning pa.id, pa.contribution_id;
end $$;
revoke all on function public.claim_due_gift_payment_reconciliation(integer,integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_gift_payment_reconciliation(integer,integer)
  to service_role;

-- All three callers retain one financial decision. A stale response cannot
-- downgrade a confirmed contribution; a late accredited payment may upgrade
-- a previously non-confirmed state.
alter function public.reconcile_gift_payment_attempt(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  rename to reconcile_gift_payment_attempt_before_confirmed_guard;
revoke all on function public.reconcile_gift_payment_attempt_before_confirmed_guard(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  from public, anon, authenticated, service_role;

create function public.reconcile_gift_payment_attempt(
  p_attempt_id uuid, p_provider_order_id text, p_provider_payment_id text,
  p_provider_status text, p_provider_status_detail text, p_amount numeric,
  p_external_reference text, p_expires_at timestamptz,
  p_pix_qr_code text default null, p_pix_qr_code_base64 text default null,
  p_ticket_url text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts;
declare contribution public.gift_contributions;
declare linked_contribution_id uuid;
declare result text;
begin
  -- contribution_id is protected by the immutable-identity trigger. Read it
  -- without a lock, then acquire the shared lock order: contribution, attempt.
  select pa.contribution_id into linked_contribution_id
    from public.payment_attempts pa where pa.id = p_attempt_id;
  if not found then raise exception 'payment_attempt_not_found'; end if;
  select * into contribution from public.gift_contributions gc
    where gc.id = linked_contribution_id for update;
  if not found then raise exception 'payment_contribution_not_found'; end if;
  select * into attempt from public.payment_attempts pa
    where pa.id = p_attempt_id for update;
  if not found or attempt.contribution_id <> contribution.id then
    raise exception 'payment_attempt_mismatch';
  end if;
  if contribution.payment_status = 'confirmed'
     and not (p_provider_status = 'processed'
       and p_provider_status_detail = 'accredited') then
    -- Even ignored stale observations must match the persisted Order identity.
    if p_provider_order_id is distinct from attempt.provider_order_id
       or (attempt.provider_payment_id is not null
         and p_provider_payment_id is not null
         and p_provider_payment_id is distinct from attempt.provider_payment_id)
       or p_external_reference is distinct from attempt.external_reference
       or p_amount is distinct from attempt.amount then
      raise exception 'payment_attempt_mismatch';
    end if;
    update public.payment_attempts pa set reconciliation_lease_until = null
      where pa.id = attempt.id;
    return 'confirmed';
  end if;
  result := public.reconcile_gift_payment_attempt_before_confirmed_guard(
    p_attempt_id, p_provider_order_id, p_provider_payment_id,
    p_provider_status, p_provider_status_detail, p_amount,
    p_external_reference, p_expires_at, p_pix_qr_code,
    p_pix_qr_code_base64, p_ticket_url
  );
  update public.payment_attempts pa set
      reconciliation_lease_until = null,
      terminal_followup_until = case
        when result = 'confirmed' then null
        when result in ('failed', 'expired') then
          coalesce(pa.terminal_followup_until, now() + interval '24 hours')
        else pa.terminal_followup_until end
    where pa.id = attempt.id;
  return result;
end $$;
revoke all on function public.reconcile_gift_payment_attempt(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reconcile_gift_payment_attempt(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  to service_role;

commit;
