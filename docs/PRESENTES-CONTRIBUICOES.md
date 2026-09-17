# Metas e contribuições — etapa de arquitetura

Migration: `supabase/migrations/202609170001_gift_funding.sql`. O casal informou sua aplicação bem-sucedida no Supabase, assim como a da migration `202609150001_gifts_party_category.sql`. Ambas agora são históricas e imutáveis. O catálogo definitivo está preparado, ainda sem execução, em `supabase/catalogs/20260917_gifts_definitive_v1.sql`; ver `CATALOGO-DEFINITIVO.md`.

## Catálogo final

`gifts` mantém `id`, `name`, `slug` único, `description`, `category`, `image_url`, `active`, `featured`, `display_order`, `gift_type`, `allow_multiple`, `created_at` e `updated_at`, com tipos/defaults/constraints anteriores. `price` é renomeada para `target_amount numeric(10,2)` nullable; os valores existentes são preservados. Adiciona `funding_mode text not null default 'goal'`.

- `goal`: meta positiva obrigatória; soma confirmada não pode ultrapassá-la. Ao atingir a meta, novas contribuições normais são recusadas.
- `open`: nesta implementação, meta obrigatoriamente nula, para evitar um teto ambíguo. Contribuições positivas livres.
- `fixed`: valor positivo obrigatório por contribuição, sem teto coletivo.
- `allow_multiple=false`: no máximo uma contribuição confirmada, inclusive em `open`/`fixed`. Não significa reserva por uma contribuição pendente.
- Insanos exigem `fixed`, categoria `insanos` e `allow_multiple=true`; não esgotam por arrecadação. Regulares usam `party`, `house` ou `travel`.

O UPDATE da migration apenas classifica registros Insanos eventualmente existentes como `fixed`; não insere presentes. Não altera os valores existentes. Bronze 75, Prata 150 e Ouro 225 são decisões para cadastro futuro, não executadas aqui. O seed opcional continua com os dados fictícios antigos, adaptados ao novo esquema, exclusivamente para testes locais descartáveis; nunca aplicar em produção.

## Contribuições privadas

`gift_contributions` possui:

| Campo | Tipo/regra |
| --- | --- |
| id | UUID PK, gerado automaticamente |
| gift_id | UUID obrigatório, FK gifts; exclusão do presente restrita |
| contributor_name | Texto obrigatório, 1–150 caracteres após trim |
| contributor_phone | Texto opcional, 8–32 caracteres após trim |
| amount | numeric(10,2), positivo, não NaN |
| payment_status | pending (default), confirmed, cancelled, failed |
| payment_method | pix ou external; apenas classificação, sem integração |
| external_reference | Texto opcional, único quando não nulo, 1–255 caracteres, sem espaços nas extremidades nem caracteres de controle |
| message | Texto opcional, até 2000 caracteres |
| vest_name | Texto opcional, 1–150 caracteres; obrigatório para Insanos pendentes/confirmados |
| regional_division | Texto opcional, até 150 caracteres |
| created_at / updated_at | timestamptz obrigatório, default now(); updated_at atualizado por trigger |
| confirmed_at | timestamptz, obrigatório somente quando confirmed; nulo nos demais estados |

Não existe endpoint público de escrita nem lista de agradecimentos nesta etapa. Uma lista oficial futura deverá ser server-side e filtrar apenas `confirmed`. Não há ranking público.

O índice parcial `contributions_external_reference_uidx` impede repetição da mesma referência em qualquer presente/status; várias referências nulas são permitidas, inclusive para PIX manual. O servidor futuro deve aplicar trim e usar um namespace estável de provedor/conta quando necessário. Maiúsculas/minúsculas são preservadas porque identificadores externos são opacos. O banco rejeita referências malformadas em vez de alterá-las silenciosamente. A unicidade é uma base de idempotência, não substitui verificação de webhook, confirmação atômica nem tratamento de repetição. Não liberar/reutilizar referências canceladas ao integrar pagamentos.

