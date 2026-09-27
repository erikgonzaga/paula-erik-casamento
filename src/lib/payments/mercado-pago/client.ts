import 'server-only';
import { logDevelopmentDiagnostic, safeDiagnosticCode, safeDiagnosticText } from '@/lib/server-diagnostics';
import { getPaymentsEnvironment } from '@/lib/payments/environment';

export type MercadoPagoPayment = {
  id: string | null;
  amount: string;
  status: string;
  status_detail: string;
  payment_method: {
    id: string;
    type: string;
    ticket_url: string | null;
    qr_code: string | null;
    qr_code_base64: string | null;
  };
};

export type MercadoPagoOrder = {
  id: string;
  external_reference: string;
  total_amount: string;
  currency_id: string;
  status: string;
  status_detail: string;
  user_id: string | null;
  application_id: string | null;
  payment: MercadoPagoPayment | null;
};

export class MercadoPagoError extends Error {
  constructor(
    public code: 'configuration' | 'unavailable' | 'invalid_response',
    public diagnostic?: Record<string, string | number | undefined>,
  ) {
    super(code);
  }
}

type Fetch = typeof fetch;
const apiBase = 'https://api.mercadopago.com';

// Provider messages can contain indexed field paths. Keep those paths readable
// while the shared sanitizer still rejects emails, credentials and payloads.
function safeProviderText(value: unknown): string | undefined {
  return safeDiagnosticText(typeof value === 'string' ? value.replace(/\[(\d{1,3})\]/g, '.$1') : value);
}

function safeProviderCause(value: unknown): string | undefined {
  const entries = Array.isArray(value) ? value.slice(0, 5) : [value];
  const safeEntries = entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const safe = {
      code: safeDiagnosticCode(source.code),
      type: safeDiagnosticCode(source.type),
      message: safeProviderText(source.message),
      description: safeProviderText(source.description),
      field: safeProviderText(source.field),
    };
    return Object.values(safe).some(Boolean) ? [safe] : [];
  });
  return safeEntries.length ? JSON.stringify(Array.isArray(value) ? safeEntries : safeEntries[0]) : undefined;
}

function safeOrderRequestSummary(body: BodyInit | null | undefined): string | undefined {
  if (typeof body !== 'string') return undefined;
  try {
    const input = JSON.parse(body) as Record<string, unknown>;
    const transactions = input.transactions as { payments?: Array<{ amount?: unknown }> } | undefined;
    const items = Array.isArray(input.items) ? input.items : [];
    const safeMoney = (value: unknown) => typeof value === 'string' && /^\d{1,12}\.\d{2}$/.test(value)
      ? value : undefined;
    return JSON.stringify({
      total_amount: safeMoney(input.total_amount),
      items: items.slice(0, 5).map(item => {
        const entry = item as Record<string, unknown>;
        return {
          external_code: safeDiagnosticCode(entry.external_code),
          title: safeProviderText(entry.title),
          quantity: typeof entry.quantity === 'number' && Number.isSafeInteger(entry.quantity)
            ? entry.quantity : undefined,
          unit_price: safeMoney(entry.unit_price),
        };
      }),
      payment_amount: safeMoney(transactions?.payments?.[0]?.amount),
    });
  } catch {
    return undefined;
  }
}

function configuration() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  let environment: 'test' | 'production';
  try {
    environment = getPaymentsEnvironment();
  } catch {
    throw new MercadoPagoError('configuration');
  }
  if (!accessToken) throw new MercadoPagoError('configuration');
  return { accessToken, environment } as const;
}

function text(value: unknown, maximum = 255): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

function parseOrder(value: unknown): MercadoPagoOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MercadoPagoError('invalid_response');
  const input = value as Record<string, unknown>;
  const transactions = input.transactions && typeof input.transactions === 'object'
    ? input.transactions as Record<string, unknown> : null;
  const payments = Array.isArray(transactions?.payments) ? transactions.payments : [];
  const rawPayment = payments[0] && typeof payments[0] === 'object' ? payments[0] as Record<string, unknown> : null;
  const rawMethod = rawPayment?.payment_method && typeof rawPayment.payment_method === 'object'
    ? rawPayment.payment_method as Record<string, unknown> : null;
  const integration = input.integration_data && typeof input.integration_data === 'object'
    ? input.integration_data as Record<string, unknown> : null;
  const id = text(input.id);
  const externalReference = text(input.external_reference);
  const totalAmount = text(input.total_amount, 32);
  const status = text(input.status, 64);
  const statusDetail = text(input.status_detail, 128);
  if (!id || !externalReference || !totalAmount || !status || !statusDetail) {
    throw new MercadoPagoError('invalid_response');
  }
  let payment: MercadoPagoPayment | null = null;
  if (rawPayment) {
    const amount = text(rawPayment.amount, 32);
    const paymentStatus = text(rawPayment.status, 64);
    const paymentDetail = text(rawPayment.status_detail, 128);
    const methodId = text(rawMethod?.id, 64);
    const methodType = text(rawMethod?.type, 64);
    if (!amount || !paymentStatus || !paymentDetail || !methodId || !methodType) {
      throw new MercadoPagoError('invalid_response');
    }
    payment = {
      id: text(rawPayment.id),
      amount,
      status: paymentStatus,
      status_detail: paymentDetail,
      payment_method: {
        id: methodId,
        type: methodType,
        ticket_url: text(rawMethod?.ticket_url, 2048),
        qr_code: text(rawMethod?.qr_code, 8192),
        qr_code_base64: text(rawMethod?.qr_code_base64, 262144),
      },
    };
  }
  return {
    id,
    external_reference: externalReference,
    total_amount: totalAmount,
    currency_id: text(input.currency_id, 3) ?? 'BRL',
    status,
    status_detail: statusDetail,
    user_id: input.user_id === undefined || input.user_id === null ? null : String(input.user_id),
    application_id: integration?.application_id === undefined || integration.application_id === null
      ? null : String(integration.application_id),
    payment,
  };
}

