-- Development-only catalog. Run explicitly against a disposable/local database.
-- This file is not referenced by supabase/config.toml and must not be applied to production automatically.
insert into public.gifts
  (name, slug, description, category, price, image_url, display_order, gift_type)
values
  ('Mesa para os nossos domingos', 'mesa-domingos', 'Um gesto para os almoços demorados, as conversas e as novas memórias que queremos criar em casa.', 'house', 280.00, '/images/casal/pe-26.jpg', 10, 'regular'),
  ('Cantinho do café', 'cantinho-cafe', 'Para começar os dias devagar, com café quente e companhia boa.', 'house', 180.00, '/images/casal/pe-33.jpg', 20, 'regular'),
  ('Enxoval para o nosso lar', 'enxoval-lar', 'Um carinho para deixar o nosso quarto ainda mais acolhedor.', 'house', 240.00, '/images/casal/pe-32.jpg', 30, 'regular'),
  ('Combustível para novas estradas', 'combustivel-estradas', 'Uma contribuição para os próximos caminhos, paisagens e histórias a dois.', 'travel', 200.00, '/images/casal/pe-9.jpg', 40, 'regular'),
  ('Jantar em uma cidade nova', 'jantar-cidade-nova', 'Para brindar a vida em algum lugar que ainda vamos descobrir juntos.', 'travel', 320.00, '/images/casal/pe-22.jpg', 50, 'regular'),
  ('Uma experiência para recordar', 'experiencia-recordar', 'Para transformar uma viagem em uma lembrança que ficará conosco para sempre.', 'travel', 450.00, '/images/casal/pe-15.jpg', 60, 'regular'),
  ('Mala para novos capítulos', 'mala-novos-capitulos', 'Para acompanhar o que ainda vamos viver, perto ou longe de casa.', 'party', 390.00, '/images/casal/pe-6.jpg', 70, 'regular'),
  ('Um tempo só nosso', 'tempo-so-nosso', 'Um presente para celebrar o tempo compartilhado e tudo o que vem pela frente.', 'party', 260.00, '/images/casal/pe-12.jpg', 80, 'regular'),
  ('Detalhes para celebrar', 'detalhes-celebrar', 'Um pequeno gesto para os detalhes bonitos que queremos levar para a nossa rotina.', 'party', 150.00, '/images/casal/pe-33.jpg', 90, 'regular'),
  ('Moeda Bronze', 'moeda-bronze', 'Uma contribuição simbólica para seguir na estrada.', 'insanos', 100.00, '/images/presentes/moeda-bronze-final.png', 100, 'insanos'),
  ('Moeda Prata', 'moeda-prata', 'Um gesto especial para acompanhar o próximo capítulo.', 'insanos', 250.00, '/images/presentes/moeda-prata-final.png', 110, 'insanos'),
  ('Moeda Ouro', 'moeda-ouro', 'Uma grande força para esta nova caminhada.', 'insanos', 500.00, '/images/presentes/moeda-ouro-final.png', 120, 'insanos')
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  price = excluded.price,
  image_url = excluded.image_url,
  display_order = excluded.display_order,
  gift_type = excluded.gift_type;
