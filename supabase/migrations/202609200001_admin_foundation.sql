begin;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- Remove default grants too: hosted Supabase may grant service_role ALL.
revoke all on public.admin_users from public, anon, authenticated, service_role;
grant select on public.admin_users to service_role;

-- Supabase Auth manages credentials. This stores only a token digest for
-- immediate, local logout revocation; never passwords or raw tokens.
create table public.admin_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.admin_users(user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from public, anon, authenticated, service_role;
grant select, insert, delete on public.admin_sessions to service_role;

create function public.revoke_admin_session(p_token_hash text) returns void
language sql security invoker set search_path = '' as $$
  delete from public.admin_sessions where token_hash = p_token_hash;
$$;
revoke all on function public.revoke_admin_session(text) from public, anon, authenticated;
grant execute on function public.revoke_admin_session(text) to service_role;

-- One consistent snapshot, no REST row limit, no writes or expiration side effects.
create function public.get_admin_dashboard(p_user_id uuid) returns jsonb
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
    where payment_status='confirmed' group by gift_id
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
      from public.gift_contributions c join public.gifts g on g.id=c.gift_id),
    'goals',coalesce((select jsonb_agg(to_jsonb(g)-'display_order' order by display_order,id) from goals g),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc,id desc) from recent r),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_admin_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(uuid) to service_role;

commit;