async function request(path: string, init: RequestInit, fetchImplementation: Fetch): Promise<MercadoPagoOrder> {
  const { accessToken } = configuration();
  const operation = init.method === 'POST' ? 'POST /v1/orders' : 'GET /v1/orders/{id}';
  let response: Response;
  try {
    response = await fetchImplementation(`${apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    logDevelopmentDiagnostic('mercado-pago', { operation, code: 'network_unavailable' });
    throw new MercadoPagoError('unavailable');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown> : {};
    const diagnostic = {
      operation,
      httpStatus: response.status,
      error: safeDiagnosticCode(error.error) ?? safeProviderText(error.error),
      code: safeDiagnosticCode(error.code),
      message: safeProviderText(error.message),
      cause: safeProviderCause(error.cause),
      requestId: safeDiagnosticCode(response.headers.get('x-request-id'))
        ?? safeDiagnosticCode(response.headers.get('x-correlation-id'))
        ?? safeDiagnosticCode(error.request_id),
      requestSummary: operation === 'POST /v1/orders' ? safeOrderRequestSummary(init.body) : undefined,
    };
    logDevelopmentDiagnostic('mercado-pago', diagnostic);
    throw new MercadoPagoError('unavailable', diagnostic);
  }
  try {
    return parseOrder(await response.json());
  } catch (error) {
    logDevelopmentDiagnostic('mercado-pago', { operation, httpStatus: response.status, code: 'invalid_response' });
    if (error instanceof MercadoPagoError) throw error;
    throw new MercadoPagoError('invalid_response');
  }
}

export function createPixOrder(input: {
  amount: string | number;
  giftId: string;
  giftName: string;
  externalReference: string;
  idempotencyKey: string;
  payerEmail: string;
  payerName: string;
}, fetchImplementation: Fetch = fetch) {
  const amount = normalizeMercadoPagoAmount(input.amount);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.giftId) ||
      !input.giftName?.trim() || input.giftName.length > 150) {
    throw new MercadoPagoError('invalid_response');
  }
  const { environment } = configuration();
  const payer = environment === 'test'
    ? { email: 'test_user_br@testuser.com', first_name: 'APRO' }
    : { email: input.payerEmail, first_name: input.payerName };
  return request('/v1/orders', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify({
      type: 'online',
      processing_mode: 'automatic',
      total_amount: amount,
      external_reference: input.externalReference,
      items: [{ title: input.giftName, quantity: 1, unit_price: amount }],
      payer,
      transactions: { payments: [{
        amount,
        payment_method: { id: 'pix', type: 'bank_transfer' },
        expiration_time: 'PT30M',
      }] },
    }),
  }, fetchImplementation);
}

export function normalizeMercadoPagoAmount(value: string | number): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new MercadoPagoError('invalid_response');
  }
  const decimal = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) {
    throw new MercadoPagoError('invalid_response');
  }
  const [whole, fraction = ''] = decimal.split('.');
  if (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0')) === BigInt(0)) {
    throw new MercadoPagoError('invalid_response');
  }
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function getOrder(id: string, fetchImplementation: Fetch = fetch) {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) throw new MercadoPagoError('invalid_response');
  return request(`/v1/orders/${encodeURIComponent(id)}`, { method: 'GET' }, fetchImplementation);
}

export function assertExpectedOrder(order: MercadoPagoOrder, expected: {
  amount: string | number;
  externalReference: string;
}) {
  const cents = (value: string) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  };
  const orderAmount = cents(order.total_amount);
  const expectedAmount = cents(normalizeMercadoPagoAmount(expected.amount));
  if (orderAmount === null || expectedAmount === null || order.external_reference !== expected.externalReference || orderAmount !== expectedAmount || order.currency_id !== 'BRL') {
    throw new MercadoPagoError('invalid_response');
  }
  if (order.payment && (
    cents(order.payment.amount) !== expectedAmount ||
    order.payment.payment_method.id !== 'pix' ||
    order.payment.payment_method.type !== 'bank_transfer'
  )) {
    throw new MercadoPagoError('invalid_response');
  }
  const expectedUser = process.env.MERCADO_PAGO_USER_ID;
  const expectedApplication = process.env.MERCADO_PAGO_APPLICATION_ID;
  if (expectedUser && order.user_id !== expectedUser) throw new MercadoPagoError('invalid_response');
  if (expectedApplication && order.application_id !== expectedApplication) throw new MercadoPagoError('invalid_response');
}
