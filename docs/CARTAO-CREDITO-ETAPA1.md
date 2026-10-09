# Cartão de crédito — contrato, etapa 1

`202610070003_credit_card_domain.sql` foi aplicada e validada em produção, conforme confirmado pelo casal.
Esta etapa preparou somente persistência. A etapa backend seguinte está em [Etapa 2](CARTAO-CREDITO-ETAPA2.md).

## Contrato persistente

- `gift_contributions.payment_method`: `pix`, `credit_card` ou `external`, imutável.
- `payment_attempts.payment_method` deve corresponder à contribuição.
- Cartão exige `installments` inteiro entre 1 e 12 e `provider_payment_method_id`.
- Quando presente, o identificador tem 1–64 caracteres, sem espaços nas bordas ou controles; não impõe alfabeto.
- Pix exige parcelas NULL e identificador `pix`; external exige parcelas NULL.
- Método, parcelas e identificador do método são imutáveis na tentativa.
- `amount` permanece o total da contribuição; não é dividido pelas parcelas nem acrescido de taxas.
- Não há campos de PAN, CVV, validade ou token bruto. O validador do contrato rejeita propriedades extras.
- `UNIQUE(contribution_id)` permanece. Tentativa recusada não pode ser substituída ou convertida para outro método.
  A estratégia de nova contribuição/token temporário será implementada na etapa de checkout.

## Compatibilidade e aplicação

O backfill deriva o método exclusivamente da contribuição vinculada. Pix histórico recebe
`payment_method='pix'`, `provider_payment_method_id='pix'` e parcelas NULL.
Ambientes legados NULL, status, valores, IDs, idempotência e todas as datas são preservados.
Somente o trigger de atualização de `payment_attempts.updated_at` é desabilitado durante o backfill,
dentro da transação e do bloqueio exclusivo, sendo reabilitado antes do commit.

As RPCs de claim, submission e reconciliation mantêm suas assinaturas, permissões e implementação.
O trigger preenche os novos campos omitidos pelo claim Pix existente. Uma nova tentativa de cartão
precisa de metadados explícitos; o claim atual não inicia cartão. Submission e reconciliation
continuam genéricos e preservam a confirmação exclusiva por processed/accredited e o isolamento de ambiente.
As rotas públicas e o serviço ativo continuaram Pix na etapa 1; o backend de cartão está separado na etapa 2.

A migration segue o padrão de aplicação única do projeto. Reexecução ou schema parcialmente aplicado
abortam a transação antes de alterar dados. Não é uma migration idempotente com reexecução silenciosa.
Não reexecutar esta migration aplicada nem executar `supabase db push`.

## Ajustes financeiros

`payment_financial_adjustments` é privada, com RLS e acesso SELECT/INSERT somente para service_role.
Registra refund, chargeback ou chargeback_reversal, valor positivo BRL, data, tentativa e ambiente.
A combinação provider/external_reference é única; replay pode usar ON CONFLICT DO NOTHING.
Ambiente e provider precisam corresponder à tentativa e à contribuição vinculadas.
UPDATE/DELETE são proibidos, inclusive por trigger; a contribuição original permanece intacta.

Esta etapa apenas prepara o registro dos eventos. Não aplica ajustes a progresso, reservas ou admin.
Antes de habilitar cartão em produção, outra etapa deverá implementar e homologar consumo dos eventos,
validação dos valores contra o provedor, tokenização e política de retry com token novo.

## Validação local

`tests/credit-card-domain.test.mjs` executa migrations completas em PostgreSQL PGlite,
com histórico Pix, constraints, imutabilidade, RLS, RPCs existentes, ambiente e idempotência.
`tests/payment-contract.type-test.ts` é verificado pelo typecheck do projeto.
