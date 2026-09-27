# Metas e contribuições — etapa de arquitetura

O casal confirmou o histórico remoto de migrations até `202609170003_fix_gift_contribution_expiry.sql`. Os objetos de `202609220001_mercado_pago_pix_orders.sql` e o formato com hífen de `202609220002_fix_mercado_pago_external_reference.sql` foram confirmados no schema remoto após execução manual. Essas versões não constam no histórico de migrations; não reexecutar os SQLs nesta etapa. O catálogo definitivo permanece inalterado.

## Catálogo final

`gifts` mantém `id`, `name`, `slug` único, `description`, `category`, `image_url`, `active`, `featured`, `display_order`, `gift_type`, `allow_multiple`, `created_at` e `updated_at`, com tipos/defaults/constraints anteriores. `price` é renomeada para `target_amount numeric(10,2)` nullable; os valores existentes são preservados. Adiciona `funding_mode text not null default 'goal'`.

- `goal`: meta positiva obrigatória, sem teto financeiro. Uma contribuição iniciada antes de a meta ser atingida pode ultrapassar o restante; ao atingir a meta confirmada, novas contribuições são recusadas. Pix já emitidos continuam válidos e são registrados integralmente se pagos.
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
| contributor_email | E-mail obrigatório, normalizado em minúsculas; usado no fluxo privado de pagamento |
| contributor_phone | Texto opcional, 8–32 caracteres após trim |
| amount | numeric(10,2), positivo, não NaN |
| payment_status | pending (default), confirmed, cancelled, failed, expired |
| payment_method | pix ou external; Pix usa a tentativa privada do Mercado Pago |
| external_reference | Texto opcional, único quando não nulo, 1–255 caracteres, sem espaços nas extremidades nem caracteres de controle |
| message | Texto opcional, até 2000 caracteres |
| vest_name | Texto opcional, 1–150 caracteres; obrigatório para Insanos pendentes/confirmados |
| regional_division | Texto opcional, até 150 caracteres |
| created_at / updated_at | timestamptz obrigatório, default now(); updated_at atualizado por trigger |
| confirmed_at | timestamptz, obrigatório somente quando confirmed; nulo nos demais estados |
| idempotency_key | UUID obrigatório e único por tentativa |
| request_fingerprint | SHA-256 hexadecimal obrigatório; nunca exposto publicamente |
| expires_at | timestamptz obrigatório; novas tentativas Pix usam 30 minutos |

Não existe escrita direta pelo cliente nem lista pública de contribuições. O endpoint servidor validado é a única entrada. Uma lista oficial futura deverá ser server-side e filtrar apenas `confirmed`. Não há ranking público.

O índice parcial `contributions_external_reference_uidx` impede repetição da mesma referência em qualquer presente/status; várias referências nulas são permitidas, inclusive para PIX manual. O servidor futuro deve aplicar trim e usar um namespace estável de provedor/conta quando necessário. Maiúsculas/minúsculas são preservadas porque identificadores externos são opacos. O banco rejeita referências malformadas em vez de alterá-las silenciosamente. A unicidade é uma base de idempotência, não substitui verificação de webhook, confirmação atômica nem tratamento de repetição. Não liberar/reutilizar referências canceladas ao integrar pagamentos.

## Segurança e progresso

RLS de `gifts` permanece intacta: público lê somente ativos. `gift_contributions` tem RLS habilitada, nenhum grant nem policy para `anon`/`authenticated` e acesso de dados apenas para `service_role` no servidor. `PAYMENT_RECONCILIATION_SECRET` será necessário somente no servidor quando o endpoint interno for publicado; não há uso de service role no navegador.

`get_gift_progress()` é SQL STABLE SECURITY DEFINER, com `search_path=''`, referências qualificadas e EXECUTE restrito a `anon`, `authenticated` e `service_role` (revogado de PUBLIC). Retorna uma linha por presente ativo, somente:

- `gift_id`, `target_amount`;
- `total_raised`: SUM(amount) de `confirmed`, ou zero;
- `percentage`: para goal, mínimo entre 100 e total/meta × 100 arredondado a duas casas;
- `remaining_amount`: para goal, máximo entre zero e meta − total;
- `goal_reached`: verdadeiro somente em goal com total ≥ meta.

Para open/fixed, percentual e restante são nulos e meta alcançada é falso. Não retorna IDs individuais, quantidades, nomes, telefones, coletes ou mensagens. A página agora consulta essa RPC no servidor e combina por gift_id com o catálogo. Apenas goal recebe dados de progresso nas props públicas; totais open/fixed são descartados antes da renderização.

Para goal, card e modal mostram meta, barra acessível (role=progressbar, aria-valuemin=0, aria-valuemax=100, aria-valuenow), percentual e total confirmado; restante aparece somente com arrecadação parcial. `goal_reached=true` ou percentual visual de 100% mostra “Meta alcançada ❤️” e remove o CTA normal do card. Para open aparece “Contribua com o valor que desejar”; fixed/Insanos não mostram barra. O formulário cria `pending` e, com a configuração TEST ativa, solicita um Pix pela Orders API.

