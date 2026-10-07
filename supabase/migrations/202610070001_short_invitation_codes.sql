-- Manual application: rotates invitation codes only. Old printed codes stop working.
begin;
set local lock_timeout = '5s';

lock table public.invitation_groups in access exclusive mode;
lock table public.guests, public.rsvps in share mode;

do $$
declare
  groups_before jsonb;
  guests_before jsonb;
  rsvps_before jsonb;
  rsvp_count bigint;
  group_row record;
  candidate text;
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  random_byte integer;
  tries integer;
begin
  -- Read existing responses before touching codes. Never delete/recreate RSVP data.
  select count(*) into rsvp_count from public.rsvps;
  raise notice 'Existing RSVPs: %. All responses will be preserved.', rsvp_count;
  select coalesce(jsonb_agg(to_jsonb(g) - 'code' order by g.id), '[]'::jsonb)
    into groups_before from public.invitation_groups g;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb)
    into guests_before from public.guests g;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
    into rsvps_before from public.rsvps r;

  if not exists (select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.invitation_groups'::regclass
      and tgname = 'invitation_updated' and tgenabled = 'O') then
    raise exception 'Unexpected invitation_updated trigger state; review before rotating codes';
  end if;
  -- Preserve updated_at too: only code may change.
  alter table public.invitation_groups disable trigger invitation_updated;
  alter table public.invitation_groups drop constraint invitation_groups_code_check;

  for group_row in select id from public.invitation_groups
    where code !~ '^[A-Z0-9]{6}$' order by id loop
    tries := 0;
    loop
      tries := tries + 1;
      if tries > 1000 then raise exception 'Unable to allocate a unique invitation code'; end if;
      candidate := '';
      while length(candidate) < 6 loop
        -- UUID v4 random first byte. Rejection sampling avoids modulo bias.
        random_byte := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 2))::bit(8)::integer;
        if random_byte < 252 then
          candidate := candidate || substr(alphabet, (random_byte % 36) + 1, 1);
        end if;
      end loop;
      exit when not exists (select 1 from public.invitation_groups where code = candidate);
    end loop;
    update public.invitation_groups set code = candidate where id = group_row.id;
  end loop;

  alter table public.invitation_groups add constraint invitation_groups_code_check
    check (code ~ '^[A-Z0-9]{6}$');
  alter table public.invitation_groups enable trigger invitation_updated;
  -- The existing UNIQUE constraint remains enabled throughout.
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
