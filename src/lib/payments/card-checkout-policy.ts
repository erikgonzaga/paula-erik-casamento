import 'server-only';

// New card checkouts require an explicit opt-in in a recognized environment.
export function creditCardCheckoutEnabled() {
  const environment = process.env.PAYMENTS_ENVIRONMENT;
  const enabled = (environment === 'test' || environment === 'production') &&
    process.env.ENABLE_CREDIT_CARD_CHECKOUT === 'true' &&
    Boolean(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim());
  return enabled;
}
