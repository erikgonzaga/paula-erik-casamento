# Fase 2 — Supabase e RSVP fechado

Implementação pronta e validada localmente. O projeto Supabase ainda não foi criado: não há conexão com banco em nuvem nem publicação. A Fase 1 foi preservada. Presentes, PIX e painel administrativo não fazem parte desta entrega.

## Banco e acesso

Migration: `supabase/migrations/202609110001_closed_rsvp.sql`.

| Tabela | Finalidade |
| --- | --- |
| invitation_groups | Família, código, slug, situação ativa e identificação DEMO |
| guests | Integrantes autorizados e confirmação individual |
| rsvps | Telefone, restrições, observações e datas da resposta do grupo |
| event_private_details | Endereço e orientações privadas |
| invitation_rate_limits | Contador compartilhado de tentativas |

As cinco tabelas têm RLS habilitada e acesso direto negado a anon/authenticated. O servidor usa service_role e valida a sessão, o grupo ativo e todos os integrantes antes de gravar. A função save_invitation_rsvp grava em uma transação e rejeita integrantes de outro grupo, duplicados ou ausentes. Não existe cadastro livre de convidados.

O código ou slug abre uma sessão assinada, HttpOnly, SameSite=Strict, Secure em produção, com duração de sete dias. Desativar o grupo bloqueia novos acessos e o uso de sessões existentes. Trocar apenas o código não revoga uma sessão já aberta; trocar o segredo revoga todas. O código e o link são credenciais de acesso ao convite.

Endereço e respostas só são enviados após validação no servidor; não são incluídos no HTML público. As rotas privadas não usam cache, enviam no-referrer e noindex. No Vercel, a limitação usa o IP encaminhado pela plataforma; fora dela, usa um contador local compartilhado conservador. Validar esse comportamento na publicação.

## Configurar seu Supabase

1. Crie um projeto no painel Supabase e guarde a senha do banco em local seguro.
2. Copie `.env.example` para `.env.local`, que está ignorado pelo Git.
3. Preencha as variáveis abaixo no computador, sem enviar chaves pelo chat.

| Variável | Valor |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | URL da Data API do projeto |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Chave anon, reservada para integrações futuras; o RSVP não consulta o banco pelo navegador |
| SUPABASE_SERVICE_ROLE_KEY | Chave service_role, exclusivamente no servidor |
| INVITATION_SESSION_SECRET | Segredo aleatório para assinatura da sessão |
| APP_ORIGIN | Origem exata do site, por exemplo http://localhost:3000; sem caminho |

Gere o segredo no terminal:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Com o Supabase CLI instalado, na pasta do projeto:

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

Confira o destino antes de executar. A migration cria as tabelas e funções; não inclui convidados reais. Alternativamente, execute o conteúdo da migration no SQL Editor de um projeto novo, mantendo o arquivo versionado como referência. Não aplique a mesma migration duas vezes.

Para desenvolvimento com o CLI e Docker: `supabase start` e `supabase db reset` aplicam migrations e seed; reset apaga os dados do banco local. Nunca use reset contra um banco com dados que precise preservar.

Cadastre o endereço real em event_private_details usando o painel Table Editor: uma linha com id=true, address preenchido e venue/parking/valet revisados. Sem essa linha, o convite informa que as orientações serão disponibilizadas. Nenhum endereço real foi inventado nesta entrega.

## Convites DEMO

Execute `supabase/seed.sql` somente em ambiente de desenvolvimento. Todos os grupos são marcados is_demo=true. Não distribua esses códigos como convites reais.

| Grupo | Código |
| --- | --- |
| DEMO — Família Silva | D7C82F4A916B30E58A62 |
| DEMO — Família Oliveira | A93E7062C84F15B9D620 |
| DEMO inativo | B41F893A620D75E9C038 |

Abra `/rsvp` e digite o código, ou `/convite/demo-familia-silva-d7c82f4a916b30e58a62`. Os integrantes já cadastrados aparecem no formulário, sem opção de adicionar pessoas. Cada pessoa precisa de uma resposta; telefone é obrigatório, restrições e observações são opcionais. Reabrir recupera a resposta salva e permite atualizar.

Para remover exclusivamente os registros DEMO, com os relacionamentos em cascata:

```sql
delete from public.invitation_groups where is_demo = true;
```

Para convites reais, gere um código independente por grupo:

```powershell
node -e "console.log(require('crypto').randomBytes(16).toString('hex').toUpperCase())"
```

Use também um sufixo aleatório independente no slug; não use apenas o nome da família. Cadastre os integrantes com o invitation_group_id correspondente pelo Table Editor enquanto não existe painel administrativo. O futuro Supabase Auth não recebe acesso automático: políticas administrativas serão implementadas na fase apropriada.

## Validação e prévia local

`npm run build` e testes SQL/HTTP passaram. Verificação visual em 375, 390 e 430 pixels: sem overflow horizontal, três integrantes presentes, controles com 48px, gravação e edição funcionando pelo navegador.

Os testes usam PostgreSQL via PGlite e a migration real, com um adaptador HTTP restrito para reproduzir as chamadas esperadas. Isso não substitui a validação do gateway PostgREST e do projeto Supabase real.

```powershell
npm test
npm run build
```

Em terminais separados, para testar a aplicação de produção sem conta Supabase:

```powershell
npm run test:fixture
```

```powershell
node tests/start-app.mjs
```

```powershell
npm run test:http
```

A prévia fica em http://127.0.0.1:3101/rsvp. O adaptador só escuta no computador local, porta 54329. Usa chaves fictícias e banco em memória; reiniciar o fixture apaga as respostas e reinicia os limites. O teste HTTP esgota propositalmente o limite de acessos: reinicie o fixture antes de conferir manualmente. Nenhum fallback de teste está embutido na aplicação de produção.

Casos cobertos: convite válido, inválido e inativo; confirmação de todos, parcial e recusa; restrições e observações; reabertura e atualização; bloqueio entre grupos; ausência de endereço público; sessão adulterada; gravação sem sessão; origem diferente; payload excessivo; rate limiting; acesso SQL negado aos papéis públicos. A interface também foi usada para salvar e atualizar uma família DEMO.

## Arquivos principais

- `src/lib/supabase/server.ts`: acesso REST exclusivo do servidor.
- `src/lib/invitations/`: tipos, validação, sessão e proteções HTTP.
- `src/services/invitations.ts` e `rsvp.ts`: busca e gravação autorizadas.
- `src/app/api/invitations/access/route.ts` e `src/app/api/rsvp/route.ts`: endpoints.
- `src/app/rsvp/page.tsx`, `src/app/convite/[slug]/page.tsx`, `src/components/invitation-portal.tsx` e `src/app/rsvp.css`: páginas e formulário.
- `src/app/page.tsx`, `layout.tsx` e `next.config.ts`: links públicos, estilos e cabeçalhos.
- `supabase/`, `.env.example`, `tests/` e scripts de `package.json`: banco, configuração e validação.

## Pendências para ativação

Criar o projeto, configurar as variáveis, aplicar a migration, cadastrar endereço e convidados reais, repetir os testes no Supabase e validar na Vercel. A compatibilidade de build foi confirmada, mas não houve deploy. O painel completo e Auth administrativo ficam para a fase futura. Aguardar aprovação antes de avançar de fase.

Referências: [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [funções PostgreSQL](https://supabase.com/docs/guides/database/functions).
