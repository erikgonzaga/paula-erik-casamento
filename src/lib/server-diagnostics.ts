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
  if (process.env.NODE_ENV !== 'development') return;
  console.error(`[payment-diagnostic:${source}]`, Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ));
}
