-- Catalogo definitivo v1: somente para revisao; executar manualmente apos aprovacao.
-- Requer as migrations 202609150001 e 202609170001 ja aplicadas.
-- Nao integra db.seed nem migrations. Nao usar o seed ficticio.
-- Reexecucao sincroniza os campos do catalogo, preservando id e created_at.
-- Nao exclui registros extras nem altera contribuicoes.
begin;

insert into public.gifts (
  display_order, category, name, slug, funding_mode, target_amount,
  description, image_url, gift_type, active, allow_multiple, featured
)
values
  (1, 'party', 'Docinhos finos para adoçar nosso grande dia', 'docinhos-finos', 'goal', 600.00, 'Um carinho para adoçar os encontros e as lembranças do nosso grande dia.', null, 'regular', true, true, false),
  (2, 'party', 'O bolo do nosso casamento', 'bolo-do-casamento', 'goal', 800.00, 'Para celebrar com doçura o começo de mais um capítulo da nossa história.', null, 'regular', true, true, false),
  (3, 'party', 'Máquina de fotos para guardar nossas memórias', 'maquina-de-fotos', 'goal', 1250.00, 'Para guardar os sorrisos, os abraços e os encontros que tornarão esse dia inesquecível.', null, 'regular', true, true, false),
  (4, 'party', 'Story Maker para registrar cada momento', 'story-maker', 'goal', 1500.00, 'Para reviver os pequenos momentos e toda a emoção do nosso grande dia.', null, 'regular', true, true, false),
  (5, 'party', 'Assessoria para tudo sair como planejamos', 'assessoria-do-casamento', 'goal', 600.00, 'Uma ajuda para vivermos cada instante com tranquilidade, cercados de quem amamos.', null, 'regular', true, true, false),
  (6, 'party', 'Quadros interativos para nossas lembranças', 'quadros-interativos', 'goal', 200.00, 'Para reunir palavras, gestos e lembranças de quem faz parte da nossa caminhada.', null, 'regular', true, true, false),
  (7, 'party', 'Uma ajudinha com os últimos boletos 😅', 'ajudinha-ultimos-boletos', 'open', null, 'O casamento está chegando, o amor está em dia... os boletos também.
Escolha quanto quiser contribuir para dar aquela força final aos noivos.', null, 'regular', true, true, false),
  (8, 'house', 'Uma ajudinha para os móveis da casa nova', 'moveis-da-casa-nova', 'goal', 2000.00, 'Para dar forma ao nosso cantinho e acolher os dias que vamos viver juntos.', null, 'regular', true, true, false),
  (9, 'house', 'Nossa geladeira', 'nossa-geladeira', 'goal', 3500.00, 'Uma contribuição para os sabores, os encontros e a rotina do nosso novo lar.', null, 'regular', true, true, false),
  (10, 'house', 'Guarda-roupa dos recém-casados', 'guarda-roupa-recem-casados', 'goal', 2500.00, 'Para acomodar nossos pertences e abrir espaço para uma vida compartilhada.', null, 'regular', true, true, false),
  (11, 'house', 'Nossa cama de casal bipartida', 'cama-casal-bipartida', 'goal', 2500.00, 'Para descansar lado a lado e renovar os sonhos a cada novo dia.', null, 'regular', true, true, false),
  (12, 'house', 'Painel para nossa TV de 55"', 'painel-tv-55', 'goal', 800.00, 'Para compor nosso cantinho de filmes, conversas e tardes sem pressa.', null, 'regular', true, true, false),
  (13, 'house', 'Mesa de 4 lugares', 'mesa-quatro-lugares', 'goal', 1200.00, 'Para dividir refeições, receber carinho e criar novas memórias à mesa.', null, 'regular', true, true, false),
  (14, 'house', 'Prateleiras para nosso cantinho', 'prateleiras-nosso-cantinho', 'goal', 400.00, 'Para acolher livros, lembranças e os detalhes que contam a nossa história.', null, 'regular', true, true, false),
  (15, 'house', 'Nosso fogão', 'nosso-fogao', 'goal', 1500.00, 'Para as receitas a dois e os aromas que vão fazer da casa o nosso lar.', null, 'regular', true, true, false),
  (16, 'house', 'Air Fryer', 'air-fryer', 'goal', 500.00, 'Uma ajuda para preparar os sabores do dia a dia e aproveitar mais tempo juntos.', null, 'regular', true, true, false),
  (17, 'house', 'Ferro a vapor', 'ferro-a-vapor', 'goal', 250.00, 'Um cuidado com os pequenos detalhes da rotina que estamos construindo a dois.', null, 'regular', true, true, false),
  (18, 'house', 'Aspirador de pó', 'aspirador-de-po', 'goal', 500.00, 'Para cuidar do nosso cantinho e deixar mais tempo para os bons momentos juntos.', null, 'regular', true, true, false),
  (19, 'house', 'Liquidificador', 'liquidificador', 'goal', 250.00, 'Para os sucos, as receitas e as pequenas descobertas da nossa cozinha.', null, 'regular', true, true, false),
  (20, 'house', 'Processador elétrico', 'processador-eletrico', 'goal', 350.00, 'Uma ajuda para preparar novas receitas e compartilhar o prazer de cozinhar.', null, 'regular', true, true, false),
  (21, 'house', 'Batedeira', 'batedeira', 'goal', 400.00, 'Para os bolos de fim de tarde e as receitas que ainda vamos aprender juntos.', null, 'regular', true, true, false),
  (22, 'house', 'Mixer', 'mixer', 'goal', 250.00, 'Para experimentar sabores e dar nosso toque às refeições do dia a dia.', null, 'regular', true, true, false),
  (23, 'house', 'Jogo de toalhas de banho e rosto', 'toalhas-banho-rosto', 'goal', 300.00, 'Um carinho para trazer aconchego aos pequenos momentos da nossa rotina.', null, 'regular', true, true, false),
  (24, 'house', 'Jogo de lençol para cama Queen', 'lencol-cama-queen', 'goal', 350.00, 'Para noites acolhedoras e manhãs tranquilas no nosso novo lar.', null, 'regular', true, true, false),
  (25, 'house', 'Travesseiros dos recém-casados', 'travesseiros-recem-casados', 'goal', 300.00, 'Para repousar os pensamentos e seguir sonhando juntos.', null, 'regular', true, true, false),
  (26, 'house', 'Jogo de fronhas', 'jogo-de-fronhas', 'goal', 150.00, 'Um detalhe de carinho para deixar nosso descanso ainda mais acolhedor.', null, 'regular', true, true, false),
  (27, 'house', 'Jogo de tapetes para cozinha', 'tapetes-cozinha', 'goal', 200.00, 'Para trazer aconchego ao lugar onde vamos compartilhar tantos sabores.', null, 'regular', true, true, false),
  (28, 'house', 'Jogo de tapetes para banheiro', 'tapetes-banheiro', 'goal', 180.00, 'Um cuidado a mais para tornar nosso cantinho confortável e acolhedor.', null, 'regular', true, true, false),
  (29, 'house', 'Passadeira para nossa casa', 'passadeira-nossa-casa', 'goal', 250.00, 'Para dar um toque de aconchego aos caminhos do nosso lar.', null, 'regular', true, true, false),
  (30, 'travel', 'Um pedacinho das nossas passagens', 'passagens-gramado', 'goal', 2500.00, 'Ajude os recém-casados a começarem essa viagem rumo a Gramado.', null, 'regular', true, true, false),
  (31, 'travel', 'Nosso carro em Gramado', 'carro-gramado', 'goal', 1500.00, 'Uma ajudinha para alugarmos o carro e explorarmos juntos cada cantinho da viagem.', null, 'regular', true, true, false),
  (32, 'travel', 'Nossa hospedagem em Gramado', 'hospedagem-gramado', 'goal', 2500.00, 'Ajude a tornar nossa estadia em Gramado ainda mais especial.', null, 'regular', true, true, false),
  (33, 'travel', 'Café da manhã dos recém-casados', 'cafe-da-manha-gramado', 'goal', 500.00, 'Porque começar o dia juntinhos e com um bom café também faz parte da viagem.', null, 'regular', true, true, false),
  (34, 'travel', 'Passeios especiais em Gramado', 'passeios-gramado', 'goal', 1500.00, 'Faça parte de uma das experiências que vamos guardar na memória dessa viagem.', null, 'regular', true, true, false),
  (35, 'travel', 'Jantares românticos em Gramado', 'jantares-gramado', 'goal', 800.00, 'Um jantar especial para celebrarmos essa nova fase da nossa vida.', null, 'regular', true, true, false),
  (36, 'insanos', 'Presente Insano — Medalha Bronze', 'moeda-bronze', 'fixed', 75.00, 'Uma contribuição simbólica para seguir na estrada.', '/images/presentes/moeda-bronze-final.png', 'insanos', true, true, false),
  (37, 'insanos', 'Presente Insano — Medalha Prata', 'moeda-prata', 'fixed', 150.00, 'Um gesto especial para acompanhar o próximo capítulo.', '/images/presentes/moeda-prata-final.png', 'insanos', true, true, false),
  (38, 'insanos', 'Presente Insano — Medalha Ouro', 'moeda-ouro', 'fixed', 225.00, 'Uma grande força para esta nova caminhada.', '/images/presentes/moeda-ouro-final.png', 'insanos', true, true, false)
on conflict (slug) do update set
  display_order = excluded.display_order,
  category = excluded.category,
  name = excluded.name,
  funding_mode = excluded.funding_mode,
  target_amount = excluded.target_amount,
  description = excluded.description,
  image_url = excluded.image_url,
  gift_type = excluded.gift_type,
  active = excluded.active,
  allow_multiple = excluded.allow_multiple,
  featured = excluded.featured;

commit;
