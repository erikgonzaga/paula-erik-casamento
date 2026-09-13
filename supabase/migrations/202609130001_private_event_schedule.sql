begin;

alter table public.event_private_details
  add column if not exists reception_time text not null default '13h' check (length(reception_time) between 1 and 40),
  add column if not exists ceremony_time text not null default '16h' check (length(ceremony_time) between 1 and 40);

commit;
