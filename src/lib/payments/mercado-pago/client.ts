import 'server-only';
import { parseContributionPayment, type CreditCardInput } from '@/lib/payments/contracts';
import { logDevelopmentDiagnostic, safeDiagnosticCode, safeDiagnosticText } from '@/lib/server-diagnostics';

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
    installments?: number | null;
    challenge_url?: string | null;
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
function safeProviderText(value: unknown, sensitive: string[] = []): string | undefined {
  if (typeof value === 'string' && sensitive.some(secret => secret && value.includes(secret))) return '[redacted]';
  return safeDiagnosticText(typeof value === 'string' ? value.replace(/\[(\d{1,3})\]/g, '.$1') : value);
}

function safeProviderCause(value: unknown, sensitive: string[] = []): string | undefined {
  const entries = Array.isArray(value) ? value.slice(0, 5) : [value];
  const safeEntries = entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const safe = {
      code: safeDiagnosticCode(safeProviderText(source.code, sensitive)),
      type: safeDiagnosticCode(safeProviderText(source.type, sensitive)),
      message: safeProviderText(source.message, sensitive),
      description: safeProviderText(source.description, sensitive),
      field: safeProviderText(source.field, sensitive),
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
  const environment = process.env.PAYMENTS_ENVIRONMENT;
  if (!accessToken || (environment !== 'test' && environment !== 'production')) {
    throw new MercadoPagoError('configuration');
  }
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
        ...(methodType === 'credit_card' ? {
          installments: typeof rawMethod?.installments === 'number' && Number.isInteger(rawMethod.installments)
            ? rawMethod.installments : null,
          challenge_url: challengeUrl(rawMethod?.transaction_security),
        } : {}),
      },
    };
  }
  return {
    id,
    external_reference: externalReference,
    total_amount: totalAmount,
    currency_id: text(input.currency_id, 3) ?? text(input.currency, 3) ?? 'BRL',
    status,
    status_detail: statusDetail,
    user_id: input.user_id === undefined || input.user_id === null ? null : String(input.user_id),
    application_id: integration?.application_id === undefined || integration.application_id === null
      ? null : String(integration.application_id),
    payment,
  };
}

function challengeUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = text((value as Record<string, unknown>).url, 4096);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function request(path: string, init: RequestInit, fetchImplementation: Fetch, sensitive: string[] = [], strictDiagnostic = false): Promise<MercadoPagoOrder> {
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
      error: strictDiagnostic ? undefined : safeDiagnosticCode(safeProviderText(error.error, sensitive)) ?? safeProviderText(error.error, sensitive),
      code: strictDiagnostic ? 'provider_http_error' : safeDiagnosticCode(safeProviderText(error.code, sensitive)),
      message: strictDiagnostic ? undefined : safeProviderText(error.message, sensitive),
      cause: strictDiagnostic ? undefined : safeProviderCause(error.cause, sensitive),
      requestId: safeDiagnosticCode(response.headers.get('x-request-id'))
        ?? safeDiagnosticCode(response.headers.get('x-correlation-id'))
        ?? safeDiagnosticCode(error.request_id),
      requestSummary: operation === 'POST /v1/orders' ? safeOrderRequestSummary(init.body) : undefined,
    };
    // The provider can echo request values in error messages. Card inputs are
    // request-local and must never escape through diagnostics or Error objects.
    for (const key of Object.keys(diagnostic) as Array<keyof typeof diagnostic>) {
      const value = diagnostic[key];
      if (typeof value === 'string' && sensitive.some(secret => secret && value.includes(secret))) {
        Object.assign(diagnostic, { [key]: '[redacted]' });
      }
    }
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

type OrderCreationInput = {
  amount: string | number;
  giftId: string;
  giftName: string;
  externalReference: string;
  idempotencyKey: string;
  payerEmail: string;
  payerName: string;
};

