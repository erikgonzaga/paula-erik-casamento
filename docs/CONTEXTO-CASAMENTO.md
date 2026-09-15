# Contexto do casamento e decisões do projeto

## Visão geral

Este é o site do casamento de **Paula e Erik**, marcado para **21 de novembro de 2026**. A recepção começa às **13h**, no horário de Brasília. A linguagem central é “caminhada”: o casal se conheceu em uma trilha na Pedra do Elefante, construiu a relação passo a passo, enfrentou a recuperação de um grave acidente de moto e prepara o casamento como o começo de uma nova etapa.

Referências textuais recorrentes:

- “Uma vida. Uma caminhada.”
- “Caminhando juntos.”
- “Eu escolhi você.”
- “A trilha foi apenas o primeiro passo.”
- Eclesiastes 4:12.

O tom deve ser íntimo, acolhedor, romântico e sóbrio. O site não deve soar como marketplace, portal corporativo ou tema genérico de casamento.

## Linha narrativa confirmada

| Data | Marco |
| --- | --- |
| 23/01/2023 | Encontro na trilha da Pedra do Elefante. |
| 19/02/2023 | Início oficial do relacionamento. |
| 23/12/2024 | Pedido de casamento. |
| 18/12/2025 | Acidente de moto de Erik e início de um período de recuperação e reorganização dos planos. |
| 21/11/2026 | Casamento e início do novo capítulo. |

O texto integral está em `src/content/story.json`. Evite reescrevê-lo ou resumir passagens sensíveis sem solicitação direta do casal.

## Fases do desenvolvimento

### Fase 1 — Home e identidade

Implementada e aprovada como base visual. Inclui:

- marca oficial, navegação e hero;
- contagem regressiva;
- seção “Nossa história” com fotografias, cinco marcos e texto integral expansível;
- seção “Eu escolhi você”;
- pessoas especiais;
- informações públicas mínimas do grande dia;
- acesso ao RSVP e à lista de presentes;
- fotografia final e arte de rodapé.

### Fase 2 — convite fechado e RSVP

Implementada no código com Supabase, migrations, sessão assinada, RLS, rate limiting e testes. O fluxo aceita código ou slug, carrega somente integrantes previamente cadastrados e permite editar respostas já salvas.

A conversa registra testes do fluxo real em produção, inclusive uma correção para códigos digitados em minúsculas. Isso indica que houve publicação e conexão remota depois da documentação antiga. Em um novo computador, confirme o estado atual da Vercel e das migrations no Supabase antes de operar dados reais. Não presuma que o conteúdo de `FASE-2.md` na raiz ainda descreve o ambiente remoto.

### Fase 3 — Lista de Presentes

A estrutura visual está implementada em `/presentes`:

- hero editorial;
- filtros sem recarregar a página;
- nove presentes mockados;
- detalhe em modal;
- seção especial “Presentes Insanos”.

Não há pagamento, PIX, banco de presentes, estoque ou controle de compra. Os botões comuns apenas mostram uma mensagem de “em breve”; os botões Insanos ainda não executam contribuição.

### Fases futuras

- Integração real de presentes e meios de contribuição.
- Administração protegida para convidados, convites, RSVP e presentes.
- Gestão de conteúdo, se ainda desejada.
- Auditoria final, publicação consolidada e domínio.

## Privacidade do evento

A Home pública pode exibir somente:

- data: 21 de novembro de 2026;
- recepção às 13h;
- cidade: São Bernardo do Campo — SP.

O local exato, endereço, horário da troca de alianças, estacionamento, valet e demais orientações pertencem a `event_private_details`. Esses dados devem ser buscados no servidor e entregues ao navegador somente após uma sessão de convite válida.

Ocultar conteúdo por CSS não é proteção. Dados privados não podem existir no HTML público, metadata, JSON-LD, props de componentes públicos, atributos invisíveis ou respostas enviadas antes da validação.

O endereço de produção informado durante o desenvolvimento é `https://paula-erik-casamento.vercel.app`. A variável `APP_ORIGIN` do ambiente de produção deve corresponder à origem efetivamente publicada.

## Decisões consolidadas

- A ordem da marca é **Paula & Erik**.
- `Logo.png` é o logotipo oficial em navbar, hero e áreas de marca.
- O hero deve compor “UMA VIDA. UMA CAMINHADA.”, o logo e sua própria data interna; não repetir os nomes digitados abaixo.
- A fotografia final da Home é `pe-26.jpg`, horizontal. A ideia anterior de usar `pe-33.jpg` nessa posição foi descartada.
- No mobile, os blocos da história seguem fluxo vertical e nenhuma fotografia narrativa pode desaparecer. O capítulo com a foto junto à janela permanece visível.
- O ramo com coração de “Nossa história” fica centralizado pela largura útil, sem compensações manuais.
- Ícones de seta são SVGs finos e herdam `currentColor`.
- O RSVP mantém presença individual. Telefones passaram do grupo para cada adulto; crianças não recebem campo de telefone.
- A Home não revela o buffet nem detalhes de chegada.
- A página de presentes é editorial e leve. Os filtros “Todos”, “Casa”, “Viagem” e “Roupas e Acessórios” atuam apenas sobre os presentes comuns.
- “Presentes Insanos” é independente dos filtros e sempre fica ao final do catálogo.
- A referência motociclista é deliberadamente restrita à seção Insanos, com fundo escuro, medalhas e detalhes metálicos.
- No mobile, a fotografia da seção Insanos é um único background contínuo, não um banner separado.
- A ordem de “Presentes Insanos” é fixa em todos os breakpoints: título, linha, introdução, assinatura, cards, moto, frase final.

## Abordagens descartadas

- Recriar o logo com texto HTML.
- Aplicar filtro, blur, saturação, recoloração ou sombra pesada no logo.
- Usar emoji ou Unicode como setas de ações.
- Manter história em duas colunas apertadas no celular.
- Ocultar blocos narrativos no mobile.
- Usar `pe-33.jpg` em retrato no encerramento.
- Revelar dados privados e apenas escondê-los visualmente.
- Um único telefone para toda a família como modelo final.
- Editar a migration original já aplicada.
- Consultar tabelas privadas diretamente pelo cliente ou enfraquecer RLS.
- Criar um segundo banner da seção Insanos para mobile.
- Misturar os três presentes Insanos aos filtros do catálogo.
- Implementar pagamento antes da etapa aprovada.

## Transferência para outro computador

1. Clone `git@github.com:erikgonzaga/paula-erik-casamento.git` e confira a branch correta.
2. Instale Node.js 22 ou superior e rode `npm ci`.
3. Recrie `.env.local` usando o gerenciador seguro onde as credenciais reais estiverem guardadas. Use apenas os nomes documentados em `.env.example`; nunca transfira valores pelo Git ou por estes documentos.
4. Se for necessário operar o Supabase, confirme o projeto vinculado antes de qualquer `db push`. Nunca use `db reset` em banco remoto ou com dados que precisem ser preservados.
5. Rode `npm test`, `npm run lint`, `npm run typecheck` e `npm run build` antes de continuar.
6. Abra `npm run dev` e revise Home, `/rsvp`, convite válido em ambiente seguro e `/presentes`.