## Segurança e progresso

RLS de `gifts` permanece intacta: público lê somente ativos. `gift_contributions` tem RLS habilitada, nenhum grant nem policy para `anon`/`authenticated` e acesso de dados apenas para `service_role` no servidor. Não há nova variável de ambiente nem uso de service role no navegador.

`get_gift_progress()` é SQL STABLE SECURITY DEFINER, com `search_path=''`, referências qualificadas e EXECUTE restrito a `anon`, `authenticated` e `service_role` (revogado de PUBLIC). Retorna uma linha por presente ativo, somente:

- `gift_id`, `target_amount`;
- `total_raised`: SUM(amount) de `confirmed`, ou zero;
- `percentage`: para goal, mínimo entre 100 e total/meta × 100 arredondado a duas casas;
- `remaining_amount`: para goal, máximo entre zero e meta − total;
- `goal_reached`: verdadeiro somente em goal com total ≥ meta.

Para open/fixed, percentual e restante são nulos e meta alcançada é falso. Não retorna IDs individuais, quantidades, nomes, telefones, coletes ou mensagens. A página ainda não consulta essa RPC nem mostra barra de progresso.

A RPC também não retorna `external_reference`. A agregação usa apenas gift_id, amount e payment_status das contribuições dos presentes ativos; a divisão é condicionada a goal e protegida com NULLIF. Apesar de não expor registros individuais, totais exatos públicos não garantem anonimato estatístico: uma contribuição isolada ou diferenças entre consultas podem revelar um valor individual, sem identificar seu autor. Eliminar essa inferência exige outra decisão de produto (suprimir/agrupar/atrasar agregados), incompatível com garantir totais exatos sempre atualizados. Revisar esse limite antes de disponibilizar progresso público.

## Concorrência e decisões antes de produção

O trigger `validate_gift_contribution` serializa inserções e atualizações pela linha de `gifts`. Atualiza somente `updated_at` para adquirir bloqueio de escrita; isso também força conflitos de serialização em transações com snapshot antigo em REPEATABLE READ. Recalcula o total confirmado após o bloqueio, excluindo a própria contribuição em edição. O servidor futuro deve repetir transações em erros de serialização/deadlock.

Pendentes não reservam saldo. Duas pendentes podem caber individualmente; na confirmação, apenas as que ainda couberem serão aceitas. Confirmação que ultrapassa a meta é recusada, não truncada. Antes de receber dinheiro real, definir reserva/expiração, idempotência de webhooks, conciliação, estorno e tratamento de valores recebidos após esgotamento. Não habilitar pagamentos sobre esta estrutura sem essa fase.

Não modificar modalidade, meta ou allow_multiple de um presente com contribuições existentes sem um fluxo administrativo transacional que valide o histórico; esse fluxo ainda não existe. Correções/cancelamentos privados podem reabrir saldo. Não há trilha de auditoria financeira implementada.

A renomeação é incompatível com o código antigo que consulta `price`: coordenar migration e publicação, idealmente em janela de manutenção (o catálogo de produção foi informado como vazio). Não publicar o novo código contra o esquema antigo. Confirmar projeto, histórico de migrations e backup antes de aplicar manualmente. Não executar seeds no remoto.

## Validação

`tests/gifts.test.mjs` executa as migrations reais em PGlite, testa categorias, modalidades, metas, valores, RLS, agregados, confirmação de pendências concorrentes em sequência, presente único e múltiplas contribuições Insanos. O teste de disputa sequencial não substitui teste com duas conexões simultâneas em PostgreSQL/Supabase; essa validação deve preceder pagamentos reais.

CSS, filtros (Todos / Festa / Casa / Viagem), assets e DOM visual permanecem preservados. O formatter usa “Contribuição livre” apenas quando a meta é nula. O seed foi executado apenas pelo teste em memória, não em banco persistente.
