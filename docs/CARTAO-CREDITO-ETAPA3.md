# Cartão de crédito — frontend de homologação, etapa 3

Implementação local com SDK/HTTP simulados. Nenhum cartão real, pagamento, consulta remota,
migration remota ou liberação de produção é realizado nesta etapa. A migration 004 já foi aplicada
e validada pelo proprietário; nenhuma migration foi alterada.

## Liberação exclusiva de TEST

Página e POST público usam a mesma política server-side. Cartão exige simultaneamente:

```dotenv
PAYMENTS_ENVIRONMENT=test
ENABLE_CREDIT_CARD_CHECKOUT=true
NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY=<chave pública TEST>
```

A flag tem valor padrão false em .env.example. Em production, cartão permanece oculto e o POST
de cartão retorna 409 mesmo com flag true. Pix continua disponível. A public key é pública,
incorporada no bundle pelo Next.js; configurá-la exige reiniciar/recompilar o ambiente TEST.
Access Token e demais secrets continuam exclusivamente no servidor.

## SDK, montagem e dados

@mercadopago/sdk-js carrega MercadoPago.js V2 somente ao entrar na etapa de cartão. O formulário
comum valida os dados e o valor antes disso, sem criar contribuição ou Order. O Brick usa
cardPayment, locale pt-BR e o tema flat. Os tipos debit_card/prepaid_card são excluídos, e as
parcelas disponíveis vêm do provedor, com minInstallments=1 e maxInstallments=12. O callback
também exige paymentTypeId=credit_card e parcelas inteiras entre 1 e 12.

O gerenciador serializa create/unmount, incluindo StrictMode e fechamento durante um create
assíncrono. Troca para Pix, fechamento e estados de pagamento desmontam a instância. Uma falha
incerta de create/unmount bloqueia uma segunda instância até recarregar, sem registrar o erro do SDK.

PAN, CVV e validade permanecem no SDK. O callback projeta explicitamente somente token,
payment_method_id, installments, identificação opcional e device/session ID opcional.
Não copia o payload inteiro, valor indicado pelo SDK, issuer_id ou e-mail do callback.
O valor do presente e a contribuição continuam validados pelo backend existente.
O device ID é obtido se window.MP_DEVICE_SESSION_ID estiver disponível; não há novo script
de coleta adicionado nesta etapa, e sua disponibilidade deverá ser homologada com o SDK real.

O objeto temporário existe durante o POST e é descartado no finally (token esvaziado, documento
e device ID removidos). Nenhum desses dados vai para estado React, logs, analytics ou storage
da aplicação. Não se promete apagar cópias internas do SDK: a instância é desmontada e não
é reutilizada após recusa. O backend não persiste os dados transitórios.

## Idempotência e estados

Uma operação usa uma única chave. Clique duplo é bloqueado; erro de comunicação leva à consulta
de status, sem novo POST automático. Fechar/reabrir o modal conserva em memória somente chave,
dados comuns da contribuição e resultado público sem challenge URL. Não há localStorage ou
sessionStorage. HTTP 404 permite um reenvio explícito com a mesma chave e token recém-gerado;
o backend continua impedindo nova cobrança de uma submissão incerta já autorizada.
Recusa/cancelamento/expiração exigem ação explícita para uma nova operação e novo Brick/token.
Uma resposta de status atrasada não sobrescreve uma operação mais recente.

Estados: processando, pending/análise, action_required/3DS, confirmed, failed, cancelled,
expired e falha de comunicação. HTTP 201 e retorno do Brick nunca são confirmação.
Somente o resultado financeiro reconciliado do backend mostra sucesso e chama router.refresh().
O progresso continua dependendo de confirmed/production. Pix mantém QR, cópia, polling e mensagens.

Limite: recarregar completamente a página elimina o registro em memória. Não há reenvio
automático após reload; uma operação de resultado desconhecido deve ser investigada antes
de iniciar outro pagamento. Recuperação durável no navegador precisará de desenho separado
se for necessária antes da liberação pública, sem persistir dados de cartão.

## 3DS e política de origem

A documentação oficial de Orders retorna transaction_security.url e usa mensagem
{ status: 'COMPLETE' } seguida de consulta de status; não garante um conjunto fixo de hosts.
Portanto não há allowlist de domínios inventada. O frontend aceita somente a URL HTTPS
retornada pelo backend autenticado ao provedor, sem credenciais embutidas, e rejeita a origem
da própria página. O iframe usa sandbox allow-scripts/allow-forms/allow-same-origin,
sem permissão de navegar a página principal, e referrerPolicy=no-referrer.

A mensagem só provoca consulta se origin corresponder exatamente à origem da URL e source
for o contentWindow do iframe. COMPLETE ou o botão manual nunca confirmam localmente.
Uma nova resposta financeira do backend é obrigatória. Listener e iframe são removidos no
desmonte. A URL permanece somente na memória transitória/iframe ativo; não vai para o registro
de operações, storage ou logs. Compatibilidade do sandbox com emissores reais ainda requer TEST.

## Validação e pendências

Testes usam componentes React reais em jsdom, SDK fake, HTTP fake e fixtures PostgreSQL
existentes. Cobrem gates de página/rota, montagem única, limpeza, troca de método,
fechamento/reabertura, Pix, parcelas, projeção dos dados, envio duplo, retry, recusa, estados,
mensagens 3DS/origin/source e consulta obrigatória antes de sucesso.

QA opcional no navegador sobe Next.js com catálogo local fictício, intercepta SDK, desafios
e endpoints financeiros e bloqueia demais origens. Requer Playwright/Edge, sem instalar
Playwright no projeto. Exemplo no ambiente Codex:

```powershell
node tests/credit-card-checkout-browser.mjs '<caminho do módulo playwright>'
```

Capturas de 390/768/1440 ficam em .screenshots/card-checkout-stage3, ignorado pelo Git.
Elas validam a integração visual com um Brick simulado; não comprovam a aparência final,
tokenização, parcelas, antifraude ou o desafio do SDK/emissor reais.

Antes de qualquer ativação: homologar SDK e cartões oficiais TEST, origem/iframe 3DS,
device ID, recusas e parcelas da conta; confirmar taxas absorvidas/parcelamento até 12x
sem acréscimo ao convidado; revisar política de estornos/chargebacks. Produção segue bloqueada.
O audit de dependências já tinha 9 alertas antes da instalação (8 high, 1 critical), nos
pacotes existentes, sem alteração de contagem por SDK/jsdom; tratar em revisão separada.

Fontes oficiais consultadas:
- https://github.com/mercadopago/sdk-js
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/websites/cards
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/additional-settings/websites/behavior-customizations
- https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/additional-settings/websites/visual-customizations
- https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/integrate-3ds
