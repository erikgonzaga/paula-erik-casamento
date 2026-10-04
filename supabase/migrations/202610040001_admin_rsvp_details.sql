begin;

-- Keep the nominal RSVP list separate from the dashboard aggregates.
create function public.get_admin_rsvp_details(p_user_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.admin_users where user_id=p_user_id and active) then
    raise exception 'admin_access_denied' using errcode='42501';
  end if;

  with real_guests as (
    select g.id, g.name, g.type, g.attendance_status,
      case when g.type='adult' then g.phone else null end as phone,
      ig.id as group_id, ig.name as group_name,
      r.submitted_at, r.dietary_restrictions, r.notes
    from public.invitation_groups ig
    join public.guests g on g.invitation_group_id=ig.id and g.active
    left join public.rsvps r on r.invitation_group_id=ig.id
    where ig.active and not ig.is_demo
  )
  select jsonb_build_object(
    'generated_at', now(),
    'summary', jsonb_build_object(
      'total', count(*),
      'confirmed', count(*) filter(where attendance_status='confirmed'),
      'declined', count(*) filter(where attendance_status='declined'),
      'pending', count(*) filter(where attendance_status='pending')
    ),
    'guests', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'type', type, 'attendance_status', attendance_status, 'phone', phone,
      'group_id', group_id, 'group_name', group_name,
      'submitted_at', submitted_at,
      'dietary_restrictions', dietary_restrictions, 'notes', notes
    ) order by group_name, group_id, name, id), '[]'::jsonb)
  ) into result from real_guests;
  return result;
end $$;

revoke all on function public.get_admin_rsvp_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_rsvp_details(uuid) to service_role;

commit;
