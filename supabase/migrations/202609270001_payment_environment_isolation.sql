begin;

-- Historical rows intentionally remain NULL until a separately reviewed,
-- row-by-row classification. No default silently promotes TEST to production.
alter table public.gift_contributions add column payment_environment text;
alter table public.payment_attempts add column payment_environment text;
alter table public.gift_contributions add constraint gift_contributions_payment_environment_valid
  check (payment_environment in ('test','production') or payment_environment is null);
alter table public.payment_attempts add constraint payment_attempts_payment_environment_valid
  check (payment_environment in ('test','production') or payment_environment is null);
create index gift_contributions_environment_progress_idx
  on public.gift_contributions(gift_id, payment_environment, payment_status)
  include (amount);
create index payment_attempts_environment_due_idx
  on public.payment_attempts(payment_environment, provider_checked_at, expires_at)
  where provider_order_id is not null and confirmed_at is null;

create function public.guard_gift_contribution_environment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.payment_environment is null then
    raise exception 'payment_environment_required';
  end if;
  if tg_op = 'UPDATE' then
    if old.payment_environment is null and
       (new.payment_status is distinct from old.payment_status
        or new.confirmed_at is distinct from old.confirmed_at) then
      raise exception 'legacy_payment_unclassified';
    end if;
    if old.payment_environment is not null
       and new.payment_environment is distinct from old.payment_environment then
      raise exception 'payment_environment_immutable';
    end if;
    if new.payment_environment is not null and exists (
      select 1 from public.payment_attempts pa
      where pa.contribution_id = new.id and pa.payment_environment is not null
        and pa.payment_environment <> new.payment_environment
    ) then raise exception 'payment_environment_mismatch'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_gift_contribution_environment() from public, anon, authenticated;
create trigger contribution_environment_guard before insert or update on public.gift_contributions
  for each row execute function public.guard_gift_contribution_environment();

create function public.guard_payment_attempt_environment() returns trigger
language plpgsql set search_path = '' as $$
declare contribution_environment text;
begin
  if tg_op = 'INSERT' and new.payment_environment is null then
    raise exception 'payment_environment_required';
  end if;
  if tg_op = 'UPDATE' and old.payment_environment is not null
     and new.payment_environment is distinct from old.payment_environment then
    raise exception 'payment_environment_immutable';
  end if;
  select gc.payment_environment into contribution_environment
    from public.gift_contributions gc where gc.id = new.contribution_id;
  if not found then raise exception 'payment_contribution_not_found'; end if;
  if tg_op = 'INSERT' and contribution_environment is null then
    raise exception 'payment_environment_mismatch';
  end if;
  if contribution_environment is not null and new.payment_environment is not null
     and contribution_environment <> new.payment_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  return new;
end $$;
revoke all on function public.guard_payment_attempt_environment() from public, anon, authenticated;
create trigger payment_attempt_environment_guard before insert or update on public.payment_attempts
  for each row execute function public.guard_payment_attempt_environment();

-- The public catalogue and admin financial dashboard always show real money.
create or replace function public.get_gift_progress()
returns table(gift_id uuid,target_amount numeric,total_raised numeric,
  percentage numeric,remaining_amount numeric,goal_reached boolean)
language sql stable security definer set search_path = '' as $$
  select g.id,g.target_amount,coalesce(c.total,0),
    case when g.funding_mode = 'goal' then
      least(100,round(coalesce(c.total,0)*100/nullif(g.target_amount,0),2)) end,
    case when g.funding_mode = 'goal' then
      greatest(0,g.target_amount-coalesce(c.total,0)) end,
    g.funding_mode = 'goal' and coalesce(c.total,0) >= g.target_amount
  from public.gifts g
  left join lateral (
    select sum(gc.amount) as total from public.gift_contributions gc
    where gc.gift_id = g.id and g.active and gc.payment_status = 'confirmed' and gc.payment_environment = 'production'
  ) c on true
  where g.active;
$$;
create function public.get_gift_progress_for_environment(p_environment text)
returns table(gift_id uuid,target_amount numeric,total_raised numeric,
  percentage numeric,remaining_amount numeric,goal_reached boolean)
