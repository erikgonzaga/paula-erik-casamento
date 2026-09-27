import 'server-only';

export type PaymentsEnvironment = 'test' | 'production';

export function getPaymentsEnvironment(): PaymentsEnvironment {
  const environment = process.env.PAYMENTS_ENVIRONMENT;
  if (environment !== 'test' && environment !== 'production') {
    throw new Error('invalid_payments_environment');
  }
  return environment;
}
