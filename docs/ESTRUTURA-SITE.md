# Estrutura do site

## Stack e comandos

- Next.js 16.3.4, App Router e Webpack.
- React 19.2.4.
- TypeScript 5.
- Tailwind CSS 4 disponível, com a maior parte do visual em CSS global e CSS Modules.
- PostgreSQL/Supabase por REST no servidor.
- Testes Node nativos e PGlite.

```powershell
npm ci
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
```

O ambiente recomendado é Node.js 22 ou superior.

## Rotas

| Rota | Tipo | Responsabilidade |
| --- | --- | --- |
| `/` | pública, estática | Home, história, pessoas, dados públicos mínimos, links para RSVP e presentes. |
| `/presentes` | pública, estática + interação client-side | Catálogo mockado, filtros, modal e seção Insanos. |
| `/rsvp` | privada por sessão/código | Entrada por código e formulário do convite. |
| `/convite/[slug]` | privada por sessão/slug | Abre a mesma experiência do RSVP usando um slug individual. |
| `/api/invitations/access` | servidor | Valida código ou slug, aplica limite, cria/remove sessão e retorna o slug correto. |
| `/api/rsvp` | servidor | Lê o convite autorizado e grava respostas. |

`next.config.ts` envia `noindex`, `no-store`, `no-referrer`, `nosniff` e proteção contra frame nas rotas privadas.

## Home

Arquivo principal: `src/app/page.tsx`.

Ordem atual:

1. `Navigation`.
2. Hero com `WeddingLogo`, ações e foto.
3. `Countdown` para 21/11/2026 às 13h (`-03:00`).
4. História: ornamento, introdução, fotos, cinco capítulos e `details` com texto integral.
5. “Eu escolhi você”.
6. Pessoas especiais.
7. “O grande dia” com data, recepção às 13h, cidade e aviso de privacidade.
8. Chamada do RSVP.
9. Chamada da lista de presentes.
10. Foto final horizontal e rodapé em aquarela.

O CSS global acumulou revisões sucessivas; regras posteriores intencionalmente refinam regras antigas. Ao limpar o arquivo, compare visualmente todos os breakpoints antes de consolidar seletores.

## Componentes compartilhados

| Componente | Função |
| --- | --- |
| `Navigation` | Menu desktop/mobile e links principais. |
| `WeddingLogo` | Único ponto de uso da marca oficial em três tamanhos. |
| `DreamPhoto` | Wrapper de `next/image` com ponto focal configurável. |
| `Photo` | Fotos numeradas da narrativa e legenda com SVG. |
| `Countdown` | Contagem regressiva hidratada no cliente. |
| `ArrowUpRightIcon`, `ArrowDownIcon` | Ícones vetoriais minimalistas. |
| `InvitationPortal` | Entrada por código/slug, leitura do convite, formulário e detalhes privados. |
| `GiftList` | Estado dos filtros, cards comuns e modal de detalhe. |

## Lista de presentes

Arquivos:

- `src/app/presentes/page.tsx`;
- `src/app/presentes/presentes.module.css`;
- `src/components/gift-list.tsx`;
- `src/components/gift-list.module.css`.

Os nove presentes comuns estão hardcoded em `gift-list.tsx`, distribuídos entre Casa, Viagem e Roupas e Acessórios. O filtro é client-side e não recarrega a página. “Presentear” abre um modal; “Continuar” apenas anuncia meios de pagamento futuros.

Os três presentes Insanos estão hardcoded em `page.tsx`, fora dos filtros. Os botões “CONTRIBUIR” não possuem integração. O símbolo da moto é um SVG local no componente da página.

## RSVP e convite fechado

### Caminho por código