A RPC também não retorna `external_reference`. A agregação usa apenas gift_id, amount e payment_status das contribuições dos presentes ativos; a divisão é condicionada a goal e protegida com NULLIF. Apesar de não expor registros individuais, totais exatos públicos não garantem anonimato estatístico: uma contribuição isolada ou diferenças entre consultas podem revelar um valor individual, sem identificar seu autor. Eliminar essa inferência exige outra decisão de produto (suprimir/agrupar/atrasar agregados), incompatível com garantir totais exatos sempre atualizados. Revisar esse limite antes de disponibilizar progresso público.

## Criação de pending

`POST /api/gift-contributions` é o único caminho do navegador para iniciar uma contribuição. O endpoint exige mesma origem, body JSON limitado e rate limiting. A chave `service_role` fica exclusivamente no servidor. Cada montagem do formulário gera o UUID v4 somente no primeiro envio e o preserva em retries. O servidor normaliza o payload relevante, persiste apenas seu SHA-256 canônico e garante unicidade da chave no PostgreSQL.

Para `goal`, o valor textual é convertido em centavos inteiros e o progresso mais recente determina se a meta já foi atingida; o valor pode exceder o restante. Para `open`, aceita-se qualquer valor positivo dentro de `numeric(10,2)`. Para `fixed`, o valor recebido do navegador não participa da decisão: `target_amount` do banco determina a contribuição. Insanos exigem nome de colete. Nome e textos são aparados; WhatsApp brasileiro é normalizado para `+55...`.

O retry chama primeiro `expire_gift_contribution_pending`, depois consulta a chave. Fingerprint igual devolve somente `{ok,payment_status}` da tentativa existente; fingerprint diferente retorna conflito. Uma corrida entre dois primeiros INSERTs também é resolvida pela unicidade e nova leitura. Chave e fingerprint nunca retornam ao navegador.

Com a migration de pagamentos, `expires_at` nasce 30 minutos depois de `created_at`. A expiração local continua permitida apenas antes de existir uma tentativa no provedor; depois da emissão do Pix, a consulta autenticada ao Mercado Pago é a fonte do status. O histórico não é apagado. Fechar e reabrir o formulário constitui nova tentativa e gera nova chave.

## Concorrência e decisões antes de produção

O trigger `validate_gift_contribution` serializa inserções e atualizações pela linha de `gifts`. Atualiza somente `updated_at` para adquirir bloqueio de escrita; isso também força conflitos de serialização em transações com snapshot antigo em REPEATABLE READ. Recalcula o total confirmado após o bloqueio, excluindo a própria contribuição em edição. O servidor futuro deve repetir transações em erros de serialização/deadlock.

Uma contribuição `pending` ainda não entra no progresso público. Para `goal`, o Pix pode ser emitido enquanto o total confirmado estiver abaixo da meta; tentativas Pix anteriores podem confirmar depois e fazer o total recebido ultrapassar a meta. A reserva privada continua protegendo presentes únicos (`allow_multiple=false`). A reconciliação confirma pagamentos `processed/accredited` mesmo depois da expiração local ou de outra contribuição completar a meta. Antes de receber dinheiro real, validar concorrência em PostgreSQL/Supabase e definir estorno, chargeback, conciliação tardia e tratamento de indisponibilidade.

Não modificar modalidade, meta ou allow_multiple de um presente com contribuições existentes sem um fluxo administrativo transacional que valide o histórico; esse fluxo ainda não existe. Correções/cancelamentos privados podem reabrir saldo. Não há trilha de auditoria financeira implementada.

A renomeação é incompatível com o código antigo que consulta `price`: coordenar migration e publicação, idealmente em janela de manutenção (o catálogo de produção foi informado como vazio). Não publicar o novo código contra o esquema antigo. Confirmar projeto, histórico de migrations e backup antes de aplicar manualmente. Não executar seeds no remoto.

## Mercado Pago Pix — implementação local em TEST

O servidor usa Checkout Transparente com Orders API. `POST /api/gift-contributions` valida o presente e os dados, cria ou reutiliza a contribuição idempotente, reivindica uma tentativa privada e envia a ordem Pix com `X-Idempotency-Key` estável. Em `PAYMENTS_ENVIRONMENT=test`, o payload enviado ao provedor usa os dados oficiais de simulação TEST; o nome e e-mail reais continuam somente no banco privado do site.

A Order inclui um item informativo com `title` consultado de `gifts.name`, `quantity: 1` e `unit_price` igual ao valor da contribuição formatado com duas casas decimais. O item não envia `external_code`: o UUID do presente permanece no banco, pois excede o limite de 30 caracteres aceito nesse campo pela Orders API. Esse item descreve a contribuição para o presente; não representa a compra física de uma unidade. `total_amount`, pagamento e `unit_price` usam a mesma string decimal. O catálogo e os valores persistidos não são modificados por essa apresentação.

