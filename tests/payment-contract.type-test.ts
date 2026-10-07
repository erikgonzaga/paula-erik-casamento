import type { PaymentAttemptMethod, PaymentMethod } from '../src/lib/payments/contracts';

const firstInstallment: PaymentAttemptMethod = { payment_method: 'credit_card', installments: 1, provider_payment_method_id: 'visa' };
const lastInstallment: PaymentAttemptMethod = { payment_method: 'credit_card', installments: 12, provider_payment_method_id: 'visa' };
const pix: PaymentAttemptMethod = { payment_method: 'pix', installments: null, provider_payment_method_id: 'pix' };
const external: PaymentAttemptMethod = { payment_method: 'external', installments: null, provider_payment_method_id: null };
// @ts-expect-error Credit card installments are mandatory.
const missing: PaymentAttemptMethod = { payment_method: 'credit_card', provider_payment_method_id: 'visa' };
// @ts-expect-error Pix cannot have installments.
const pixInstallments: PaymentAttemptMethod = { payment_method: 'pix', installments: 1, provider_payment_method_id: 'pix' };
// @ts-expect-error The domain permits at most 12 installments.
const tooMany: PaymentAttemptMethod = { payment_method: 'credit_card', installments: 13, provider_payment_method_id: 'visa' };
// @ts-expect-error Fractional installments are not in the domain.
const fractional: PaymentAttemptMethod = { payment_method: 'credit_card', installments: 1.5, provider_payment_method_id: 'visa' };
// @ts-expect-error Raw token is never persistable method metadata.
const rawToken: PaymentAttemptMethod = { payment_method: 'credit_card', installments: 1, provider_payment_method_id: 'visa', token: 'fixture' };
// @ts-expect-error Unsupported payment method.
const invalidMethod: PaymentMethod = 'debit_card';

void [firstInstallment, lastInstallment, pix, external, missing, pixInstallments, tooMany, fractional, rawToken, invalidMethod];
