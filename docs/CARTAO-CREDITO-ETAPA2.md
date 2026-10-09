# Cartão de crédito — backend, etapa 2

Implementação local, validada com PostgreSQL PGlite e fetch simulado. Nenhuma chamada real ao Mercado Pago,
alteração remota, frontend de cartão ou ativação para convidados integra esta etapa.
Na etapa 2, o POST público recusava `payment_method=credit_card` com HTTP 409.
A etapa 3 acrescenta uma liberação exclusiva de TEST, com flag explícita; produção continua bloqueada.

## Fluxo compartilhado

Pix e cartão passam pela mesma validação de presente/valor, criação de gift_contributions, idempotência,
autorização durável de submission, parser de Orders, reconciliação, polling, webhook e job existentes.
Somente a construção da transação de cartão e o claim com seus metadados têm variantes específicas.
O valor é sempre bruto: nenhum adicional, taxa ou divisão pelas parcelas é aplicado à contribuição.
As regras goal/open/fixed, overfunding, progresso confirmed/production e ambientes legados permanecem.

`202610070004_credit_card_backend.sql` foi aplicada e validada remotamente pelo proprietário antes da etapa 3.
Ela extrai a lógica financeira do claim para um core privado compartilhado e mantém a assinatura Pix.
Adiciona a RPC service_role-only `claim_gift_card_payment_attempt` com parcelas e identificador do método.
Não altera tabelas, dados históricos, a migration 003, assinatura do webhook ou configuração do scheduler.
A RPC nova compartilha locks, reserva, expiry e a proibição de segundo POST após submission incerta.

## Dados da requisição

Os campos comuns da contribuição permanecem. O método é pix por padrão para compatibilidade.
Cartão exige `card_token`, `payment_method_id` e `installments` inteiro de 1 a 12.
Pode receber `payer.identification={type: CPF|CNPJ, number: string}` e `device_id`, ambos validados.
Outros campos de payer e campos desconhecidos, incluindo PAN, CVV e validade, são rejeitados.

Somente método, parcelas e identificador são persistidos na tentativa. Token, documento e device ID
duram apenas a requisição e não são gravados em contribuição, tentativa, evento ou fingerprint.
O fingerprint inclui método, parcelas e identificador do método, preservando o formato histórico Pix.
Token não integra o fingerprint: reenviar com token novo não autoriza um segundo POST de tentativa incerta.
Recusa terminal encerra aquela contribuição/tentativa. Uma nova operação precisa de nova chave/contribuição
e token recém-tokenizado pelo futuro frontend; o backend não guarda nem recupera tokens anteriores.
Não há registro de tokens usados: a geração de token novo e a regra de uso único do provedor precisarão
ser homologadas junto ao frontend. Troca entre Pix e cartão com a mesma chave recebe conflito.

## Orders e 3DS

O cartão usa /v1/orders, com total/item/payment em strings decimais iguais, token no payment_method,
type credit_card, parcelas e X-Idempotency-Key persistida. Device ID segue no header X-meli-session-id.
O cenário APRO Pix é preservado. Cartão TEST usa e-mail de teste; resultados de cartão são determinados
pelo token produzido a partir dos dados de teste do cartão, sem forçar APRO no payer de produção.

3DS usa config.online.transaction_security (on_fraud_risk, liability_shift required).
action_required/pending_challenge continua pending e pode devolver apenas challenge.url HTTPS.
A URL não é persistida. A conclusão do desafio só confirma após uma nova consulta de Order.
Cartão também exige status processed/accredited coerente tanto na Order quanto no Payment.
HTTP 201, approved da Payments API, tokenização e respostas desconhecidas não confirmam contribuição.

Status de cartão nunca cria Order, nem chama claim, quando falta Order conhecida.
Timeout/resposta inválida depois de begin preserva started, mesma tentativa e idempotência, para investigação.
Webhook e job consultam Orders conhecidas, validam método/parcelas/valor/referência/ambiente e nunca fazem POST.
O token eventualmente repetido na resposta do provedor é descartado pelo parser.
Erros POST têm valores temporários redigidos antes de serializar causas; GET de cartão registra somente
diagnóstico técnico estrutural, sem detalhes livres que possam revelar dados da transação.

## Pendências antes de qualquer ativação

- Migration 004 concluída; não reaplicar nem usar db push nesta etapa.
- Frontend SDK/Brick e desafio 3DS implementados na [etapa 3](CARTAO-CREDITO-ETAPA3.md), com mocks;
  homologação real TEST ainda pendente.
- NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY é configurada somente na etapa 3, para homologação TEST.
- Confirmar disponibilidade de parcelas sem juros e custos absorvidos pela conta recebedora antes da ativação.
  O backend não adiciona taxa ao valor; não usa parâmetro de Point/Checkout Pro como se fosse contrato de Checkout API.
- Implementar consumo de estornos/chargebacks preparado na etapa 1 antes da política financeira definitiva.

Fontes oficiais consultadas:
- https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/websites/cards
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/integrate-3ds
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/integration-test/cards

## Testes

npm test inclui testes de contrato, SQL real em PGlite, serviço/rotas com mocks e webhook assinado localmente.
Cobertura: goal/open/fixed, parcelas, confidencialidade, idempotência sequencial/concorrente, todos os estados,
3DS transitório, timeout, ambiente, permissões da RPC, status sem token/Order e regressão Pix.
