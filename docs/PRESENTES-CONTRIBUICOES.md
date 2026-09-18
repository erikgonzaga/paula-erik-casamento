# Metas e contribuições — etapa de arquitetura

Migrations estruturais aplicadas conforme informado pelo casal: `supabase/migrations/202609170001_gift_funding.sql` e `supabase/migrations/202609170002_gift_contribution_idempotency_expiry.sql`. A correção `202609170003_fix_gift_contribution_expiry.sql` existe apenas no repositório e ainda não foi aplicada no Supabase. O catálogo definitivo permanece inalterado.

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
| payment_status | pending (default), confirmed, cancelled, failed, expired |
| payment_method | pix ou external; apenas classificação, sem integração |
| external_reference | Texto opcional, único quando não nulo, 1–255 caracteres, sem espaços nas extremidades nem caracteres de controle |
| message | Texto opcional, até 2000 caracteres |
| vest_name | Texto opcional, 1–150 caracteres; obrigatório para Insanos pendentes/confirmados |
| regional_division | Texto opcional, até 150 caracteres |
| created_at / updated_at | timestamptz obrigatório, default now(); updated_at atualizado por trigger |
| confirmed_at | timestamptz, obrigatório somente quando confirmed; nulo nos demais estados |
| idempotency_key | UUID obrigatório e único por tentativa |
| request_fingerprint | SHA-256 hexadecimal obrigatório; nunca exposto publicamente |
| expires_at | timestamptz obrigatório, exatamente created_at + 15 minutos |

Não existe escrita direta pelo cliente nem lista pública de contribuições. O endpoint servidor validado é a única entrada. Uma lista oficial futura deverá ser server-side e filtrar apenas `confirmed`. Não há ranking público.

O índice parcial `contributions_external_reference_uidx` impede repetição da mesma referência em qualquer presente/status; várias referências nulas são permitidas, inclusive para PIX manual. O servidor futuro deve aplicar trim e usar um namespace estável de provedor/conta quando necessário. Maiúsculas/minúsculas são preservadas porque identificadores externos são opacos. O banco rejeita referências malformadas em vez de alterá-las silenciosamente. A unicidade é uma base de idempotência, não substitui verificação de webhook, confirmação atômica nem tratamento de repetição. Não liberar/reutilizar referências canceladas ao integrar pagamentos.

## Segurança e progresso

RLS de `gifts` permanece intacta: público lê somente ativos. `gift_contributions` tem RLS habilitada, nenhum grant nem policy para `anon`/`authenticated` e acesso de dados apenas para `service_role` no servidor. Não há nova variável de ambiente nem uso de service role no navegador.

`get_gift_progress()` é SQL STABLE SECURITY DEFINER, com `search_path=''`, referências qualificadas e EXECUTE restrito a `anon`, `authenticated` e `service_role` (revogado de PUBLIC). Retorna uma linha por presente ativo, somente:

- `gift_id`, `target_amount`;
- `total_raised`: SUM(amount) de `confirmed`, ou zero;
- `percentage`: para goal, mínimo entre 100 e total/meta × 100 arredondado a duas casas;
- `remaining_amount`: para goal, máximo entre zero e meta − total;
- `goal_reached`: verdadeiro somente em goal com total ≥ meta.

Para open/fixed, percentual e restante são nulos e meta alcançada é falso. Não retorna IDs individuais, quantidades, nomes, telefones, coletes ou mensagens. A página agora consulta essa RPC no servidor e combina por gift_id com o catálogo. Apenas goal recebe dados de progresso nas props públicas; totais open/fixed são descartados antes da renderização.

Para goal, card e modal mostram meta, barra acessível (role=progressbar, aria-valuemin=0, aria-valuemax=100, aria-valuenow), percentual e total confirmado; restante aparece somente com arrecadação parcial. `goal_reached=true` ou percentual visual de 100% mostra “Meta alcançada ❤️” e remove o CTA normal do card. Para open aparece “Contribua com o valor que desejar”; fixed/Insanos não mostram barra. O formulário cria somente `pending`; ainda não existe gateway.

A RPC também não retorna `external_reference`. A agregação usa apenas gift_id, amount e payment_status das contribuições dos presentes ativos; a divisão é condicionada a goal e protegida com NULLIF. Apesar de não expor registros individuais, totais exatos públicos não garantem anonimato estatístico: uma contribuição isolada ou diferenças entre consultas podem revelar um valor individual, sem identificar seu autor. Eliminar essa inferência exige outra decisão de produto (suprimir/agrupar/atrasar agregados), incompatível com garantir totais exatos sempre atualizados. Revisar esse limite antes de disponibilizar progresso público.

