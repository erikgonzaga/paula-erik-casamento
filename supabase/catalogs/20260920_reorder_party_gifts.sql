-- Reordena somente os sete presentes da categoria Festa.
-- Script idempotente para execucao manual; nao integra migrations nem db.seed.
begin;

-- Afasta temporariamente os sete registros da faixa 1..7 para evitar colisoes
-- durante a troca, inclusive se uma restricao unica for adicionada no futuro.
with bounds as (
  select coalesce(max(display_order), 0) + 100 as temporary_base
  from public.gifts
)
update public.gifts as gift
set display_order = bounds.temporary_base + desired.display_order
from bounds,
  (values
    ('ajudinha-ultimos-boletos', 1),
    ('docinhos-finos', 2),
    ('bolo-do-casamento', 3),
    ('maquina-de-fotos', 4),
    ('story-maker', 5),
    ('assessoria-do-casamento', 6),
    ('quadros-interativos', 7)
  ) as desired(slug, display_order)
where gift.category = 'party'
  and gift.slug = desired.slug;

update public.gifts as gift
set display_order = desired.display_order
from (values
  ('ajudinha-ultimos-boletos', 1),
  ('docinhos-finos', 2),
  ('bolo-do-casamento', 3),
  ('maquina-de-fotos', 4),
  ('story-maker', 5),
  ('assessoria-do-casamento', 6),
  ('quadros-interativos', 7)
) as desired(slug, display_order)
where gift.category = 'party'
  and gift.slug = desired.slug;

commit;
