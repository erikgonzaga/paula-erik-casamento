begin;
create table public.invitation_groups (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(name) between 1 and 150),
 slug text not null unique check (slug ~ '^[a-z0-9-]{20,150}$'),
 code text not null unique check (code ~ '^[A-Z0-9]{20,64}$'),
 active boolean not null default true,
 is_demo boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.guests (
 id uuid primary key default gen_random_uuid(),
 invitation_group_id uuid not null references public.invitation_groups(id) on delete cascade,
 name text not null check (length(name) between 1 and 150),
 type text not null default 'adult' check (type in ('adult','child')),
 active boolean not null default true,
 attendance_status text not null default 'pending' check (attendance_status in ('pending','confirmed','declined')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index guests_group_idx on public.guests(invitation_group_id);
create table public.rsvps (
 id uuid primary key default gen_random_uuid(),
 invitation_group_id uuid not null unique references public.invitation_groups(id) on delete cascade,
 phone text not null check (length(phone) between 8 and 32),
 dietary_restrictions text not null default '' check (length(dietary_restrictions)<=2000),
 notes text not null default '' check (length(notes)<=2000),
 submitted_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.event_private_details (
 id boolean primary key default true check (id),
 venue text not null default 'Buffet Napoleão — Espaço Praça',
 address text not null,
 parking text not null default 'Estacionamento ao lado, pago por hora.',
 valet text not null default 'Valet na porta: R$ 40,00 pelo período da festa.',
 updated_at timestamptz not null default now()
);
create table public.invitation_rate_limits (
 bucket text primary key,
 attempts integer not null,
 expires_at timestamptz not null
);
create index invitation_rate_expiry_idx on public.invitation_rate_limits(expires_at);
create function public.wedding_touch_updated_at() returns trigger language plpgsql
set search_path = '' as $$
begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger invitation_updated before update on public.invitation_groups for each row execute function public.wedding_touch_updated_at();
create trigger guest_updated before update on public.guests for each row execute function public.wedding_touch_updated_at();
create trigger rsvp_updated before update on public.rsvps for each row execute function public.wedding_touch_updated_at();
create trigger event_updated before update on public.event_private_details for each row execute function public.wedding_touch_updated_at();

alter table public.invitation_groups enable row level security;
alter table public.guests enable row level security;
alter table public.rsvps enable row level security;
alter table public.event_private_details enable row level security;
alter table public.invitation_rate_limits enable row level security;
-- Default deny: no visitor or future Auth user may access these tables directly.
revoke all on public.invitation_groups, public.guests, public.rsvps, public.event_private_details, public.invitation_rate_limits from public, anon, authenticated;
grant select,insert,update,delete on public.invitation_groups, public.guests, public.rsvps, public.event_private_details, public.invitation_rate_limits to service_role;

create function public.consume_invitation_limit(p_bucket text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare used integer;
begin
 if length(p_bucket)>100 or p_limit<1 or p_seconds<1 then raise exception 'invalid_limit'; end if;
 delete from public.invitation_rate_limits where expires_at < now() - interval '1 hour';
 insert into public.invitation_rate_limits(bucket,attempts,expires_at)
 values (p_bucket,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket) do update set
 attempts=case when invitation_rate_limits.expires_at<=now() then 1 else invitation_rate_limits.attempts+1 end,
 expires_at=case when invitation_rate_limits.expires_at<=now() then now()+make_interval(secs=>p_seconds) else invitation_rate_limits.expires_at end
 returning attempts into used;
 return used<=p_limit;
end $$;

-- A single transaction validates all guest IDs before changing any response.
create function public.save_invitation_rsvp(p_group_id uuid,p_guests jsonb,p_phone text,p_dietary text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.rsvps; was_update boolean; expected integer;
begin
 perform id from public.invitation_groups where id=p_group_id and active for update;
 if not found then raise exception 'invitation_unavailable'; end if;
 if jsonb_typeof(p_guests) is distinct from 'array' then raise exception 'invalid_guests'; end if;
 select count(*) into expected from public.guests where invitation_group_id=p_group_id and active;
 if expected=0 or jsonb_array_length(p_guests)<>expected then raise exception 'invalid_guests'; end if;
 if exists(select 1 from jsonb_array_elements(p_guests) e
   where e->>'status' is null or e->>'status' not in ('confirmed','declined')
   or not exists(select 1 from public.guests g where g.id::text=e->>'id' and g.invitation_group_id=p_group_id and g.active))
   or (select count(distinct e->>'id') from jsonb_array_elements(p_guests) e)<>expected
 then raise exception 'invalid_guests'; end if;
 if p_phone is null or length(p_phone) not between 8 and 32
   or p_dietary is null or length(p_dietary)>2000 or p_notes is null or length(p_notes)>2000
 then raise exception 'invalid_fields'; end if;
 select exists(select 1 from public.rsvps where invitation_group_id=p_group_id) into was_update;
 update public.guests g set attendance_status=e->>'status'
 from jsonb_array_elements(p_guests) e where g.id::text=e->>'id' and g.invitation_group_id=p_group_id and g.active;
 insert into public.rsvps(invitation_group_id,phone,dietary_restrictions,notes)
 values(p_group_id,p_phone,p_dietary,p_notes)
 on conflict(invitation_group_id) do update set phone=excluded.phone,dietary_restrictions=excluded.dietary_restrictions,notes=excluded.notes
 returning * into result;
 return jsonb_build_object('updated',was_update,'submitted_at',result.submitted_at,'updated_at',result.updated_at);
end $$;
revoke all on function public.wedding_touch_updated_at() from public,anon,authenticated;
revoke all on function public.consume_invitation_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.save_invitation_rsvp(uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_invitation_limit(text,integer,integer),public.save_invitation_rsvp(uuid,jsonb,text,text,text) to service_role;
commit;

