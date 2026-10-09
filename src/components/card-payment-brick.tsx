'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cardBrickManager } from '@/lib/payments/card-brick-lifecycle';
import { brickPaymentInput } from '@/lib/payments/card-checkout';
import { cardDeviceId } from '@/lib/payments/card-sdk';
import type { CreditCardInput } from '@/lib/payments/contracts';
import styles from './gift-contribution-form.module.css';

export function CardPaymentBrick({ amount, email, onSubmit }: {
  amount: number; email: string; onSubmit(payment: CreditCardInput): Promise<void>;
}) {
  const id = `card-brick-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const submit = useRef(onSubmit);
  useEffect(() => { submit.current = onSubmit; }, [onSubmit]);
  useEffect(() => {
    const lease = cardBrickManager.mount(id, {
      initialization: { amount, payer: { email } },
      customization: { paymentMethods: { types: { excluded: ['debit_card', 'prepaid_card'] }, minInstallments: 1, maxInstallments: 12 },
        visual: { style: { theme: 'flat' } } },
      callbacks: {
        onReady: () => setLoading(false),
        onError: () => { setLoading(false); setFailed(true); },
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
    return () => { void lease.dispose(); };
  }, [amount, email, id]);
  return <section className={styles.cardBrick} aria-label="Pagamento com cartão de crédito">
    {loading && <p className={styles.waiting} role="status">Preparando o formulário seguro…</p>}
    {failed && <p className={styles.error} role="alert">Não foi possível carregar o formulário do cartão. Volte ao Pix ou recarregue a página antes de tentar novamente.</p>}
    <div id={id} />
  </section>;
}
