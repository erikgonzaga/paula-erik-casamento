export type PaymentMethod = 'pix' | 'credit_card' | 'external';
export type PaymentEnvironment = 'test' | 'production';
export type CardInstallments = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

// Request-lifetime values only. Never pass this object to database writes/logs.
export type CreditCardInput = {
  card_token: string;
  payment_method_id: string;
  installments: CardInstallments;
  payer?: { identification: { type: 'CPF' | 'CNPJ'; number: string } };
  device_id?: string;
};
export type ContributionPaymentInput =
  | { payment_method: 'pix' }
  | ({ payment_method: 'credit_card' } & CreditCardInput);

export function parseContributionPayment(input: Record<string, unknown>): ContributionPaymentInput {
  const fail = (): never => { throw new Error('invalid_card_payment'); };
  const method = input.payment_method === undefined ? 'pix' : input.payment_method;
  const cardKeys = ['card_token', 'payment_method_id', 'installments', 'payer', 'device_id'];
  if (method === 'pix') {
    if (cardKeys.some(key => Object.hasOwn(input, key))) return fail();
    return { payment_method: 'pix' };
  }
  if (method !== 'credit_card') return fail();
  const metadata = validatePaymentAttemptMethod({ payment_method: method,
    installments: input.installments, provider_payment_method_id: input.payment_method_id });
  if (metadata.payment_method !== 'credit_card') return fail();
  if (typeof input.card_token !== 'string' || input.card_token !== input.card_token.trim() ||
      input.card_token.length < 1 || input.card_token.length > 2048 ||
      /[\x00-\x1f\x7f]/.test(input.card_token)) return fail();
  const payment: ContributionPaymentInput = { payment_method: 'credit_card',
    card_token: input.card_token, payment_method_id: metadata.provider_payment_method_id,
    installments: metadata.installments };
  if (input.payer !== undefined) {
    if (!input.payer || typeof input.payer !== 'object' || Array.isArray(input.payer)) return fail();
    const payer = input.payer as Record<string, unknown>;
    if (Object.keys(payer).length !== 1 || !payer.identification ||
        typeof payer.identification !== 'object' || Array.isArray(payer.identification)) return fail();
    const document = payer.identification as Record<string, unknown>;
    if (Object.keys(document).length !== 2 || !['CPF', 'CNPJ'].includes(String(document.type)) ||
        typeof document.number !== 'string' ||
        !(document.type === 'CPF' ? /^\d{11}$/ : /^\d{14}$/).test(document.number)) return fail();
    payment.payer = { identification: { type: document.type as 'CPF' | 'CNPJ', number: document.number } };
  }
  if (input.device_id !== undefined) {
    if (typeof input.device_id !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(input.device_id)) return fail();
    payment.device_id = input.device_id;
  }
  return payment;
}

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
  if (methodId !== null) {
    if (typeof methodId !== 'string' || methodId !== methodId.trim()) return fail();
    const characters = Array.from(methodId);
    if (characters.length < 1 || characters.length > 64 || characters.some(character => {
      const code = character.codePointAt(0)!;
      return code <= 31 || (code >= 127 && code <= 159);
    })) return fail();
  }
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
