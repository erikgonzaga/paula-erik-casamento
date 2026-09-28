# Separação financeira TEST / PRODUCTION

Esta implementação parte de `main` em `e311c1c`. A migration
`202609270001_payment_environment_isolation.sql` é **local e ainda não foi
aplicada** ao Supabase. Não ativar pagamentos reais antes de classificar o
histórico e auditar o resultado da migration em produção.

## Modelo

- `gift_contributions.payment_environment` e
  `payment_attempts.payment_environment` guardam `test` ou `production`.
  O par deve coincidir. Um valor não nulo é imutável; `NULL` é somente o
  histórico anterior, nunca um valor permitido em novas inserções.
- A RPC pública `get_gift_progress()` e o dashboard financeiro contam apenas
  `production`. A RPC privada de progresso recebe o ambiente do servidor,
  para que a admissão TEST não use saldo de produção.
- As novas RPCs de claim, begin, expiração, seleção do job e reconciliação
  recebem `p_environment`. As versões antigas perdem `EXECUTE` para os papéis
  da aplicação. O backend compara o ambiente persistido antes de POST/GET
  ao Mercado Pago e as RPCs conferem o mesmo valor sob lock.
- Um registro histórico `NULL` não entra em métricas reais nem pode ser
  reconciliado por TEST ou PRODUCTION. Se um presente possuir contribuição
  histórica pendente/confirmada ainda sem classificação, a abertura de uma
  nova contribuição de produção para esse presente falha de forma fechada.

## Classificação histórica, separada desta migration

1. Congelar a criação de novos Pix durante o corte. Registrar por `SELECT`
   ID, estado, valor, hora, existência da tentativa e ID da Order, sem PII.
2. Para cada contribution, juntar evidência independente: ambiente da
   credencial usado na criação, logs/deploy da época, Order consultada no
   provedor, e evento de homologação conhecido. Prefixo `ORDTST` é indício,
   mas **não** prova suficiente isoladamente.
3. Produzir uma lista de IDs revisada e aprovada com uma decisão explícita
   `test`, `production` ou `indeterminado`. Não classificar o último grupo.
4. Em transação, bloquear cada contribution e sua attempt, conferir que
   ambas ainda estão `NULL` e que a identidade/valor/status não mudaram,
   então preencher os dois campos com o mesmo ambiente. Não modificar
   status financeiro, valor, Order, idempotência, `created_at` ou
   `confirmed_at`. O trigger existente atualizará `updated_at`. Conferir
   contagem e soma por ambiente antes do commit.
5. Verificar progresso público, dashboard, job, polling e webhook no novo
   código. Reavaliar gifts com `legacy_financial_hold` antes de ativar
   produção. A migration não faz backfill nem subtrai R$ 30 por fórmula.

## Implantação e retorno seguro

A migration é transacional e não atualiza dados financeiros existentes.
Antes do commit da transação SQL, qualquer erro permite `ROLLBACK` completo.
O código antigo e o schema novo são incompatíveis de propósito: as RPCs
antigas deixam de ser executáveis pela aplicação. Coordenar a implantação
com a criação de Pix suspensa e a execução do scheduler pausada; não deixar
o código anterior atendendo novas cobranças durante o corte.
Após classificar linhas ou criar pagamentos sob o novo modelo, **não** se
deve restaurar o código antigo nem descartar as colunas: isso voltaria a
misturar TEST e PRODUCTION. Em caso de falha posterior, suspender novas
cobranças/job e corrigir para frente, preservando o histórico. Um eventual
rollback estrutural só é admissível antes de qualquer classificação ou
pagamento novo e após auditoria explícita de ausência de linhas etiquetadas.
