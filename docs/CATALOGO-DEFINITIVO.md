# Catálogo definitivo — revisão v1

Estado atual: o casal confirmou o cadastro no Supabase. Na etapa de progresso real, a leitura pública confirmou 38 presentes ativos e 34 metas com arrecadação zero. O catálogo SQL não foi alterado nem reexecutado nessa etapa. O texto editorial de Gramado agora aparece no filtro Viagem.

Arquivo: `supabase/catalogs/20260917_gifts_definitive_v1.sql`. Seed definitivo manual, separado de migrations e dos seeds de desenvolvimento. Não executado nesta etapa, nem em banco local. As migrations 202609150001 e 202609170001 foram informadas pelo casal como aplicadas com sucesso; não foram alteradas.

São 38 presentes: 7 Festa, 22 Casa, 6 Viagem e 3 Insanos. Todos ativos, allow_multiple=true e featured=false. Há 34 metas, 1 contribuição livre e 3 valores fixos sem teto coletivo. A ordem segue exatamente a lista do casal, de 1 a 38.

## Resumo para revisão

| display_order | category | name | funding_mode | target_amount (R$) |
| --- | --- | --- | --- | --- |
| 1 | party | Docinhos finos para adoçar nosso grande dia | goal | 600.00 |
| 2 | party | O bolo do nosso casamento | goal | 800.00 |
| 3 | party | Máquina de fotos para guardar nossas memórias | goal | 1250.00 |
| 4 | party | Story Maker para registrar cada momento | goal | 1500.00 |
| 5 | party | Assessoria para tudo sair como planejamos | goal | 600.00 |
| 6 | party | Quadros interativos para nossas lembranças | goal | 200.00 |
| 7 | party | Uma ajudinha com os últimos boletos 😅 | open | null |
| 8 | house | Uma ajudinha para os móveis da casa nova | goal | 2000.00 |
| 9 | house | Nossa geladeira | goal | 3500.00 |
| 10 | house | Guarda-roupa dos recém-casados | goal | 2500.00 |
| 11 | house | Nossa cama de casal bipartida | goal | 2500.00 |
| 12 | house | Painel para nossa TV de 55" | goal | 800.00 |
| 13 | house | Mesa de 4 lugares | goal | 1200.00 |
| 14 | house | Prateleiras para nosso cantinho | goal | 400.00 |
| 15 | house | Nosso fogão | goal | 1500.00 |
| 16 | house | Air Fryer | goal | 500.00 |
| 17 | house | Ferro a vapor | goal | 250.00 |
| 18 | house | Aspirador de pó | goal | 500.00 |
| 19 | house | Liquidificador | goal | 250.00 |
| 20 | house | Processador elétrico | goal | 350.00 |
| 21 | house | Batedeira | goal | 400.00 |
| 22 | house | Mixer | goal | 250.00 |
| 23 | house | Jogo de toalhas de banho e rosto | goal | 300.00 |
| 24 | house | Jogo de lençol para cama Queen | goal | 350.00 |
| 25 | house | Travesseiros dos recém-casados | goal | 300.00 |
| 26 | house | Jogo de fronhas | goal | 150.00 |
| 27 | house | Jogo de tapetes para cozinha | goal | 200.00 |
| 28 | house | Jogo de tapetes para banheiro | goal | 180.00 |
| 29 | house | Passadeira para nossa casa | goal | 250.00 |
| 30 | travel | Um pedacinho das nossas passagens | goal | 2500.00 |
| 31 | travel | Nosso carro em Gramado | goal | 1500.00 |
| 32 | travel | Nossa hospedagem em Gramado | goal | 2500.00 |
| 33 | travel | Café da manhã dos recém-casados | goal | 500.00 |
| 34 | travel | Passeios especiais em Gramado | goal | 1500.00 |
| 35 | travel | Jantares românticos em Gramado | goal | 800.00 |
| 36 | insanos | Presente Insano — Medalha Bronze | fixed | 75.00 |
| 37 | insanos | Presente Insano — Medalha Prata | fixed | 150.00 |
| 38 | insanos | Presente Insano — Medalha Ouro | fixed | 225.00 |

