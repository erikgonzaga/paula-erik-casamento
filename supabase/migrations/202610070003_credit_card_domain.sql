-- Stage 1 only: persistence contract. No card Order creation or event consumer.
begin;
set local lock_timeout = '5s';
lock table public.gift_contributions, public.payment_attempts in access exclusive mode;

-- Follow the project's one-time migration pattern; stop on a partial schema too.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'payment_attempts'
    and column_name in ('payment_method', 'installments', 'provider_payment_method_id'))
    or to_regclass('public.payment_financial_adjustments') is not null then
    raise exception 'credit_card_domain_already_applied_or_partial';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.payment_attempts'::regclass
      and tgname = 'payment_attempt_updated' and tgenabled = 'O') then
    raise exception 'unexpected_payment_attempt_updated_trigger';
  end if;
end $$;

alter table public.gift_contributions drop constraint gift_contributions_payment_method_check;
alter table public.gift_contributions add constraint gift_contributions_payment_method_check
  check (payment_method in ('pix', 'credit_card', 'external'));
alter table public.payment_attempts
  add column payment_method text,
  add column installments numeric,
  add column provider_payment_method_id text;

-- Derive historical method from the contribution, never from provider ID prefixes.
-- Preserve all existing fields, including updated_at and payment_environment NULL.
alter table public.payment_attempts disable trigger payment_attempt_updated;
update public.payment_attempts pa set
  payment_method = gc.payment_method,
  provider_payment_method_id = case when gc.payment_method = 'pix' then 'pix' else null end
from public.gift_contributions gc where gc.id = pa.contribution_id;
alter table public.payment_attempts enable trigger payment_attempt_updated;
alter table public.payment_attempts alter column payment_method set not null;
alter table public.payment_attempts add constraint payment_attempt_method_allowed
  check (payment_method in ('pix', 'credit_card', 'external'));
alter table public.payment_attempts add constraint payment_attempt_method_metadata_valid check (
  (payment_method = 'credit_card' and installments is not null
    and installments between 1 and 12 and installments = trunc(installments)
    and provider_payment_method_id is not null and provider_payment_method_id <> 'pix')
  or (payment_method = 'pix' and installments is null
    and provider_payment_method_id is not null and provider_payment_method_id = 'pix')
  or (payment_method = 'external' and installments is null)
);
alter table public.payment_attempts add constraint payment_attempt_method_id_valid check (
  provider_payment_method_id is null or (
    length(provider_payment_method_id) between 1 and 64
    and provider_payment_method_id = btrim(provider_payment_method_id)
    and provider_payment_method_id !~ '[[:cntrl:]]'
  )
);

create function public.guard_payment_attempt_method() returns trigger
language plpgsql set search_path = '' as $$
declare contribution_method text;
begin
  if tg_op = 'UPDATE' and (
    new.payment_method is distinct from old.payment_method
    or new.installments is distinct from old.installments
    or new.provider_payment_method_id is distinct from old.provider_payment_method_id
  ) then raise exception 'payment_attempt_method_immutable'; end if;
  select gc.payment_method into contribution_method from public.gift_contributions gc
    where gc.id = new.contribution_id;
  if not found then raise exception 'payment_contribution_not_found'; end if;
  if tg_op = 'INSERT' then
    -- Existing Pix RPC signatures omit these fields. Keep their inserts compatible.
    if new.payment_method is null and contribution_method in ('pix', 'external') then
      new.payment_method := contribution_method;
    end if;
    if new.payment_method = 'pix' and new.provider_payment_method_id is null then
      new.provider_payment_method_id := 'pix';
    end if;
  end if;
  if new.payment_method is distinct from contribution_method then
    raise exception 'payment_attempt_method_mismatch';
  end if;
  return new;
end $$;
revoke all on function public.guard_payment_attempt_method() from public, anon, authenticated;
create trigger payment_attempt_method_guard before insert or update on public.payment_attempts
  for each row execute function public.guard_payment_attempt_method();

create function public.guard_contribution_payment_method() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.payment_method is distinct from old.payment_method then
    raise exception 'contribution_payment_method_immutable';
  end if;
  return new;
end $$;
revoke all on function public.guard_contribution_payment_method() from public, anon, authenticated;
create trigger contribution_payment_method_guard before update on public.gift_contributions
  for each row execute function public.guard_contribution_payment_method();

create table public.payment_financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.payment_attempts(id) on delete restrict,
  payment_environment text not null check (payment_environment in ('test', 'production')),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  external_reference text not null check (length(external_reference) between 1 and 255
    and external_reference = btrim(external_reference) and external_reference !~ '[[:cntrl:]]'),
  kind text not null check (kind in ('refund', 'chargeback', 'chargeback_reversal')),
  amount numeric(10,2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  currency text not null default 'BRL' check (currency = 'BRL'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider, external_reference)
);
create index payment_adjustments_attempt_idx on public.payment_financial_adjustments(attempt_id);
alter table public.payment_financial_adjustments enable row level security;
revoke all on public.payment_financial_adjustments from public, anon, authenticated, service_role;
grant select, insert on public.payment_financial_adjustments to service_role;

create function public.guard_payment_financial_adjustment() returns trigger
language plpgsql set search_path = '' as $$
declare attempt public.payment_attempts;
declare contribution public.gift_contributions;
declare linked_id uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'financial_adjustment_append_only'; end if;
  select pa.contribution_id into linked_id from public.payment_attempts pa where pa.id = new.attempt_id;
  select * into contribution from public.gift_contributions gc where gc.id = linked_id for update;
  select * into attempt from public.payment_attempts pa where pa.id = new.attempt_id for update;
  if not found or contribution.id is null then raise exception 'payment_attempt_not_found'; end if;
  if attempt.payment_environment is distinct from new.payment_environment
    or contribution.payment_environment is distinct from new.payment_environment
    or attempt.provider is distinct from new.provider then
    raise exception 'payment_environment_mismatch';
  end if;
  -- Capture only. Applying adjustments to balances is a later, separate stage.
  return new;
end $$;
revoke all on function public.guard_payment_financial_adjustment() from public, anon, authenticated;
create trigger payment_adjustment_guard before insert or update or delete on public.payment_financial_adjustments
  for each row execute function public.guard_payment_financial_adjustment();
commit;