A referência externa definitiva é `gift-contribution-<UUID da contribuição>`. A migration incremental substitui `:` por `-` somente em tentativas legadas ainda em `creating`, sem IDs de Order ou pagamento e com contribuição pendente sincronizada. Ela conserva o ID da tentativa e sua `provider_idempotency_key`; tentativas com Order conhecida não são alteradas. O backend continua usando a referência persistida na tentativa para criar, validar e reconciliar a Order, inclusive por GET/webhook. O casal confirmou que a RPC remota já usa o formato com hífen.

O navegador recebe apenas `payment_status`, QR Code/copia e cola, URL HTTPS do comprovante e expiração. A rota `POST /api/gift-contributions/status` usa a chave UUID criada pelo próprio navegador como capacidade de consulta, aplica mesma origem e rate limiting, consulta o provedor no servidor quando o estado está desatualizado e nunca expõe IDs internos ou credenciais.

`POST /api/payments/mercado-pago/webhook` aceita somente eventos `order`, valida `x-signature` e `x-request-id` com o validador oficial, deduplica o evento e busca a ordem autenticadamente antes de reconciliar. O payload da notificação nunca é usado como prova de pagamento. Somente `processed` com detalhe `accredited`, referência, moeda e valor esperados confirma a contribuição; repetições permanecem idempotentes.

A migration incremental `202609260001_pix_expiry_reconciliation.sql` foi aplicada como SQL isolado no Supabase remoto em 27/09/2026, após validação em PostgreSQL 17.11 real com concorrência, locks, crash após `begin`, confirmação concorrente, leases e `SKIP LOCKED`. Os 13 pagamentos confirmados e o total de R$ 775,00 permaneceram iguais antes e depois. As 21 `payment_attempts` anteriores foram classificadas como `legacy`: 15 com Order e 6 sem Order. As 6 sem Order não foram expiradas, não receberam nova Order e não podem iniciar outro POST. A migration impede iniciar novas Orders depois de `expires_at`, distingue envio incerto de tentativa nunca enviada e permite que um job protegido consulte periodicamente Orders conhecidas. O prazo local não expira uma Order que o Mercado Pago ainda considera válida. A versão `202609260001` continua ausente de `supabase_migrations.schema_migrations`, assim como versões anteriores executadas manualmente; o histórico não foi reparado. Ver [Reconciliação Pix](RECONCILIACAO-PIX.md) para as etapas ainda pendentes.

Na validação HMAC da Order, passamos ao `WebhookSignatureValidator` oficial do SDK `mercadopago` 3.6.1 o `x-signature` e o `x-request-id` recebidos nos headers, o `data.id` original da query e `MERCADO_PAGO_WEBHOOK_SECRET` do ambiente, conforme o exemplo de [Checkout API Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications). Não fazemos lowercase nem calculamos HMAC alternativo para aceitar notificações. O SDK aplica seu próprio trim, extrai `ts` e `v1` e valida o manifest; assinatura inválida retorna 401. O diagnóstico sanitizado em desenvolvimento/TEST apenas registra a estrutura da falha, sem alterar a decisão de segurança. A Order só é processada após validação bem-sucedida.

Estado de homologação: a integração Mercado Pago e o webhook passaram por testes anteriores, incluindo assinatura válida e recebimento HTTP 200 por um túnel temporário. Esse túnel não é infraestrutura definitiva: ainda falta validar o webhook no domínio publicado. O endpoint interno de reconciliação existe no código, mas não foi publicado nem homologado em produção; `PAYMENT_RECONCILIATION_SECRET`, Vault e Cron ainda não foram configurados. A homologação final ponta a ponta em produção permanece pendente. O código C6 é experimental e está fora do caminho crítico desta integração.

Pendente para produção: criar o commit, fazer push/deploy, configurar `PAYMENT_RECONCILIATION_SECRET` por canal seguro, testar manualmente o endpoint publicado, configurar Vault e Cron, validar o webhook no domínio definitivo e concluir a homologação ponta a ponta. Tratar a divergência do histórico de migrations em etapa própria, sem reexecutar SQLs já aplicados. Manter a validação de assinatura obrigatória.

Esta etapa de versionamento não executa operações remotas nem modifica o banco.

## Validação

Na etapa de progresso real, duas leituras públicas GET (gifts ativos e get_gift_progress) confirmaram 38 presentes ativos e 34 metas, todas com total confirmado zero, percentual zero e goal_reached=false. Nenhum progresso de meta ausente. Não foram consultados dados individuais nem realizadas gravações. Fixtures de interface locais exercitam estados diferentes sem modificar o Supabase.

`tests/gifts.test.mjs` executa as migrations reais em PGlite, testa categorias, modalidades, metas, valores, RLS, agregados, confirmação de pendências concorrentes em sequência, presente único e múltiplas contribuições Insanos. O teste de disputa sequencial não substitui teste com duas conexões simultâneas em PostgreSQL/Supabase; essa validação deve preceder pagamentos reais.

CSS, filtros (Todos / Festa / Casa / Viagem), assets e DOM visual permanecem preservados. O formatter usa “Contribuição livre” apenas quando a meta é nula. O seed foi executado apenas pelo teste em memória, não em banco persistente.
