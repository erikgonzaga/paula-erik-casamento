'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cardBrickManager } from '@/lib/payments/card-brick-lifecycle';
import { brickPaymentInput } from '@/lib/payments/card-checkout';
import { cardDeviceId, getCardInstallments } from '@/lib/payments/card-sdk';
import { sanitizeInstallmentOffers, formatInstallmentMoney, formatInstallmentRate,
  type InstallmentOffer } from '@/lib/payments/card-installment-diagnostics';
import type { CreditCardInput } from '@/lib/payments/contracts';
import styles from './gift-contribution-form.module.css';

type InstallmentDiagnostic = { status: 'waiting' | 'loading' | 'ready' | 'error'; offers: InstallmentOffer[] };

export function CardPaymentBrick({ amount, email, onSubmit, installmentDiagnosticsEnabled = false }: {
  amount: number; email: string; onSubmit(payment: CreditCardInput): Promise<void>;
  installmentDiagnosticsEnabled?: boolean;
}) {
  const id = `card-brick-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [diagnostic, setDiagnostic] = useState<InstallmentDiagnostic>({ status: 'waiting', offers: [] });
  const submit = useRef(onSubmit);
  useEffect(() => { submit.current = onSubmit; }, [onSubmit]);
  useEffect(() => {
    let active = true;
    let diagnosticVersion = 0;
    const onBinChange = (bin: unknown) => {
      const version = ++diagnosticVersion;
      setDiagnostic({ status: 'waiting', offers: [] });
      // Pre-submit BIN is provisional: it is never used for a financial decision.
      if (typeof bin !== 'string' || !/^(?:\d{6}|\d{8})$/.test(bin)) return;
      setDiagnostic({ status: 'loading', offers: [] });
      void getCardInstallments(amount, bin).then(response => {
        if (active && version === diagnosticVersion) {
          setDiagnostic({ status: 'ready', offers: sanitizeInstallmentOffers(response, bin) });
        }
      }).catch(() => {
        if (active && version === diagnosticVersion) setDiagnostic({ status: 'error', offers: [] });
      });
    };
    const lease = cardBrickManager.mount(id, {
      initialization: { amount, payer: { email } },
      customization: { paymentMethods: { types: { excluded: ['debit_card', 'prepaid_card'] }, minInstallments: 1, maxInstallments: 12 },
        visual: { style: { theme: 'flat' } } },
      callbacks: {
        onReady: () => setLoading(false),
        onError: () => { setLoading(false); setFailed(true); },
        ...(installmentDiagnosticsEnabled ? { onBinChange } : {}),
        onSubmit: async (data, additional) => {
          let payment: CreditCardInput | undefined;
          try {
            payment = brickPaymentInput(data, additional, cardDeviceId());
            await submit.current(payment);
          } catch { throw new Error('card_submission_unavailable'); }
          finally { if (payment) { payment.card_token = ''; delete payment.payer; delete payment.device_id; } }
        },
      },
    });
    return () => { active = false; diagnosticVersion++; void lease.dispose(); };
  }, [amount, email, id, installmentDiagnosticsEnabled]);
  return <section className={styles.cardBrick} aria-label="Pagamento com cartão de crédito">
    {loading && <p className={styles.waiting} role="status">Preparando o formulário seguro…</p>}
    {failed && <p className={styles.error} role="alert">Não foi possível carregar o formulário do cartão. Volte ao Pix ou recarregue a página antes de tentar novamente.</p>}
    <div id={id} data-mp-brick-host />
    {installmentDiagnosticsEnabled && <details className={styles.installmentDiagnostic} open>
      <summary>Diagnóstico temporário de parcelamento · TEST</summary>
      <p>Valor consultado: {formatInstallmentMoney(amount)}. Use somente cartões de teste, sem clicar em Pagar.</p>
      <p>Oferta indicativa antes do pagamento; não confirma nem altera a contribuição.</p>
      <div className={styles.installmentDiagnosticResults} aria-live="polite">
        {diagnostic.status === 'waiting' && <p>Aguardando identificação do cartão de teste.</p>}
        {diagnostic.status === 'loading' && <p>Consultando condições de parcelamento…</p>}
        {diagnostic.status === 'error' && <p>Não foi possível consultar as condições de parcelamento.</p>}
        {diagnostic.status === 'ready' && diagnostic.offers.length === 0 && <p>Nenhuma condição de parcelamento disponível nesta consulta.</p>}
        {diagnostic.status === 'ready' && diagnostic.offers.map((offer, index) => <article className={styles.installmentDiagnosticOffer} key={index}>
          <strong>Método: {offer.payment_method_id ?? '—'} · {offer.installments}x</strong>
          <dl>
            <dt>issuer_id</dt><dd>{offer.issuer_id ?? '—'}</dd>
            <dt>issuer_name</dt><dd>{offer.issuer_name ?? '—'}</dd>
            <dt>Parcela</dt><dd>{formatInstallmentMoney(offer.installment_amount)}</dd>
            <dt>Total</dt><dd>{formatInstallmentMoney(offer.total_amount)}</dd>
            <dt>Taxa</dt><dd>{formatInstallmentRate(offer.installment_rate)}</dd>
            <dt>discount_rate</dt><dd>{formatInstallmentRate(offer.discount_rate)}</dd>
            <dt>installment_rate_collector</dt><dd>{offer.installment_rate_collector.join(', ') || '—'}</dd>
            <dt>labels</dt><dd>{offer.labels.join(', ') || '—'}</dd>
            <dt>payment_method_option_id</dt><dd>{offer.payment_method_option_id ?? '—'}</dd>
          </dl>
        </article>)}
      </div>
    </details>}
  </section>;
}
