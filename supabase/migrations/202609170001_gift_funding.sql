begin;

alter table public.gifts rename column price to target_amount;
alter table public.gifts
  drop constraint gifts_price_positive,
  alter column target_amount drop not null,
  add column funding_mode text not null default 'goal';
update public.gifts set funding_mode = 'fixed' where gift_type = 'insanos';
alter table public.gifts
  add constraint gifts_funding_mode_allowed check (funding_mode in ('goal','open','fixed')),
  add constraint gifts_target_amount_valid check (
    (funding_mode = 'open' and target_amount is null)
    or (funding_mode in ('goal','fixed') and target_amount is not null
        and target_amount > 0 and target_amount <> 'NaN'::numeric)
  ),
  add constraint gifts_insanos_funding check (
    gift_type <> 'insanos' or (funding_mode = 'fixed' and allow_multiple)
  );

create table public.gift_contributions (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.gifts(id) on delete restrict,
  contributor_name text not null check (length(btrim(contributor_name)) between 1 and 150),
  contributor_phone text check (contributor_phone is null or length(btrim(contributor_phone)) between 8 and 32),
  amount numeric(10,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  payment_status text not null default 'pending' check (payment_status in ('pending','confirmed','cancelled','failed')),
  payment_method text not null check (payment_method in ('pix','external')),
  external_reference text,
  message text check (length(message) <= 2000),
  vest_name text check (vest_name is null or length(btrim(vest_name)) between 1 and 150),
  regional_division text check (length(regional_division) <= 150),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint contributions_external_reference_valid check (
    external_reference is null or (
      length(external_reference) between 1 and 255
      and external_reference = btrim(external_reference)
      and external_reference !~ '[[:cntrl:]]'
    )
  ),
  constraint contributions_confirmation_consistent check (
    (payment_status = 'confirmed' and confirmed_at is not null)
    or (payment_status <> 'confirmed' and confirmed_at is null)
  )
);
create index contributions_gift_status_idx on public.gift_contributions(gift_id,payment_status);
-- Opaque, case-sensitive provider references; callers must trim before writing.
create unique index contributions_external_reference_uidx
  on public.gift_contributions(external_reference)
  where external_reference is not null;
create trigger contribution_updated before update on public.gift_contributions
  for each row execute function public.wedding_touch_updated_at();

-- All admission/confirmation writes serialize on the same gift row.
-- Pending contributions do not reserve funds. Recheck at confirmation.
create function public.validate_gift_contribution() returns trigger
language plpgsql set search_path = '' as $$
declare gift public.gifts; total numeric; confirmed_count bigint;
begin
  if TG_OP = 'UPDATE' and new.gift_id <> old.gift_id then
    raise exception 'contribution_gift_immutable';
  end if;
  -- A row write also forces stale REPEATABLE READ transactions to retry.
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
    if gift.funding_mode = 'goal' and
       (total >= gift.target_amount or total + new.amount > gift.target_amount) then
      raise exception 'gift_goal_exceeded';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_gift_contribution() from public,anon,authenticated;
create trigger contribution_validate before insert or update on public.gift_contributions
  for each row execute function public.validate_gift_contribution();

alter table public.gift_contributions enable row level security;
revoke all on public.gift_contributions from public,anon,authenticated;
grant select,insert,update,delete on public.gift_contributions to service_role;

-- No identifiers or personal fields from individual contributions are returned.
create function public.get_gift_progress()
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
    where gc.gift_id = g.id and g.active and gc.payment_status = 'confirmed'
  ) c on true
  where g.active;
$$;
revoke all on function public.get_gift_progress() from public;
grant execute on function public.get_gift_progress() to anon,authenticated,service_role;

commit;
