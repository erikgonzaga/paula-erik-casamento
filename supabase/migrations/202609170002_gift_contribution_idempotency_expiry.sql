begin;

alter table public.gift_contributions
  add column idempotency_key uuid,
  add column request_fingerprint text,
  add column expires_at timestamptz;

-- Existing rows predate browser idempotency. Their own UUIDs become stable,
-- unique legacy keys; the synthetic fingerprint contains no personal data.
update public.gift_contributions
set idempotency_key = id,
    request_fingerprint = md5('legacy:a:' || id::text) || md5('legacy:b:' || id::text),
    expires_at = created_at + interval '15 minutes';

alter table public.gift_contributions
  alter column idempotency_key set not null,
  alter column request_fingerprint set not null,
  alter column expires_at set default (now() + interval '15 minutes'),
  alter column expires_at set not null,
  add constraint contributions_request_fingerprint_valid check (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  add constraint contributions_expiry_consistent check (
    expires_at = created_at + interval '15 minutes'
  );

create unique index contributions_idempotency_key_uidx
  on public.gift_contributions(idempotency_key);

create index contributions_pending_expiry_idx
  on public.gift_contributions(expires_at)
  where payment_status = 'pending';

alter table public.gift_contributions
  drop constraint gift_contributions_payment_status_check,
  add constraint contributions_payment_status_allowed check (
    payment_status in ('pending','confirmed','cancelled','failed','expired')
  );

create function public.protect_gift_contribution_attempt_metadata() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'contribution_attempt_metadata_immutable';
  end if;
  return new;
end $$;

revoke all on function public.protect_gift_contribution_attempt_metadata()
  from public,anon,authenticated;

create trigger contribution_attempt_metadata_immutable
  before update on public.gift_contributions
  for each row execute function public.protect_gift_contribution_attempt_metadata();

create function public.expire_gift_contribution_pending(
  p_idempotency_key uuid default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.gift_contributions
  set payment_status = 'expired'
  where payment_status = 'pending'
    and expires_at <= now()
    and (p_idempotency_key is null or idempotency_key = p_idempotency_key);
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.expire_gift_contribution_pending(uuid)
  from public,anon,authenticated;
grant execute on function public.expire_gift_contribution_pending(uuid)
  to service_role;

commit;