## Descrições

As descrições dos itens 1–6 e 8–29 são propostas novas. O item 7 e os itens 30–35 preservam integralmente os textos enviados pelo casal. As três medalhas mantêm as descrições aprovadas já existentes.

1. **Docinhos finos para adoçar nosso grande dia** — Um carinho para adoçar os encontros e as lembranças do nosso grande dia.

2. **O bolo do nosso casamento** — Para celebrar com doçura o começo de mais um capítulo da nossa história.

3. **Máquina de fotos para guardar nossas memórias** — Para guardar os sorrisos, os abraços e os encontros que tornarão esse dia inesquecível.

4. **Story Maker para registrar cada momento** — Para reviver os pequenos momentos e toda a emoção do nosso grande dia.

5. **Assessoria para tudo sair como planejamos** — Uma ajuda para vivermos cada instante com tranquilidade, cercados de quem amamos.

6. **Quadros interativos para nossas lembranças** — Para reunir palavras, gestos e lembranças de quem faz parte da nossa caminhada.

7. **Uma ajudinha com os últimos boletos 😅** — O casamento está chegando, o amor está em dia... os boletos também. Escolha quanto quiser contribuir para dar aquela força final aos noivos.

8. **Uma ajudinha para os móveis da casa nova** — Para dar forma ao nosso cantinho e acolher os dias que vamos viver juntos.

9. **Nossa geladeira** — Uma contribuição para os sabores, os encontros e a rotina do nosso novo lar.

10. **Guarda-roupa dos recém-casados** — Para acomodar nossos pertences e abrir espaço para uma vida compartilhada.

11. **Nossa cama de casal bipartida** — Para descansar lado a lado e renovar os sonhos a cada novo dia.

12. **Painel para nossa TV de 55"** — Para compor nosso cantinho de filmes, conversas e tardes sem pressa.

13. **Mesa de 4 lugares** — Para dividir refeições, receber carinho e criar novas memórias à mesa.

14. **Prateleiras para nosso cantinho** — Para acolher livros, lembranças e os detalhes que contam a nossa história.

15. **Nosso fogão** — Para as receitas a dois e os aromas que vão fazer da casa o nosso lar.

16. **Air Fryer** — Uma ajuda para preparar os sabores do dia a dia e aproveitar mais tempo juntos.

17. **Ferro a vapor** — Um cuidado com os pequenos detalhes da rotina que estamos construindo a dois.

18. **Aspirador de pó** — Para cuidar do nosso cantinho e deixar mais tempo para os bons momentos juntos.

19. **Liquidificador** — Para os sucos, as receitas e as pequenas descobertas da nossa cozinha.

20. **Processador elétrico** — Uma ajuda para preparar novas receitas e compartilhar o prazer de cozinhar.

21. **Batedeira** — Para os bolos de fim de tarde e as receitas que ainda vamos aprender juntos.

22. **Mixer** — Para experimentar sabores e dar nosso toque às refeições do dia a dia.

23. **Jogo de toalhas de banho e rosto** — Um carinho para trazer aconchego aos pequenos momentos da nossa rotina.

24. **Jogo de lençol para cama Queen** — Para noites acolhedoras e manhãs tranquilas no nosso novo lar.

25. **Travesseiros dos recém-casados** — Para repousar os pensamentos e seguir sonhando juntos.

26. **Jogo de fronhas** — Um detalhe de carinho para deixar nosso descanso ainda mais acolhedor.

27. **Jogo de tapetes para cozinha** — Para trazer aconchego ao lugar onde vamos compartilhar tantos sabores.

28. **Jogo de tapetes para banheiro** — Um cuidado a mais para tornar nosso cantinho confortável e acolhedor.

29. **Passadeira para nossa casa** — Para dar um toque de aconchego aos caminhos do nosso lar.

30. **Um pedacinho das nossas passagens** — Ajude os recém-casados a começarem essa viagem rumo a Gramado.

