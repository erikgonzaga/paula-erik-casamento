begin;

alter table public.gifts
  drop constraint gifts_category_allowed,
  drop constraint gifts_type_matches_category;

alter table public.gifts
  add constraint gifts_category_allowed
    check (category in ('house', 'travel', 'party', 'insanos')),
  add constraint gifts_type_matches_category
    check (
      (gift_type = 'regular' and category in ('house', 'travel', 'party'))
      or (gift_type = 'insanos' and category = 'insanos')
    );

commit;
