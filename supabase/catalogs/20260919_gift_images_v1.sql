-- Imagens definitivas dos presentes regulares.
-- Revisar e executar manualmente no Supabase; este arquivo não integra migrations nem seeds.
-- Idempotente por slug e limitado exclusivamente à coluna image_url.
begin;

update public.gifts as gift
set image_url = images.image_url
from (
  values
  ('docinhos-finos', '/images/presentes/catalogo/docinhos-finos.png'),
  ('bolo-do-casamento', '/images/presentes/catalogo/bolo-do-casamento.png'),
  ('maquina-de-fotos', '/images/presentes/catalogo/maquina-de-fotos.png'),
  ('story-maker', '/images/presentes/catalogo/story-maker.png'),
  ('assessoria-do-casamento', '/images/presentes/catalogo/assessoria-do-casamento.png'),
  ('quadros-interativos', '/images/presentes/catalogo/quadros-interativos.png'),
  ('ajudinha-ultimos-boletos', '/images/presentes/catalogo/ajudinha-ultimos-boletos.png'),
  ('moveis-da-casa-nova', '/images/presentes/catalogo/moveis-da-casa-nova.png'),
  ('nossa-geladeira', '/images/presentes/catalogo/nossa-geladeira.png'),
  ('guarda-roupa-recem-casados', '/images/presentes/catalogo/guarda-roupa-recem-casados.png'),
  ('cama-casal-bipartida', '/images/presentes/catalogo/cama-casal-bipartida.png'),
  ('painel-tv-55', '/images/presentes/catalogo/painel-tv-55.png'),
  ('mesa-quatro-lugares', '/images/presentes/catalogo/mesa-quatro-lugares.png'),
  ('prateleiras-nosso-cantinho', '/images/presentes/catalogo/prateleiras-nosso-cantinho.png'),
  ('nosso-fogao', '/images/presentes/catalogo/nosso-fogao.png'),
  ('air-fryer', '/images/presentes/catalogo/air-fryer.png'),
  ('ferro-a-vapor', '/images/presentes/catalogo/ferro-a-vapor.png'),
  ('aspirador-de-po', '/images/presentes/catalogo/aspirador-de-po.png'),
  ('liquidificador', '/images/presentes/catalogo/liquidificador.png'),
  ('processador-eletrico', '/images/presentes/catalogo/processador-eletrico.png'),
  ('batedeira', '/images/presentes/catalogo/batedeira.png'),
  ('mixer', '/images/presentes/catalogo/mixer.png'),
  ('toalhas-banho-rosto', '/images/presentes/catalogo/toalhas-banho-rosto.png'),
  ('lencol-cama-queen', '/images/presentes/catalogo/lencol-cama-queen.png'),
  ('travesseiros-recem-casados', '/images/presentes/catalogo/travesseiros-recem-casados.png'),
  ('jogo-de-fronhas', '/images/presentes/catalogo/jogo-de-fronhas.png'),
  ('tapetes-cozinha', '/images/presentes/catalogo/tapetes-cozinha.png'),
  ('tapetes-banheiro', '/images/presentes/catalogo/tapetes-banheiro.png'),
  ('passadeira-nossa-casa', '/images/presentes/catalogo/passadeira-nossa-casa.png'),
  ('passagens-gramado', '/images/presentes/catalogo/passagens-gramado.png'),
  ('carro-gramado', '/images/presentes/catalogo/carro-gramado.png'),
  ('hospedagem-gramado', '/images/presentes/catalogo/hospedagem-gramado.png'),
  ('cafe-da-manha-gramado', '/images/presentes/catalogo/cafe-da-manha-gramado.png'),
  ('passeios-gramado', '/images/presentes/catalogo/passeios-gramado.png'),
  ('jantares-gramado', '/images/presentes/catalogo/jantares-gramado.png')
) as images(slug, image_url)
where gift.slug = images.slug
  and gift.image_url is distinct from images.image_url;

commit;
