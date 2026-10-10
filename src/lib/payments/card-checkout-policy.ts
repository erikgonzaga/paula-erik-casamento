import 'server-only';
import { previewFeatureDiagnostic } from '@/lib/server-diagnostics';

// Homologation only. No flag value can enable real card payments in this stage.
export function creditCardCheckoutEnabled() {
  const enabled = process.env.PAYMENTS_ENVIRONMENT === 'test' &&
    process.env.ENABLE_CREDIT_CARD_CHECKOUT === 'true' &&
    Boolean(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim());
  previewFeatureDiagnostic({
    paymentsEnvironmentIsTest: process.env.PAYMENTS_ENVIRONMENT === 'test',
    creditCardFlagIsTrue: process.env.ENABLE_CREDIT_CARD_CHECKOUT === 'true',
    mercadoPagoPublicKeyPresent: Boolean(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY?.trim()),
    mercadoPagoAccessTokenPresent: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN),
    creditCardCheckoutEnabled: enabled,
  });
  return enabled;
}