function orderBody(input: OrderCreationInput) {
  const amount = normalizeMercadoPagoAmount(input.amount);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.giftId) ||
      !input.giftName?.trim() || input.giftName.length > 150) {
    throw new MercadoPagoError('invalid_response');
  }
  return { type: 'online', processing_mode: 'automatic', total_amount: amount,
    external_reference: input.externalReference,
    items: [{ title: input.giftName, quantity: 1, unit_price: amount }] };
}

export function createPixOrder(input: OrderCreationInput, fetchImplementation: Fetch = fetch) {
  const body = orderBody(input);
  const { environment } = configuration();
  const payer = environment === 'test'
    ? { email: 'test_user_br@testuser.com', first_name: 'APRO' }
    : { email: input.payerEmail, first_name: input.payerName };
  return request('/v1/orders', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify({
      ...body,
      payer,
      transactions: { payments: [{
        amount: body.total_amount,
        payment_method: { id: 'pix', type: 'bank_transfer' },
        expiration_time: 'PT30M',
      }] },
    }),
  }, fetchImplementation);
}

export function createCreditCardOrder(input: OrderCreationInput & CreditCardInput, fetchImplementation: Fetch = fetch) {
  const card = parseContributionPayment({ payment_method: 'credit_card', ...input });
  if (card.payment_method !== 'credit_card') throw new MercadoPagoError('invalid_response');
  const body = orderBody(input);
  const { environment } = configuration();
  const payer = environment === 'test'
    ? { email: 'test@testuser.com', ...(card.payer ?? {}) }
    : { email: input.payerEmail, first_name: input.payerName, ...(card.payer ?? {}) };
  return request('/v1/orders', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': input.idempotencyKey,
      ...(card.device_id ? { 'X-meli-session-id': card.device_id } : {}) },
    body: JSON.stringify({ ...body, payer,
      config: { online: { transaction_security: { validation: 'on_fraud_risk', liability_shift: 'required' } } },
      transactions: { payments: [{ amount: body.total_amount, payment_method: {
        id: card.payment_method_id, type: 'credit_card', token: card.card_token, installments: card.installments,
      } }] },
    }),
  }, fetchImplementation, [card.card_token, card.device_id ?? '', card.payer?.identification.number ?? '', input.payerEmail, input.payerName]);
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

export function getOrder(id: string, fetchImplementation: Fetch = fetch, strictDiagnostic = false) {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(id)) throw new MercadoPagoError('invalid_response');
  return request(`/v1/orders/${encodeURIComponent(id)}`, { method: 'GET' }, fetchImplementation, [], strictDiagnostic);
}

export function assertExpectedOrder(order: MercadoPagoOrder, expected: {
  amount: string | number;
  externalReference: string;
  paymentMethod?: 'pix' | 'credit_card';
  paymentMethodId?: string;
  installments?: number | null;
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
  const card = expected.paymentMethod === 'credit_card';
  if (card && !order.payment) throw new MercadoPagoError('invalid_response');
  if (order.payment && (
    cents(order.payment.amount) !== expectedAmount ||
    order.payment.payment_method.id !== (card ? expected.paymentMethodId : 'pix') ||
    order.payment.payment_method.type !== (card ? 'credit_card' : 'bank_transfer') ||
    (card && order.payment.payment_method.installments !== expected.installments) ||
    (card && order.status === 'processed' && order.status_detail === 'accredited' &&
      (order.payment.status !== 'processed' || order.payment.status_detail !== 'accredited'))
  )) {
    throw new MercadoPagoError('invalid_response');
  }
  const expectedUser = process.env.MERCADO_PAGO_USER_ID;
  const expectedApplication = process.env.MERCADO_PAGO_APPLICATION_ID;
  if (expectedUser && order.user_id !== expectedUser) throw new MercadoPagoError('invalid_response');
  if (expectedApplication && order.application_id !== expectedApplication) throw new MercadoPagoError('invalid_response');
}
