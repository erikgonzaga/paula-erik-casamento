-- Manual application only. Rotates every existing code once, without logging codes.
begin;
set local lock_timeout = '5s';
lock table public.invitation_groups in access exclusive mode;
lock table public.guests, public.rsvps in share mode;

do $$
declare
  groups_before jsonb;
  guests_before jsonb;
  rsvps_before jsonb;
  old_codes text[];
  rsvp_count bigint;
  group_row record;
  candidate text;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  random_byte integer;
  tries integer;
begin
  select count(*) into rsvp_count from public.rsvps;
  raise notice 'Existing RSVPs: %. All responses will be preserved.', rsvp_count;

  -- This specific constraint is also the transactional reexecution marker.
  if exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invitation_groups'::regclass
      and conname = 'invitation_groups_unambiguous_code_check') then
    if not exists (select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.invitation_groups'::regclass
        and conname = 'invitation_groups_unambiguous_code_check'
        and contype = 'c' and convalidated
        and position('^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'
          in pg_catalog.pg_get_constraintdef(oid)) > 0) then
      raise exception 'Unexpected code constraint; manual review required';
    end if;
    raise notice 'Unambiguous code rotation already applied; no codes changed.';
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) - 'code' order by g.id), '[]'::jsonb),
    coalesce(array_agg(g.code), array[]::text[])
    into groups_before, old_codes from public.invitation_groups g;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb)
    into guests_before from public.guests g;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
    into rsvps_before from public.rsvps r;

  if not exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.invitation_groups'::regclass
      and tgname = 'invitation_updated' and tgenabled = 'O') then
    raise exception 'Unexpected invitation_updated trigger state; review before rotating codes';
  end if;
  alter table public.invitation_groups disable trigger invitation_updated;
  alter table public.invitation_groups drop constraint invitation_groups_code_check;

  for group_row in select id from public.invitation_groups order by id loop
    tries := 0;
    loop
      tries := tries + 1;
      if tries > 1000 then raise exception 'Unable to allocate a unique invitation code'; end if;
      candidate := '';
      while length(candidate) < 6 loop
        -- UUID v4 first byte uses the cryptographic random source, not random().
        random_byte := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 2))::bit(8)::integer;
        -- Rejection sampling over the 31-character alphabet avoids modulo bias.
        if random_byte < 248 then
          candidate := candidate || substr(alphabet, (random_byte % length(alphabet)) + 1, 1);
        end if;
      end loop;
      exit when not (candidate = any(old_codes))
        and not exists (select 1 from public.invitation_groups where code = candidate);
    end loop;
    update public.invitation_groups set code = candidate where id = group_row.id;
  end loop;

  alter table public.invitation_groups add constraint invitation_groups_unambiguous_code_check
    check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');
  alter table public.invitation_groups enable trigger invitation_updated;
  -- Existing UNIQUE and NOT NULL protections remain enabled throughout.
  if groups_before is distinct from (select coalesce(
    jsonb_agg(to_jsonb(g) - 'code' order by g.id), '[]'::jsonb) from public.invitation_groups g)
    or guests_before is distinct from (select coalesce(
    jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) from public.guests g)
    or rsvps_before is distinct from (select coalesce(
    jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from public.rsvps r) then
    raise exception 'Unexpected changes outside invitation codes; rolling back';
  end if;
end;
$$;
commit;