31. **Nosso carro em Gramado** — Uma ajudinha para alugarmos o carro e explorarmos juntos cada cantinho da viagem.

32. **Nossa hospedagem em Gramado** — Ajude a tornar nossa estadia em Gramado ainda mais especial.

33. **Café da manhã dos recém-casados** — Porque começar o dia juntinhos e com um bom café também faz parte da viagem.

34. **Passeios especiais em Gramado** — Faça parte de uma das experiências que vamos guardar na memória dessa viagem.

35. **Jantares românticos em Gramado** — Um jantar especial para celebrarmos essa nova fase da nossa vida.

36. **Presente Insano — Medalha Bronze** — Uma contribuição simbólica para seguir na estrada.

37. **Presente Insano — Medalha Prata** — Um gesto especial para acompanhar o próximo capítulo.

38. **Presente Insano — Medalha Ouro** — Uma grande força para esta nova caminhada.

## Texto editorial de Viagem

Nossa próxima aventura começa em Gramado.
Entre passeios, cafés, paisagens e momentos a dois, queremos construir
lembranças que levaremos para toda a vida. Se quiser fazer parte dessa
viagem, escolha um dos nossos sonhos e contribua com o valor que desejar.

Texto preservado para futura aplicação editorial; não foi inserido em um presente nem criada coluna/tabela de categorias. A interface atual não possui campo de texto editorial por categoria.

## Imagens e identidade

Os 35 presentes regulares possuem imagens definitivas em `public/images/presentes/catalogo`, nomeadas pelo slug estável. O catálogo aponta `image_url` para esses assets. O componente continua renderizando `Image` condicionalmente; o wrapper dos cards mantém `aspect-ratio` e fundo `var(--sand)`, e o modal mantém `min-height`/fundo, preservando o fallback caso um registro futuro não possua imagem.

As medalhas preservam os caminhos locais moeda-bronze-final.png, moeda-prata-final.png e moeda-ouro-final.png, e os slugs moeda-bronze/moeda-prata/moeda-ouro. Esses slugs também selecionam as cores dos botões: não devem ser trocados casualmente. Os nomes completos pedidos foram mantidos; como são mais longos que os anteriores, revisar a quebra dos títulos Insanos em uma futura prévia antes de publicar. Nenhum CSS, componente ou asset foi alterado nesta etapa.

Referências visuais futuras da Casa: eletrodomésticos preferencialmente pretos; cama, mesa e banho em bege, marrom, branco, off-white e caramelo. Não são campos de banco.

## Idempotência e execução futura

ON CONFLICT (slug) DO UPDATE usa a constraint única existente e torna o catálogo a fonte de verdade para os 38 slugs listados. Atualiza display_order, category, name, funding_mode, target_amount, description, image_url, gift_type, active, allow_multiple e featured. Preserva id, created_at e relacionamentos pelo UUID; updated_at é atualizado pelo trigger existente. Os slugs permanecem estáveis. O conteúdo dos 38 registros foi aprovado pelo casal e não foi alterado neste refinamento.

Mesmo que os slugs das moedas já existam, Bronze/Prata/Ouro serão sincronizados para 75/150/225. `image_url` também é sincronizado para as imagens definitivas dos 38 presentes. Registros extras não são removidos ou desativados. O casal informou `gift_contributions` vazia no cadastro inicial; não há lógica para alterar ou excluir contribuições. Se houver contribuições, revisar alterações de metas/modalidades antes de reexecutar. Não executar o seed fictício para completar o catálogo.

O SQL inclui BEGIN/COMMIT para atomicidade, insere/atualiza somente public.gifts e não muda schema, RLS ou contribuições. Não está listado no supabase/config.toml, não é importado pela aplicação e não será aplicado por db push.

## Validação desta etapa

Revisão estática de 38 registros, slugs únicos e válidos, categorias/tipos/modalidades, metas e caminhos locais. SQL não executado; conformidade examinada contra as constraints versionadas. Nenhum acesso ao Supabase, db push ou deploy.