## Criação de pending

`POST /api/gift-contributions` é o único caminho do navegador para iniciar uma contribuição. O endpoint exige mesma origem, body JSON limitado e rate limiting. A chave `service_role` fica exclusivamente no servidor. Cada montagem do formulário gera o UUID v4 somente no primeiro envio e o preserva em retries. O servidor normaliza o payload relevante, persiste apenas seu SHA-256 canônico e garante unicidade da chave no PostgreSQL.

Para `goal`, o valor textual é convertido em centavos inteiros e comparado ao `remaining_amount` mais recente. Para `open`, aceita-se qualquer valor positivo dentro de `numeric(10,2)`. Para `fixed`, o valor recebido do navegador não participa da decisão: `target_amount` do banco determina a contribuição. Insanos exigem nome de colete. Nome e textos são aparados; WhatsApp brasileiro é normalizado para `+55...`.

O retry chama primeiro `expire_gift_contribution_pending`, depois consulta a chave. Fingerprint igual devolve somente `{ok,payment_status}` da tentativa existente; fingerprint diferente retorna conflito. Uma corrida entre dois primeiros INSERTs também é resolvida pela unicidade e nova leitura. Chave e fingerprint nunca retornam ao navegador.

`expires_at` nasce exatamente 15 minutos depois de `created_at`. A função protegida atualiza somente linhas vencidas que ainda estejam `pending`, sem apagar histórico; a correção `202609170003` permite localizar uma linha específica pelo `id` privado da contribuição ou por sua chave de idempotência, além de preservar a futura varredura administrativa sem argumento. O retry vencido recebe `expired`. Fechar e reabrir o formulário constitui nova tentativa e gera nova chave.

## Concorrência e decisões antes de produção

O trigger `validate_gift_contribution` serializa inserções e atualizações pela linha de `gifts`. Atualiza somente `updated_at` para adquirir bloqueio de escrita; isso também força conflitos de serialização em transações com snapshot antigo em REPEATABLE READ. Recalcula o total confirmado após o bloqueio, excluindo a própria contribuição em edição. O servidor futuro deve repetir transações em erros de serialização/deadlock.

Pendentes não reservam saldo. Duas pendentes podem caber individualmente; na confirmação, apenas as que ainda couberem serão aceitas. `expired` significa apenas que a tentativa expirou para a experiência do site. Uma confirmação bancária tardia do C6 deverá passar por conciliação segura antes de qualquer transição posterior. O esquema não bloqueia essa transição, mas ela não foi implementada. Antes de receber dinheiro real, definir idempotência do webhook, conciliação, estorno e tratamento de valores recebidos após esgotamento.

Não modificar modalidade, meta ou allow_multiple de um presente com contribuições existentes sem um fluxo administrativo transacional que valide o histórico; esse fluxo ainda não existe. Correções/cancelamentos privados podem reabrir saldo. Não há trilha de auditoria financeira implementada.

A renomeação é incompatível com o código antigo que consulta `price`: coordenar migration e publicação, idealmente em janela de manutenção (o catálogo de produção foi informado como vazio). Não publicar o novo código contra o esquema antigo. Confirmar projeto, histórico de migrations e backup antes de aplicar manualmente. Não executar seeds no remoto.

## Validação

Na etapa de progresso real, duas leituras públicas GET (gifts ativos e get_gift_progress) confirmaram 38 presentes ativos e 34 metas, todas com total confirmado zero, percentual zero e goal_reached=false. Nenhum progresso de meta ausente. Não foram consultados dados individuais nem realizadas gravações. Fixtures de interface locais exercitam estados diferentes sem modificar o Supabase.

`tests/gifts.test.mjs` executa as migrations reais em PGlite, testa categorias, modalidades, metas, valores, RLS, agregados, confirmação de pendências concorrentes em sequência, presente único e múltiplas contribuições Insanos. O teste de disputa sequencial não substitui teste com duas conexões simultâneas em PostgreSQL/Supabase; essa validação deve preceder pagamentos reais.

CSS, filtros (Todos / Festa / Casa / Viagem), assets e DOM visual permanecem preservados. O formatter usa “Contribuição livre” apenas quando a meta é nula. O seed foi executado apenas pelo teste em memória, não em banco persistente.