language sql stable security definer set search_path = '' as $$
  select g.id,g.target_amount,coalesce(c.total,0),
    case when g.funding_mode = 'goal' then
      least(100,round(coalesce(c.total,0)*100/nullif(g.target_amount,0),2)) end,
    case when g.funding_mode = 'goal' then
      greatest(0,g.target_amount-coalesce(c.total,0)) end,
    g.funding_mode = 'goal' and coalesce(c.total,0) >= g.target_amount
  from public.gifts g
  left join lateral (
    select sum(gc.amount) as total from public.gift_contributions gc
    where gc.gift_id = g.id and g.active and gc.payment_status = 'confirmed' and gc.payment_environment = p_environment
  ) c on true
  where g.active;
$$;
revoke all on function public.get_gift_progress_for_environment(text) from public, anon, authenticated;
grant execute on function public.get_gift_progress_for_environment(text) to service_role;

create or replace function public.get_admin_dashboard(p_user_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.admin_users where user_id=p_user_id and active) then
    raise exception 'admin_access_denied' using errcode='42501';
  end if;
  with real_groups as (
    select id from public.invitation_groups where active and not is_demo
  ), real_guests as (
    select g.type, g.attendance_status from public.guests g
    join real_groups r on r.id=g.invitation_group_id where g.active
  ), amounts as (
    select gift_id, sum(amount) as raised from public.gift_contributions
    where payment_status='confirmed' and payment_environment='production' group by gift_id
  ), goals as (
    select g.id,g.name,g.category,g.display_order,g.target_amount,
      coalesce(a.raised,0) as raised,
      least(100,round(100*coalesce(a.raised,0)/g.target_amount,2)) as percentage,
      greatest(0,g.target_amount-coalesce(a.raised,0)) as remaining
    from public.gifts g left join amounts a on a.gift_id=g.id
    where g.active and g.funding_mode='goal'
  ), recent as (
    select c.id,c.contributor_name,g.name as gift_name,c.amount,c.payment_status,c.created_at
    from public.gift_contributions c join public.gifts g on g.id=c.gift_id
    where c.payment_environment='production'
    order by c.created_at desc,c.id desc limit 20
  )
  select jsonb_build_object(
    'generated_at',now(),
    'guests',(select jsonb_build_object('total',count(*),
      'adults',count(*) filter(where type='adult'),'children',count(*) filter(where type='child'),
      'confirmed',count(*) filter(where attendance_status='confirmed'),
      'declined',count(*) filter(where attendance_status='declined'),
      'pending',count(*) filter(where attendance_status='pending')) from real_guests),
    'groups',(select jsonb_build_object('total',count(*),
      'responded',count(*) filter(where exists(select 1 from public.rsvps r where r.invitation_group_id=g.id)),
      'unanswered',count(*) filter(where not exists(select 1 from public.rsvps r where r.invitation_group_id=g.id))) from real_groups g),
    'gifts',(select jsonb_build_object('total',count(*),
      'house',count(*) filter(where category='house'),'party',count(*) filter(where category='party'),
      'travel',count(*) filter(where category='travel'),'insanos',count(*) filter(where category='insanos'),
      'goal',count(*) filter(where funding_mode='goal'),'open',count(*) filter(where funding_mode='open'),
      'fixed',count(*) filter(where funding_mode='fixed')) from public.gifts where active),
    'goal_totals',(select jsonb_build_object('target',coalesce(sum(target_amount),0),
      'raised',coalesce(sum(raised),0),
      'percentage',least(100,coalesce(100*sum(raised)/nullif(sum(target_amount),0),0))) from goals),
    'contributions',(select jsonb_build_object(
      'pending',count(*) filter(where c.payment_status='pending'),
      'confirmed',count(*) filter(where c.payment_status='confirmed'),
      'expired',count(*) filter(where c.payment_status='expired'),
      'cancelled',count(*) filter(where c.payment_status='cancelled'),
      'failed',count(*) filter(where c.payment_status='failed'),
      'total',coalesce(sum(c.amount) filter(where c.payment_status='confirmed'),0),
      'goal',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and g.funding_mode='goal'),0),
      'open',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and g.funding_mode='open'),0),
      'fixed',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and g.funding_mode='fixed'),0),
      'insanos',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and g.gift_type='insanos'),0))
      from public.gift_contributions c join public.gifts g on g.id=c.gift_id
      where c.payment_environment='production'),
    'goals',coalesce((select jsonb_agg(to_jsonb(g)-'display_order' order by display_order,id) from goals g),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id desc) from recent r),'[]'::jsonb)
  ) into result;
  return result;
