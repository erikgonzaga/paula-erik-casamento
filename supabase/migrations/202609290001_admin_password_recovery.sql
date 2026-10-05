-- Historical copy of the recovery schema already applied manually to Supabase.
-- Do not reapply this file to the remote project.
begin;

create table public.admin_password_recovery_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null unique references public.admin_users(user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint admin_password_recovery_expiry check (expires_at > created_at)
);
create index admin_password_recovery_sessions_expires_at_idx
  on public.admin_password_recovery_sessions(expires_at);
alter table public.admin_password_recovery_sessions enable row level security;
revoke all on public.admin_password_recovery_sessions from public, anon, authenticated, service_role;
grant select, insert, delete on public.admin_password_recovery_sessions to service_role;

create function public.register_admin_password_recovery_session(
  p_token_hash text, p_user_id uuid, p_expires_at timestamptz
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= pg_catalog.now() then
    raise exception 'invalid_admin_recovery_session' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_user_id and active) then
    raise exception 'admin_access_denied' using errcode = '42501';
  end if;
  delete from public.admin_password_recovery_sessions
    where expires_at <= pg_catalog.now() or user_id = p_user_id;
  insert into public.admin_password_recovery_sessions(token_hash, user_id, expires_at)
    values (p_token_hash, p_user_id, least(p_expires_at, pg_catalog.now() + interval '10 minutes'));
end;
$$;
revoke all on function public.register_admin_password_recovery_session(text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_admin_password_recovery_session(text, uuid, timestamptz)
  to service_role;

create function public.consume_admin_password_recovery_session(
  p_token_hash text, p_user_id uuid
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.admin_password_recovery_sessions
    where token_hash = p_token_hash and user_id = p_user_id
      and expires_at > pg_catalog.now()
      and exists (select 1 from public.admin_users
                  where admin_users.user_id = p_user_id and admin_users.active);
  if not found then return false; end if;
  -- The one-time authorization also revokes every local dashboard session.
  delete from public.admin_sessions where user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.consume_admin_password_recovery_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_admin_password_recovery_session(text, uuid)
  to service_role;

commit;
