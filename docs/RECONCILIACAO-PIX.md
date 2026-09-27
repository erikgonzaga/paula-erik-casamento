# Reconciliação periódica do Pix

`202609260001_pix_expiry_reconciliation.sql` foi aplicada como SQL isolado no Supabase remoto em 27/09/2026, após aprovação em PostgreSQL real 17.11 com testes de concorrência, locks, crash após `begin`, confirmação concorrente, leases e `SKIP LOCKED`. Antes e depois da aplicação havia 13 contribuições confirmadas, somando R$ 775,00. As 21 tentativas históricas foram classificadas como `legacy` (15 com Order, 6 sem Order). As 6 sem Order continuam protegidas: não foram expiradas automaticamente, não receberam nova Order e não podem iniciar outro POST. A versão `202609260001` permanece ausente de `supabase_migrations.schema_migrations`; o histórico remoto já divergia para migrations anteriores e não foi reparado.

O endpoint interno existe apenas no código local: ainda faltam commit, push/deploy, `PAYMENT_RECONCILIATION_SECRET` em produção, teste manual da rota publicada, Vault, scheduler/Cron e homologação final ponta a ponta. O webhook Mercado Pago já passou por teste de assinatura válida e HTTP 200 via túnel temporário, mas ainda precisa ser validado no domínio definitivo após o deploy. O túnel não é infraestrutura definitiva.

`202609260001_pix_expiry_reconciliation.sql` classificou as tentativas anteriores como `legacy` e define as novas como `not_started`. Somente uma transição atômica de `not_started` para `started` autoriza o POST; o marcador nunca é limpo para repetir o envio. A expiração local atinge apenas tentativas novas comprovadamente não enviadas. Uma tentativa legada sem ID de Order continua indeterminada, mesmo vencida, e não pode criar outra Order nem expirar automaticamente. Confirmed históricos não foram alterados. Investigar manualmente as tentativas legadas com `provider_order_id is null`; não inferir ausência de Order pelo valor `NULL`.

Uma tentativa nova com `order_submission_state='started'` e `provider_order_id is null` também continua `pending` para investigação, inclusive após `expires_at`. Ela pode ter chegado ao Mercado Pago; não repetir o POST nem declarar expiração financeira sem evidência do provedor. A fila operacional desses dois grupos pode ser identificada por `payment_status='pending'`, `provider_order_id is null` e `order_submission_state in ('legacy','started')`.

Orders conhecidas continuam sob autoridade do Mercado Pago. Quando o job estiver configurado, após a primeira observação de `failed` ou `expired`, ele acompanhará a Order por **24 horas**, consultando-a no máximo uma vez a cada **30 minutos**. A janela é limitada para não consultar indefinidamente uma cobrança terminal, mas cobre mudanças tardias durante o primeiro dia após o estado terminal. Tentativas já terminais antes da migration, com Order conhecida, recebem uma janela de 24 horas a partir da aplicação. Uma confirmação `processed/accredited` nessa janela é registrada normalmente, inclusive acima da meta; após a janela, uma notificação válida ainda pode reconciliar a Order, mas o job não a consulta automaticamente. Monitorar operacionalmente eventuais confirmações excepcionalmente tardias.

Após o deploy e antes de habilitar o agendamento, configurar `PAYMENT_RECONCILIATION_SECRET` com o mesmo valor aleatório de pelo menos 32 caracteres no ambiente privado do Next.js e no Supabase Vault. Guardar também no Vault a URL HTTPS definitiva da rota `POST /api/internal/reconcile-gift-payments`. Não colocar valores em SQL versionado nem usar URL temporária de túnel.

No Supabase Dashboard, habilitar Cron (`pg_cron`) e `pg_net` se ainda não estiverem habilitados. Criar no Vault os nomes `payment_reconciliation_url` e `payment_reconciliation_secret`. Então cadastrar no SQL Editor, após revisão, um job de cinco minutos que faça somente a chamada HTTP abaixo. A URL e o segredo podem ser atualizados no Vault sem mudar a migration:

```sql
select cron.schedule(
  'reconcile-gift-pix-every-five-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'payment_reconciliation_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'payment_reconciliation_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

Validar uma execução no Dashboard e monitorar **tanto** `cron.job_run_details` **quanto** o resultado HTTP em `net._http_response`, associando o `request_id` retornado por `net.http_post`. Sucesso do `pg_cron` significa que a requisição foi enfileirada; não comprova HTTP 200. Detectar 401, 429, 5xx, timeout e falhas de rede antes de considerar o agendamento saudável. O segredo permanece no Vault e nenhum valor real entra no SQL versionado. A rota não aceita requisições sem o segredo correto. Cada execução processa no máximo dez Orders conhecidas; falhas de rede ou do provedor não mudam o status financeiro. Se uma Order permanecer em processamento após o prazo, ela exige acompanhamento: o relógio local não autoriza encerrar um pagamento que o Mercado Pago ainda considera válido.