end $$;

-- A goal is an opening condition, not a ceiling. Test and production have
-- independent confirmed totals. Unknown legacy money blocks new production
-- admission for that gift until it is classified.
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
      where gift_id = gift.id and payment_status = 'confirmed'
        and payment_environment = new.payment_environment and id <> new.id;

    if TG_OP = 'INSERT' and new.payment_environment = 'production' and exists (
      select 1 from public.gift_contributions gc where gc.gift_id = gift.id
        and gc.payment_environment is null and gc.payment_status in ('pending','confirmed')
    ) then raise exception 'legacy_financial_hold'; end if;

    if TG_OP = 'INSERT' and not gift.allow_multiple and confirmed_count > 0 then
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

-- Keep the current expiry wrapper, but replace its private admission core
-- with an environment-scoped implementation.
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

  select * into gift from public.gifts where public.gifts.id = contribution.gift_id for update;
  if not found or not gift.active then raise exception 'gift_unavailable'; end if;

  select * into attempt from public.payment_attempts
  where public.payment_attempts.contribution_id = contribution.id for update;

  if found then
    if attempt.payment_environment is distinct from contribution.payment_environment then
      raise exception 'payment_environment_mismatch';
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
      contribution_id,payment_environment,provider_idempotency_key,external_reference,amount,expires_at,creation_lease_until
    ) values (
      contribution.id,contribution.payment_environment,p_provider_idempotency_key,'gift-contribution-' || contribution.id::text,
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
revoke all on function public.claim_gift_payment_attempt_before_expiry_guard(uuid,uuid,integer)
  from public, anon, authenticated, service_role;

create function public.claim_gift_payment_attempt_for_environment(
  p_contribution_id uuid, p_environment text, p_provider_idempotency_key uuid,
  p_lease_seconds integer default 30
) returns table(
  id uuid, contribution_id uuid, provider_idempotency_key uuid,
  external_reference text, provider_order_id text, provider_payment_id text,
  provider_status text, provider_status_detail text, amount numeric,
  expires_at timestamptz, pix_qr_code text, pix_qr_code_base64 text,
  ticket_url text, provider_checked_at timestamptz, can_create boolean,
  order_submission_state text, payment_environment text
) language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare attempt public.payment_attempts;
begin
  if p_environment not in ('test','production') or p_environment is null then
    raise exception 'invalid_payment_environment';
  end if;
  select * into contribution from public.gift_contributions gc
    where gc.id = p_contribution_id for update;
  if not found or contribution.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  select * into attempt from public.payment_attempts pa
    where pa.contribution_id = contribution.id for update;
  if found and attempt.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  return query select claimed.*, p_environment from public.claim_gift_payment_attempt(
    p_contribution_id, p_provider_idempotency_key, p_lease_seconds) as claimed;
end $$;
revoke all on function public.claim_gift_payment_attempt_for_environment(uuid,text,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.claim_gift_payment_attempt_for_environment(uuid,text,uuid,integer)
  to service_role;
revoke all on function public.claim_gift_payment_attempt(uuid,uuid,integer)
  from public, anon, authenticated, service_role;

create function public.begin_gift_order_submission_for_environment(
  p_attempt_id uuid, p_environment text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare attempt public.payment_attempts;
begin
  if p_environment not in ('test','production') or p_environment is null then
    raise exception 'invalid_payment_environment';
  end if;
  select gc.* into contribution from public.gift_contributions gc
    join public.payment_attempts pa on pa.contribution_id = gc.id
    where pa.id = p_attempt_id for update of gc;
  if not found or contribution.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  select * into attempt from public.payment_attempts pa
    where pa.id = p_attempt_id for update;
  if not found or attempt.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  return public.begin_gift_order_submission(p_attempt_id);
end $$;
revoke all on function public.begin_gift_order_submission_for_environment(uuid,text)
  from public, anon, authenticated;
grant execute on function public.begin_gift_order_submission_for_environment(uuid,text)
  to service_role;
revoke all on function public.begin_gift_order_submission(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.expire_gift_contribution_pending_for_environment(
  p_environment text, p_idempotency_key uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare affected integer := 0;
begin
  if p_environment not in ('test','production') or p_environment is null then
    raise exception 'invalid_payment_environment';
  end if;
  for contribution in
    select gc.* from public.gift_contributions gc
    where gc.payment_environment = p_environment
      and gc.payment_status = 'pending' and gc.expires_at <= now()
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
revoke all on function public.expire_gift_contribution_pending_for_environment(text,uuid)
  from public, anon, authenticated;
grant execute on function public.expire_gift_contribution_pending_for_environment(text,uuid)
  to service_role;
revoke all on function public.expire_gift_contribution_pending(uuid)
  from public, anon, authenticated, service_role;

create function public.claim_due_gift_payment_reconciliation_for_environment(
  p_environment text, 
  p_limit integer default 10, p_lease_seconds integer default 120
) returns table(id uuid, contribution_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_environment not in ('test','production') or p_environment is null then
    raise exception 'invalid_payment_environment';
  end if;
  if p_limit < 1 or p_limit > 25 or p_lease_seconds < 30
     or p_lease_seconds > 300 then
    raise exception 'invalid_reconciliation_batch';
  end if;
  return query
  with due as (
    select pa.id from public.payment_attempts pa
      join public.gift_contributions gc on gc.id = pa.contribution_id
    where pa.payment_environment = p_environment
      and gc.payment_environment = p_environment
      and (gc.payment_status = 'pending'
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
revoke all on function public.claim_due_gift_payment_reconciliation_for_environment(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_gift_payment_reconciliation_for_environment(text,integer,integer)
  to service_role;
revoke all on function public.claim_due_gift_payment_reconciliation(integer,integer)
  from public, anon, authenticated, service_role;

create function public.reconcile_gift_payment_attempt_for_environment(
  p_attempt_id uuid, p_environment text, p_provider_order_id text,
  p_provider_payment_id text, p_provider_status text,
  p_provider_status_detail text, p_amount numeric,
  p_external_reference text, p_expires_at timestamptz,
  p_pix_qr_code text default null, p_pix_qr_code_base64 text default null,
  p_ticket_url text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare contribution public.gift_contributions;
declare attempt public.payment_attempts;
declare linked_contribution_id uuid;
begin
  if p_environment not in ('test','production') or p_environment is null then
    raise exception 'invalid_payment_environment';
  end if;
  select pa.contribution_id into linked_contribution_id
    from public.payment_attempts pa where pa.id = p_attempt_id;
  if not found then raise exception 'payment_attempt_not_found'; end if;
  select * into contribution from public.gift_contributions gc
    where gc.id = linked_contribution_id for update;
  if not found or contribution.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  select * into attempt from public.payment_attempts pa
    where pa.id = p_attempt_id for update;
  if not found or attempt.contribution_id <> contribution.id
     or attempt.payment_environment is distinct from p_environment then
    raise exception 'payment_environment_mismatch';
  end if;
  return public.reconcile_gift_payment_attempt(
    p_attempt_id,p_provider_order_id,p_provider_payment_id,p_provider_status,
    p_provider_status_detail,p_amount,p_external_reference,p_expires_at,
    p_pix_qr_code,p_pix_qr_code_base64,p_ticket_url);
end $$;
revoke all on function public.reconcile_gift_payment_attempt_for_environment(
  uuid,text,text,text,text,text,numeric,text,timestamptz,text,text,text)
  from public, anon, authenticated;
grant execute on function public.reconcile_gift_payment_attempt_for_environment(
  uuid,text,text,text,text,text,numeric,text,timestamptz,text,text,text)
  to service_role;
revoke all on function public.reconcile_gift_payment_attempt(
  uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)
  from public, anon, authenticated, service_role;

commit;
