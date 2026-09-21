# Fundação do painel administrativo

Entrega local iniciada em `main`, checkpoint `5248eb6`, com working tree limpa. Somente leitura de dados do casamento. Nenhum CRUD, pagamento, cadastro público ou alteração das páginas públicas. Nenhuma operação remota, criação de usuário real, commit, push ou deploy foi realizada.

## Arquitetura e autenticação

`/admin/login` envia e-mail e senha por POST para `/admin/session`. O Route Handler valida origem, tamanho, campos e limite de tentativas, e chama o endpoint oficial Supabase Auth `POST /auth/v1/token?grant_type=password`. Não há senha própria, armazenamento de senha, SDK no navegador ou cadastro.

O servidor valida a identidade em `GET /auth/v1/user` e consulta `admin_users` antes de emitir o cookie. A validação remota do usuário segue o princípio documentado em [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser); os endpoints REST estão na [especificação oficial](https://github.com/supabase/auth/blob/master/openapi.yaml).

Cookie independente `wedding_admin`: HttpOnly, SameSite=Strict, Secure em produção, Path=/admin. Duração limitada ao menor valor entre a validade informada pelo Supabase e uma hora. Não persistimos refresh token; ao expirar, é necessário entrar novamente. Isso é uma decisão explícita desta fundação, não um fluxo de renovação automática.

O SHA-256 do access token é registrado em `admin_sessions`, junto de user_id e expiração. O token bruto fica apenas no cookie HttpOnly e nas chamadas do servidor ao Auth. A tabela não armazena senhas ou refresh tokens. O logout apaga esse registro, solicita `POST /auth/v1/logout?scope=local`, limpa o cookie e a interface redireciona para `/admin/login`. Se o Auth estiver indisponível depois da revogação local, o painel continua inacessível com aquele token. Se a revogação local falhar, a interface informa erro e permite tentar novamente.

Essa revogação adicional evita reutilização da sessão do painel durante a validade residual do JWT: [tokens de acesso Supabase podem permanecer válidos até expirar](https://supabase.com/docs/guides/auth/managing-user-data). O logout afeta esta sessão do painel, não as sessões de convite ou outras sessões de Auth.

## Autorização e proteção

`getAdminDashboard()` chama `requireAdmin()` em toda requisição, antes de buscar o resumo. O guard verifica o token no Auth, `admin_users.active=true`, a existência do hash da sessão, o vínculo ao mesmo usuário e a expiração. Não confia em ID vindo do navegador, metadados de usuário, JWT apenas decodificado, cookie de convite ou middleware. Não foi necessário criar proxy/middleware.

- Sem sessão válida: redirecionamento para login com aviso de sessão indisponível/expirada.
- Conta sem autorização ou desativada: tela de acesso não autorizado, sem dados administrativos.
- Falha no Auth/banco: acesso fechado e mensagem genérica, sem detalhes internos.
- A RPC revalida `admin_users.active` dentro da consulta.
- As páginas são dinâmicas; fetch usa `no-store`. As rotas `/admin/*` recebem headers privados, no-store, noindex/nofollow, no-referrer, nosniff e DENY para frames.
- Mutações de sessão exigem mesma origem; login permite dez tentativas por dez minutos, usando a infraestrutura existente com escopo separado. Em Vercel usa o IP controlado pela plataforma; fora dela o bucket é compartilhado, como no mecanismo atual do projeto.
- Somente o Route Handler de sessão escreve em infraestrutura de autenticação/rate limit. O dashboard faz apenas GET e SQL STABLE, sem expirar contribuições ou tocar tabelas de negócio.
- `service_role` permanece nos módulos `server-only`. O navegador recebe somente a interface e os dados administrativos que foram autorizados; nenhuma chave administrativa, token, telefone, código ou slug de convite é incluído no dashboard.

## Migration e consultas

Nova migration: `supabase/migrations/202609200001_admin_foundation.sql`. As migrations anteriores permanecem intactas.

Cria `admin_users(user_id uuid PK → auth.users, active boolean default true, created_at timestamptz)` e `admin_sessions(token_hash PK, user_id, expires_at, created_at)`. RLS habilitada; nenhuma policy pública. `public`, `anon` e `authenticated` não recebem acesso às tabelas/funções. `service_role` só lê `admin_users`, e lê/insere/exclui sessões. A aplicação não tem permissão de conceder autorização administrativa.

Funções exclusivas de service_role, SECURITY INVOKER e search_path vazio:

- `revoke_admin_session(text)`: remove somente o hash informado, utilizada exclusivamente no logout.
- `get_admin_dashboard(uuid)`: STABLE, verifica administrador ativo e retorna um JSON com agregados e as últimas vinte contribuições, em um snapshot consistente.

Consultas de acesso: GET `admin_users?select=active&user_id=eq.<uuid>&limit=1`, GET `admin_sessions?select=user_id,expires_at&token_hash=eq.<hash>&limit=1`. Consulta do painel: GET `rpc/get_admin_dashboard?p_user_id=<uuid>` via infraestrutura `database()` existente. Agregação no PostgreSQL evita truncamento pelo limite padrão do REST. A RPC usa exclusivamente os nomes/tipos das migrations existentes.

`get_gift_progress()` público foi inspecionado e permanece intacto. O Admin calcula a mesma definição de confirmado para metas, mas precisa de histórico de presentes inativos, status e registros recentes, que a RPC pública deliberadamente não expõe.

## Métricas e escopos

| Bloco | Regra |
| --- | --- |
| Convidados | Pessoas ativas, em grupos ativos e não DEMO; total, adultos, crianças, confirmados, recusados e pendentes. |
| Grupos | Grupos ativos e não DEMO; respondeu = existe uma linha de RSVP para o grupo. |
| Presentes | Somente ativos; total, Casa/Festa/Viagem/Insanos e quantidades goal/open/fixed. |
| Metas ativas | Soma dos target_amount somente de goal ativos; confirmado desses mesmos presentes; razão entre somas, limitada a 100%. Sem metas = 0%. |
| Contribuições | Histórico inteiro, inclusive presentes inativos, separado em pending/confirmed/expired/cancelled/failed. Status persistidos são preservados; esta tela não executa expiração. |
| Valores | Apenas confirmed. Total geral; goal; open; fixed; Insanos por gift_type. Insanos já integra fixed e não deve ser somado novamente. |
| Tabela de metas | Apenas goal ativos; nome, categoria, meta, confirmado, percentual até 100%, restante mínimo zero; sem dados pessoais. |
| Recentes | Vinte mais recentes por created_at DESC, id DESC; contribuinte, presente, valor, status e horário. Sem telefone ou mensagem. |

Valores agregados no PostgreSQL usam numeric; apresentação em BRL/pt-BR. Timestamps e timezone do banco não mudam. A interface formata em `America/Sao_Paulo`. As diferenças entre metas ativas e histórico completo estão explicadas no próprio painel.

## Arquivos desta entrega

Criados:

- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/login/page.tsx`
- `src/app/admin/loading.tsx`
- `src/app/admin/session/route.ts`
- `src/app/admin/session-controls.tsx`
- `src/app/admin/admin.module.css`
- `src/lib/admin/auth.ts`
- `src/lib/admin/types.ts`
- `src/services/admin-dashboard.ts`
- `supabase/migrations/202609200001_admin_foundation.sql`
- `tests/admin.test.mjs`
- `tests/admin-http.test.mjs`
- `tests/admin-fixture.mjs`
- `tests/build-test-app.mjs`
- `docs/ADMINISTRACAO.md`

Alterados:

- `next.config.ts`: headers apenas para novas rotas administrativas.
- `package.json`: inclui testes de banco do Admin e comando de teste HTTP.
- `tests/database-fixture.mjs`: schema auth.users mínimo, exclusivamente no banco de teste.
- `docs/ESTRUTURA-SITE.md`, `docs/CONTEXTO-CASAMENTO.md`, `docs/PENDENCIAS.md`: registram a fase e os passos remotos ainda pendentes.

Não houve nova dependência, alteração de catálogo/asset, migration histórica, página pública, serviço público ou sessão de convite.

## Validação local

- `npm test`: 20 testes aprovados, incluindo dois novos cenários de banco administrativo.
- `npm run lint`: aprovado, sem avisos após ajuste do teste HTTP.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado; `/admin`, `/admin/login` e `/admin/session` dinâmicos.
- `git diff --check`: aprovado.
- `npm run test:admin:http`: aprovado no aplicativo compilado isoladamente, incluindo a suíte HTTP existente de RSVP.
- Navegador local: login, carregamento, dashboard, logout e retorno ao login; revisão em 390, 768, 1280 e 1440 px com dados fictícios. Nenhuma conta real foi utilizada.

Os testes de banco cobrem RLS, ausência/desativação de administrador, permissão mínima da service_role, snapshot em transação READ ONLY, categorias/modalidades, valores em centavos, metas vazias, limite de vinte recentes e preservação de pending vencido. Os testes HTTP cobrem sessão ausente, forjada e expirada, usuário comum, administrador ativo/inativo, origem cruzada, cookies, revogação mesmo com token Auth ainda válido, erro de consulta, ausência de escritas no dashboard, páginas públicas e ausência da chave de serviço nos arquivos JavaScript do bundle cliente e HTML.

O Auth é simulado somente nos testes; o SQL real das migrations roda em PGlite. Isso não substitui a conferência manual final em um Supabase de desenvolvimento com Auth real. O projeto remoto não foi acessado.

Para reproduzir os testes HTTP sem conectar a produção:

```powershell
node tests/build-test-app.mjs
npm run test:admin:http
```

Esse build usa somente URLs de loopback e chaves sintéticas, inclusive nas variáveis NEXT_PUBLIC que o Next incorpora na compilação. Nunca publique o artefato de teste; para uso normal, gere novamente com `npm run build` e suas variáveis locais seguras. Não rode o servidor de fixture separado simultaneamente com a suíte HTTP; ela administra os processos nas portas 54331 e 3113.

## Passos manuais EXATOS no Supabase

Nada nesta seção foi executado remotamente.

1. Abra o Dashboard Supabase e selecione o projeto já utilizado pelo casamento. Confira o projeto antes de qualquer execução.
2. Confira a presença de `invitation_groups`, `guests`, `rsvps`, `gifts`, `gift_contributions` e dos campos de funding/status das migrations existentes. A nova migration pressupõe esse schema. Não execute seeds nem o catálogo novamente. A correção histórica `202609170003` não é dependência da leitura do Admin e permanece uma pendência separada.
3. Em **SQL Editor → New query**, cole integralmente `supabase/migrations/202609200001_admin_foundation.sql`, revise e execute **uma única vez** como proprietário do projeto. Ela cria somente a infraestrutura nova. Não rode `db push`, `db reset` ou o conjunto inteiro de migrations para esta tarefa.
4. Em **Authentication → Sign In / Providers**, mantenha o provedor Email habilitado e **Allow new users to sign up** desabilitado. Mantenha login anônimo desabilitado. Os nomes de agrupamentos podem variar conforme a versão do Dashboard; as opções estão descritas na [configuração oficial de Auth](https://supabase.com/docs/guides/auth/general-configuration).
5. Em **Authentication → URL Configuration**, confira a Site URL para o domínio correto. O fluxo desta fase usa senha e não exige callback OAuth, magic link ou recuperação de senha.
6. Não adicione policies para anon/authenticated nas novas tabelas, não habilite leitura pública e não promova chaves de serviço para NEXT_PUBLIC.

## Criar o primeiro administrador

1. No mesmo projeto, abra **Authentication → Users → Add user → Create new user**.
2. Digite seu e-mail e uma senha forte exclusiva, guardada em gerenciador de senhas. Para esta conta criada manualmente por você, marque **Auto Confirm User** (ou confirme que o e-mail está confirmado). Não escolha envio de convite: não há tela de definição/recuperação de senha nesta fase.
3. Crie o usuário e copie o **User UID/ID**, não o e-mail e não uma chave de API. Se já houver uma conta válida, use seu UID sem recriar ou mudar a senha.
4. No SQL Editor, substitua o marcador pelo UID copiado e execute:

```sql
insert into public.admin_users (user_id, active)
values ('COLE_AQUI_O_UUID_DO_USUARIO'::uuid, true)
on conflict (user_id) do update set active = excluded.active;
```

5. Confirme o vínculo, substituindo o mesmo marcador:

```sql
select user_id, active, created_at
from public.admin_users
where user_id = 'COLE_AQUI_O_UUID_DO_USUARIO'::uuid;
```

6. No ambiente local da aplicação, confira as variáveis existentes de `.env.example`: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL apontando para esse projeto, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY exclusivamente no servidor, INVITATION_SESSION_SECRET e APP_ORIGIN exata. Não cole valores em logs ou no Git. Não é necessária variável nova. Use `npm run dev` e abra `http://localhost:3000/admin/login` (com APP_ORIGIN correspondente).
7. Entre com o e-mail/senha criados. Confirme o dashboard. Clique **Sair** e confirme que `/admin` retorna ao login. Teste também uma conta Auth sem linha em admin_users: ela deve receber acesso negado.
8. Para desativar futuramente, execute manualmente `update public.admin_users set active=false where user_id='COLE_AQUI_O_UUID_DO_USUARIO'::uuid;`. A próxima requisição do painel será negada. Dados já exibidos no navegador não podem ser recolhidos retroativamente.

Mantenha qualquer verificação com contas fictícias em um projeto de desenvolvimento. Nenhuma conta de teste deve ser criada automaticamente em produção.

## Limites desta fase

Sessões duram no máximo uma hora e exigem novo login. Não há recuperação de senha, renovação automática, MFA, gerenciamento de administradores ou CRUD no painel. A autorização é administrada separadamente no Supabase. Hashes de sessões expiradas podem ser removidos periodicamente pelo proprietário com `delete from public.admin_sessions where expires_at <= now();`; a expiração já é verificada no acesso e não depende dessa limpeza. Não há agendamento automático ou escrita de manutenção durante consultas.
