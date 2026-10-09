import 'server-only';

// Homologation only. No flag value can enable real card payments in this stage.
export function creditCardCheckoutEnabled() {
  return process.env.PAYMENTS_ENVIRONMENT === 'test' &&
    process.env.ENABLE_CREDIT_CARD_CHECKOUT === 'true' &&
    Boolean(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim());
}