1. `/rsvp` renderiza `InvitationPortal` sem slug.
2. O formulário normaliza no cliente, mas o servidor repete a normalização.
3. `POST /api/invitations/access` lê uma string, aplica `trim().toUpperCase()`, valida o código normalizado e chama `findInvitationByCode`.
4. `findInvitationByCode` consulta exatamente `invitation_groups.code` e rejeita grupo inexistente/inativo.
5. O servidor grava cookie assinado e HttpOnly.
6. O cliente navega para `/convite/[slug]`.
7. A rota por slug cria a mesma sessão e `GET /api/rsvp` carrega o convite.

### Sessão e proteção

- Cookie `wedding_invitation` assinado com HMAC-SHA256.
- Validade de sete dias.
- `HttpOnly`, `SameSite=Strict`, `Secure` em produção e `path=/`.
- Grupo inativo é rejeitado também quando uma sessão antiga tenta ler os dados.
- Comparação de origem em mutações por `APP_ORIGIN`; localhost/127.0.0.1 flexível apenas fora de produção.
- Rate limiting armazenado no banco; em Vercel usa o cabeçalho controlado pela plataforma.
- Limite de body em 16 KiB.
- Erros internos viram resposta genérica; logs de diagnóstico são condicionais e não devem conter credenciais ou dados pessoais.

### RSVP

- Todos os integrantes ativos do grupo devem ser enviados uma única vez.
- Presença é `confirmed` ou `declined` por pessoa.
- Adultos exigem telefone/WhatsApp individual; crianças ficam com telefone nulo.
- Validação aceita caracteres comuns de telefone, exige 8–15 dígitos e limita a string a 32 caracteres.
- Restrições alimentares e observações permanecem no registro de grupo.
- Reabrir o convite recupera presença, telefones e textos para edição.

## Banco e migrations

Nunca edite migrations já aplicadas. O estado versionado é construído nesta ordem:

1. `202609110001_closed_rsvp.sql` — grupos, convidados, RSVP, detalhes privados, rate limits, RLS e funções iniciais.
2. `202609130001_private_event_schedule.sql` — horários de recepção e cerimônia nos detalhes privados.
3. `202609130002_guest_phone.sql` — telefone por convidado, compatibilidade do campo legado e nova implementação transacional de `save_invitation_rsvp`.

Tabelas:

| Tabela | Conteúdo |
| --- | --- |
| `invitation_groups` | Nome do grupo, slug, código, ativo e marca DEMO. |
| `guests` | Integrantes autorizados, tipo, presença e telefone individual. |
| `rsvps` | Restrição alimentar, observações e timestamps; telefone legado mantido por compatibilidade. |
| `event_private_details` | Local e orientações privadas. |
| `invitation_rate_limits` | Baldes de limitação de tentativas. |

Todas usam RLS com acesso público negado. A aplicação acessa REST com `service_role` apenas em módulos `server-only`. `save_invitation_rsvp` valida o grupo e todos os IDs antes de qualquer update.

`supabase/seed.sql` é somente para desenvolvimento. Não aplique seed DEMO em produção e não distribua seus códigos.

## Variáveis de ambiente

Consulte apenas os nomes em `.env.example`:

- URLs/chaves públicas reservadas do Supabase;
- URL privada do servidor;
- chave `service_role` do servidor;
- segredo de sessão;
- origem da aplicação;
- chave temporária para logs seguros de diagnóstico.

Os valores não pertencem ao Git ou à documentação. `.env.local` está ignorado.

## Testes

`npm test` executa `tests/rsvp.test.mjs` com migrations reais em PGlite. Cobre atomicidade, edição, telefone por adulto, criança sem telefone, ataque entre grupos, RLS, grupo inativo e rate limiting.

O teste HTTP requer três processos:

```powershell
npm run test:fixture
node tests/start-app.mjs
npm run test:http
```

Ele cobre ausência de sessão, privacidade da Home, código inválido/inativo, origem, equivalência de código maiúsculo e minúsculo, cookie, leitura privada, gravação/edição, persistência e ataques entre grupos. A fixture usa somente credenciais fictícias e banco em memória.

Para uma alteração que toca banco ou acesso, execute também testes reais em um projeto Supabase de desenvolvimento e revise o comportamento na Vercel.

