export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store, max-age=0' };

// Temporary Preview TEST diagnostic. Never return provider identity or PII.
export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.PAYMENTS_ENVIRONMENT !== 'test') {
    return new Response(null, { status: 404, headers });
  }

  let httpStatus: number | null = null;
  try {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
    if (!token) throw new Error('Unavailable credential');
    const response = await fetch('https://api.mercadolibre.com/users/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    httpStatus = response.status;
    if (!response.ok) throw new Error('Provider response unavailable');
    const body: unknown = await response.json();
    const id = body && typeof body === 'object' && 'id' in body ? body.id : null;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error('Invalid identity');
    }
    console.info('[mercado-pago-test-identity]', { user_id: id, environment: 'test' });
    return Response.json({ ok: true }, { headers });
  } catch {
    console.warn('[mercado-pago-test-identity]', { ok: false, httpStatus });
    return Response.json({ ok: false }, { status: 503, headers });
  }
}

// Avoid Next's implicit HEAD invoking GET (and therefore the provider).
export function HEAD() {
  return new Response(null, { status: 404, headers });
}
