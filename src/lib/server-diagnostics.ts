// Provider error fields are untrusted. Log only a small allowlist of plain text;
// never log headers, request bodies or whole provider responses.
export function safeDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  const secrets = [
    process.env.MERCADO_PAGO_ACCESS_TOKEN,
    process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_ANON_KEY,
  ];
  if (
    text.length > 240 ||
    secrets.some(secret => secret && text.includes(secret)) ||
    /(?:authorization|bearer|access[_ -]?token|service[_ -]?role|api[_ -]?key|secret|password|qr[_ -]?code|copia e cola|payer[._ -]?email|base64)/i.test(text) ||
    /(?:https?:\/\/|@|[{}\[\]<>]|\b\d{25,}\b|[A-Za-z0-9_+\/-]{48,})/.test(text)
  ) return '[redacted]';
  return text;
}

export function safeDiagnosticCode(value: unknown): string | undefined {
  const safe = safeDiagnosticText(value);
  return safe && safe !== '[redacted]' && /^[A-Za-z0-9_.:-]{1,100}$/.test(safe)
    ? safe : undefined;
}

export function logDevelopmentDiagnostic(
  source: 'supabase' | 'mercado-pago',
  fields: Record<string, string | number | undefined>,
) {
  if (process.env.NODE_ENV !== 'development') {
    if (source === 'mercado-pago') previewPaymentCheckpoint('provider_error', {}, {
      code: fields.code, httpStatus: fields.httpStatus, requestId: fields.requestId,
    });
    return;
  }
  console.error(`[payment-diagnostic:${source}]`, Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ));
}

// Temporary homologation diagnostics: no payloads, Error messages or credentials.
export function previewTestDiagnosticsEnabled() {
  return process.env.VERCEL_ENV === 'preview' && process.env.PAYMENTS_ENVIRONMENT === 'test';
}
export type PaymentDiagnosticContext = {
  contribution_id?: string;
  attempt_id?: string;
  payment_method?: string;
  payment_environment?: string | null;
};
export function previewFeatureDiagnostic(fields: Record<string, boolean>) {
  if (!previewTestDiagnosticsEnabled()) return;
  try { console.info('[payment-preview-feature]', fields); } catch { /* Observability only. */ }
}
export function previewPaymentCheckpoint(stage: string, context: PaymentDiagnosticContext = {},
  detail: Record<string, unknown> = {}) {
  if (!previewTestDiagnosticsEnabled()) return;
  const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) ? value : undefined;
  const codes = ['configuration', 'unavailable', 'invalid_response', 'network_unavailable',
    'provider_http_error', 'payment_environment_mismatch', 'payment_attempt_method_mismatch',
    'payment_order_mismatch', 'payment_gift_unavailable', 'payment_reconciliation_failed', 'card_token_required'];
  try {
    console.info('[payment-preview-order]', Object.fromEntries(Object.entries({
      stage,
      contribution_id: uuid(context.contribution_id), attempt_id: uuid(context.attempt_id),
      payment_method: ['pix','credit_card','external'].includes(context.payment_method ?? '') ? context.payment_method : undefined,
      payment_environment: ['test','production'].includes(context.payment_environment ?? '') ? context.payment_environment : undefined,
      code: codes.includes(String(detail.code)) || /^(?:PGRST\d{3}|[0-9]{5})$/.test(String(detail.code))
        ? detail.code : detail.code ? 'internal_error' : undefined,
      errorType: ['mercado_pago','supabase','application'].includes(String(detail.errorType)) ? detail.errorType : undefined,
      httpStatus: typeof detail.httpStatus === 'number' ? detail.httpStatus : undefined,
      requestId: safeDiagnosticCode(detail.requestId),
    }).filter(([, value]) => value !== undefined)));
  } catch { /* Logging cannot affect payment. */ }
}
export function previewPaymentFailure(stage: string, context: PaymentDiagnosticContext, error: unknown) {
  const source = error instanceof Error ? error as Error & { code?: string; diagnostic?: Record<string, unknown> } : null;
  previewPaymentCheckpoint(stage, context, { code: source?.code ?? source?.diagnostic?.code ?? source?.message ?? 'internal_error',
    errorType: source?.code ? 'mercado_pago' : source?.diagnostic ? 'supabase' : 'application',
    httpStatus: source?.diagnostic?.httpStatus, requestId: source?.diagnostic?.requestId });
}
