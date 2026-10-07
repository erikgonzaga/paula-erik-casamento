export type PaymentMethod = 'pix' | 'credit_card' | 'external';
export type PaymentEnvironment = 'test' | 'production';
export type CardInstallments = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

// Persistable metadata only. Card tokens and cardholder input do not belong here.
export type PaymentAttemptMethod =
  | { payment_method: 'pix'; installments: null; provider_payment_method_id: 'pix' }
  | { payment_method: 'credit_card'; installments: CardInstallments; provider_payment_method_id: string }
  | { payment_method: 'external'; installments: null; provider_payment_method_id: string | null };

export type FinancialAdjustmentKind = 'refund' | 'chargeback' | 'chargeback_reversal';
export type FinancialAdjustment = {
  attempt_id: string;
  payment_environment: PaymentEnvironment;
  provider: 'mercado_pago';
  external_reference: string;
  kind: FinancialAdjustmentKind;
  amount: string;
  occurred_at: string;
};

export function validatePaymentAttemptMethod(value: unknown): PaymentAttemptMethod {
  const fail = (): never => { throw new Error('invalid_payment_attempt_method'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['payment_method', 'installments', 'provider_payment_method_id'].includes(key))) return fail();
  const methodId = input.provider_payment_method_id;
  if (methodId !== null && (typeof methodId !== 'string' || !/^[a-z0-9_]{1,64}$/.test(methodId))) return fail();
  if (input.payment_method === 'pix' && input.installments === null && methodId === 'pix')
    return { payment_method: 'pix', installments: null, provider_payment_method_id: 'pix' };
  if (input.payment_method === 'external' && input.installments === null)
    return { payment_method: 'external', installments: null, provider_payment_method_id: methodId as string | null };
  if (input.payment_method === 'credit_card' && typeof input.installments === 'number' &&
      Number.isInteger(input.installments) && input.installments >= 1 && input.installments <= 12 &&
      typeof methodId === 'string' && methodId !== 'pix')
    return { payment_method: 'credit_card', installments: input.installments as CardInstallments, provider_payment_method_id: methodId };
  return fail();
}
