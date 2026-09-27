begin;

-- Every new Mercado Pago contribution is tagged with the environment that
-- created it. NULL remains valid only for historical/manual rows that predate
-- provider environment tracking.
alter table public.gift_contributions
  add column payment_environment text
    constraint gift_contribution_payment_environment_valid
    check (payment_environment is null or payment_environment in ('test','production'));

alter table public.payment_attempts
  add column payment_environment text
    constraint payment_attempt_environment_valid
    check (payment_environment is null or payment_environment in ('test','production'));

-- The Mercado Pago integration has only run in TEST up to this migration.
-- Preserve older manually-confirmed contributions (which have no attempt) as
-- legacy/NULL, while isolating every historical provider attempt from money.
update public.payment_attempts
set payment_environment = 'test'
where payment_environment is null;

update public.gift_contributions gc
set payment_environment = 'test'
from public.payment_attempts pa
where pa.contribution_id = gc.id
  and gc.payment_environment is null;

-- Once assigned, a contribution cannot cross TEST <-> PRODUCTION. Legacy NULL
-- may be assigned exactly once when an old pending contribution is resumed.
create function public.protect_gift_contribution_environment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.payment_environment is not null
     and new.payment_environment is distinct from old.payment_environment then
    raise exception 'payment_environment_immutable';
  end if;
  return new;
end $$;

revoke all on function public.protect_gift_contribution_environment()
  from public, anon, authenticated;

create trigger gift_contribution_environment_immutable
  before update on public.gift_contributions
  for each row execute function public.protect_gift_contribution_environment();

-- Attempts inherit the already-persisted contribution environment. This keeps
-- the old claim RPC signature stable and prevents an untagged provider Order.
create function public.set_payment_attempt_environment() returns trigger
language plpgsql set search_path = '' as $$
declare contribution_environment text;
begin
  select gc.payment_environment into contribution_environment
  from public.gift_contributions gc
  where gc.id = new.contribution_id;

  if contribution_environment not in ('test','production') then
    raise exception 'payment_environment_missing';
  end if;

  if new.payment_environment is null then
    new.payment_environment := contribution_environment;
  elsif new.payment_environment is distinct from contribution_environment then
    raise exception 'payment_environment_mismatch';
  end if;

  return new;
end $$;

revoke all on function public.set_payment_attempt_environment()
  from public, anon, authenticated;

create trigger payment_attempt_environment_from_contribution
  before insert on public.payment_attempts
  for each row execute function public.set_payment_attempt_environment();

-- payment_environment is part of provider identity after insert.
create or replace function public.protect_payment_attempt_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.contribution_id is distinct from old.contribution_id
     or new.provider is distinct from old.provider
     or new.provider_idempotency_key is distinct from old.provider_idempotency_key
     or new.external_reference is distinct from old.external_reference
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.payment_environment is distinct from old.payment_environment
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_attempt_identity_immutable';
  end if;
  return new;
end $$;

-- TEST confirmations may reach processed/accredited, but they never reserve or
-- satisfy a real gift. Production plus legacy/manual confirmations keep the
-- previous financial behavior.
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

    if new.payment_environment is distinct from 'test' then
      select coalesce(sum(amount),0), count(*) into total, confirmed_count
      from public.gift_contributions
      where gift_id = gift.id
        and payment_status = 'confirmed'
        and payment_environment is distinct from 'test'
        and id <> new.id;

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
  end if;
  return new;
end $$;

revoke all on function public.validate_gift_contribution()
  from public, anon, authenticated;

-- Public progress is financial progress. TEST rows are intentionally invisible.
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
    where gc.gift_id = g.id
      and g.active
      and gc.payment_status = 'confirmed'
      and gc.payment_environment is distinct from 'test'
  ) c on true
  where g.active;
$$;

revoke all on function public.get_gift_progress() from public;
grant execute on function public.get_gift_progress()
  to anon, authenticated, service_role;

-- The admin dashboard keeps TEST visible for audit, but never mixes it into
-- raised amounts, gift goals, or the real/legacy confirmed counters.
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
    where payment_status='confirmed'
      and payment_environment is distinct from 'test'
    group by gift_id
  ), goals as (
    select g.id,g.name,g.category,g.display_order,g.target_amount,
      coalesce(a.raised,0) as raised,
      least(100,round(100*coalesce(a.raised,0)/g.target_amount,2)) as percentage,
      greatest(0,g.target_amount-coalesce(a.raised,0)) as remaining
    from public.gifts g left join amounts a on a.gift_id=g.id
    where g.active and g.funding_mode='goal'
  ), recent as (
    select c.id,c.contributor_name,g.name as gift_name,c.amount,c.payment_status,
      coalesce(c.payment_environment,'legacy') as payment_environment,c.created_at
    from public.gift_contributions c join public.gifts g on g.id=c.gift_id
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
      'pending',count(*) filter(where c.payment_status='pending' and c.payment_environment is distinct from 'test'),
      'confirmed',count(*) filter(where c.payment_status='confirmed' and c.payment_environment is distinct from 'test'),
      'expired',count(*) filter(where c.payment_status='expired' and c.payment_environment is distinct from 'test'),
      'cancelled',count(*) filter(where c.payment_status='cancelled' and c.payment_environment is distinct from 'test'),
      'failed',count(*) filter(where c.payment_status='failed' and c.payment_environment is distinct from 'test'),
      'test',count(*) filter(where c.payment_environment='test'),
      'test_confirmed',count(*) filter(where c.payment_environment='test' and c.payment_status='confirmed'),
      'test_total',coalesce(sum(c.amount) filter(where c.payment_environment='test' and c.payment_status='confirmed'),0),
      'total',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and c.payment_environment is distinct from 'test'),0),
      'goal',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and c.payment_environment is distinct from 'test' and g.funding_mode='goal'),0),
      'open',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and c.payment_environment is distinct from 'test' and g.funding_mode='open'),0),
      'fixed',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and c.payment_environment is distinct from 'test' and g.funding_mode='fixed'),0),
      'insanos',coalesce(sum(c.amount) filter(where c.payment_status='confirmed' and c.payment_environment is distinct from 'test' and g.gift_type='insanos'),0))
      from public.gift_contributions c join public.gifts g on g.id=c.gift_id),
    'goals',coalesce((select jsonb_agg(to_jsonb(g)-'display_order' order by display_order,id) from goals g),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id desc) from recent r),'[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.get_admin_dashboard(uuid)
  from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(uuid) to service_role;

commit;
