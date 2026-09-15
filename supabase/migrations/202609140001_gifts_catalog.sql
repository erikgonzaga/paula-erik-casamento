begin;

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  category text not null,
  price numeric(10,2) not null,
  image_url text,
  active boolean not null default true,
  featured boolean not null default false,
  display_order integer not null default 0,
  gift_type text not null default 'regular',
  allow_multiple boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gifts_name_not_blank check (length(btrim(name)) between 1 and 150),
  constraint gifts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 150),
  constraint gifts_category_allowed check (category in ('house', 'travel', 'clothing', 'insanos')),
  constraint gifts_price_positive check (price > 0),
  constraint gifts_image_url_not_blank check (image_url is null or length(btrim(image_url)) > 0),
  constraint gifts_display_order_nonnegative check (display_order >= 0),
  constraint gifts_type_allowed check (gift_type in ('regular', 'insanos')),
  constraint gifts_type_matches_category check (
    (gift_type = 'insanos' and category = 'insanos')
    or (gift_type = 'regular' and category in ('house', 'travel', 'clothing'))
  )
);

create index gifts_active_display_order_idx
  on public.gifts(display_order, id)
  where active;

create trigger gifts_updated
  before update on public.gifts
  for each row execute function public.wedding_touch_updated_at();

alter table public.gifts enable row level security;

revoke all on public.gifts from public, anon, authenticated;
grant select on public.gifts to anon, authenticated;
grant select, insert, update, delete on public.gifts to service_role;

create policy gifts_public_read_active
  on public.gifts
  for select
  to anon, authenticated
  using (active = true);

commit;
