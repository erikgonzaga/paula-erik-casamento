begin;

-- Accept the private contribution UUID used by operational tooling while
-- preserving the idempotency-key lookup used by the server retry flow.
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
    and (
      p_idempotency_key is null
      or contribution.id = p_idempotency_key
      or contribution.idempotency_key = p_idempotency_key
    );
  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.expire_gift_contribution_pending(uuid)
  from public,anon,authenticated;
grant execute on function public.expire_gift_contribution_pending(uuid)
  to service_role;

commit;
