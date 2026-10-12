begin;

-- Public refusals are final. Transitional RPC accepts complete old/new clients.
-- Existing declined rows are redundant input only, never updated. No backfill.
create or replace function public.save_invitation_rsvp(p_group_id uuid,p_guests jsonb,p_phone text,p_dietary text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.rsvps; was_update boolean; expected integer; total_active integer;
 supplied integer; changed integer; legacy_phone text;
begin
 perform id from public.invitation_groups where id=p_group_id and active for update;
 if not found then raise exception 'invitation_unavailable'; end if;
 if jsonb_typeof(p_guests) is distinct from 'array' then raise exception 'invalid_guests'; end if;
 -- Serialize guest state as well as group submissions before validation.
 perform id from public.guests where invitation_group_id=p_group_id and active order by id for update;
 select count(*) into expected from public.guests where invitation_group_id=p_group_id and active and attendance_status <> 'declined';
 select count(*) into total_active from public.guests where invitation_group_id=p_group_id and active;
 supplied := jsonb_array_length(p_guests);
 if supplied=0 or (supplied<>expected and supplied<>total_active) then raise exception 'invalid_guests'; end if;
 if exists(select 1 from jsonb_array_elements(p_guests) e
   where e->>'status' is null or e->>'status' not in ('confirmed','declined')
   or not exists(select 1 from public.guests g where g.id::text=e->>'id' and g.invitation_group_id=p_group_id and g.active)
   or exists(select 1 from public.guests g where g.id::text=e->>'id' and g.invitation_group_id=p_group_id
     and g.active and g.attendance_status='declined' and e->>'status'<>'declined')
 ) or (select count(distinct e->>'id') from jsonb_array_elements(p_guests) e)<>supplied
   or (select count(*) from public.guests g join jsonb_array_elements(p_guests) e on g.id::text=e->>'id'
     where g.invitation_group_id=p_group_id and g.active and g.attendance_status<>'declined')<>expected
 then raise exception 'invalid_guests'; end if;
 if exists(select 1 from public.guests g join jsonb_array_elements(p_guests) e on g.id::text=e->>'id'
   where g.invitation_group_id=p_group_id and g.active and g.attendance_status <> 'declined' and (
    (g.type='adult' and (nullif(btrim(e->>'phone'),'') is null or length(btrim(e->>'phone')) not between 8 and 32 or regexp_replace(e->>'phone','[^0-9]','','g') !~ '^[0-9]{8,15}$'))
    or (g.type='child' and nullif(btrim(e->>'phone'),'') is not null)
   )
 ) then raise exception 'invalid_phone'; end if;
 if p_dietary is null or length(p_dietary)>2000 or p_notes is null or length(p_notes)>2000 then raise exception 'invalid_fields'; end if;
 if expected=0 then
   -- Old clients may resend a fully refused invitation. Acknowledge without
   -- modifying any guest, group response, phone or timestamp.
   select * into result from public.rsvps where invitation_group_id=p_group_id;
   return jsonb_build_object('updated',true,'submitted_at',result.submitted_at,'updated_at',result.updated_at);
 end if;
 -- The legacy group phone must not be sourced from a redundant declined row.
 select nullif(btrim(e.value->>'phone'),'') into legacy_phone
 from jsonb_array_elements(p_guests) with ordinality e(value,position)
 join public.guests g on g.id::text=e.value->>'id'
 where g.invitation_group_id=p_group_id and g.active and g.attendance_status<>'declined' and g.type='adult'
 order by e.position limit 1;
 select exists(select 1 from public.rsvps where invitation_group_id=p_group_id) into was_update;
 update public.guests g set attendance_status=e->>'status', phone=case when g.type='adult' then nullif(btrim(e->>'phone'),'') else null end
 from jsonb_array_elements(p_guests) e where g.id::text=e->>'id' and g.invitation_group_id=p_group_id and g.active and g.attendance_status <> 'declined';
 get diagnostics changed = row_count;
 if changed<>expected then raise exception 'invalid_guests'; end if;
 insert into public.rsvps(invitation_group_id,phone,dietary_restrictions,notes)
 values(p_group_id,legacy_phone,p_dietary,p_notes)
 on conflict(invitation_group_id) do update set phone=excluded.phone,dietary_restrictions=excluded.dietary_restrictions,notes=excluded.notes
 returning * into result;
 return jsonb_build_object('updated',was_update,'submitted_at',result.submitted_at,'updated_at',result.updated_at);
end $$;

revoke all on function public.save_invitation_rsvp(uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.save_invitation_rsvp(uuid,jsonb,text,text,text) to service_role;

commit;
