import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { typescriptModule } from './typescript-fixture.mjs';

const contractsUrl = await typescriptModule('../src/lib/payments/contracts.ts');

const diagnosticSource = await readFile(new URL('../src/lib/server-diagnostics.ts', import.meta.url), 'utf8');
const diagnosticOutput = ts.transpileModule(diagnosticSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const diagnosticUrl = `data:text/javascript;base64,${Buffer.from(diagnosticOutput).toString('base64')}`;
const previewDiagnostics = await import(diagnosticUrl);
const source = (await readFile(new URL('../src/lib/payments/mercado-pago/client.ts', import.meta.url), 'utf8'))
  .replace("import 'server-only';", '')
  .replace("from '@/lib/payments/contracts'", `from '${contractsUrl}'`)
  .replace("from '@/lib/server-diagnostics'", `from '${diagnosticUrl}'`);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { assertExpectedOrder, createPixOrder, getOrder, MercadoPagoError, normalizeMercadoPagoAmount } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const mercadoPagoEntry = new URL('../node_modules/mercadopago/dist/index.js', import.meta.url).href;
const { WebhookSignatureValidator } = await import(mercadoPagoEntry);
const observedSdkUrl = `data:text/javascript;base64,${Buffer.from(`
  import { WebhookSignatureValidator as OfficialValidator } from '${mercadoPagoEntry}';
  export const validationCalls = [];
  export const WebhookSignatureValidator = {
    validate(options) {
      validationCalls.push(options);
      return OfficialValidator.validate(options);
    },
  };
`).toString('base64')}`;
const { validationCalls } = await import(observedSdkUrl);
const webhookSource = (await readFile(new URL('../src/lib/payments/mercado-pago/webhook.ts', import.meta.url), 'utf8'))
  .replace("import 'server-only';", '')
  .replace("from 'mercadopago'", `from '${observedSdkUrl}'`)
  .replace("from '@/lib/server-diagnostics'", `from '${diagnosticUrl}'`);
const webhookOutput = ts.transpileModule(webhookSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const webhookUrl = `data:text/javascript;base64,${Buffer.from(webhookOutput).toString('base64')}`;
const { validateMercadoPagoWebhook, MercadoPagoWebhookError } = await import(webhookUrl);
const serviceUrl = `data:text/javascript;base64,${Buffer.from(`
  export const processedCalls = [];
  export async function processMercadoPagoOrder(dataId, eventKey) {
    processedCalls.push({ dataId, eventKey });
  }
`).toString('base64')}`;
const { processedCalls } = await import(serviceUrl);
const routeSource = (await readFile(new URL('../src/app/api/payments/mercado-pago/webhook/route.ts', import.meta.url), 'utf8'))
  .replace("from '@/lib/payments/mercado-pago/webhook'", `from '${webhookUrl}'`)
  .replace("from '@/services/gift-payments'", `from '${serviceUrl}'`);
const routeOutput = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { POST: postWebhook } = await import(`data:text/javascript;base64,${Buffer.from(routeOutput).toString('base64')}`);

const previous = {
  token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
  environment: process.env.PAYMENTS_ENVIRONMENT,
  user: process.env.MERCADO_PAGO_USER_ID,
  application: process.env.MERCADO_PAGO_APPLICATION_ID,
  webhook: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
};
process.env.MERCADO_PAGO_ACCESS_TOKEN = 'TEST_TOKEN_NOT_REAL';
process.env.PAYMENTS_ENVIRONMENT = 'test';
delete process.env.MERCADO_PAGO_USER_ID;
delete process.env.MERCADO_PAGO_APPLICATION_ID;
process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'TEST_WEBHOOK_SECRET_NOT_REAL';

test('temporary diagnostics are Preview TEST only, sanitized, and do not change Pix serialization', async () => {
  const keys = ['VERCEL_ENV', 'NODE_ENV', 'PAYMENTS_ENVIRONMENT', 'ENABLE_CREDIT_CARD_CHECKOUT', 'NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalInfo = console.info, originalError = console.error;
  const logs = [];
  console.info = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  try {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CREDIT_CARD_CHECKOUT = 'true';
    process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY = 'MOCK_PUBLIC_KEY_SENSITIVE';
    const { creditCardCheckoutEnabled } = await import(await typescriptModule('../src/lib/payments/card-checkout-policy.ts'));
    for (const [vercel, environment, expected] of [['preview','test',true], ['production','test',false], ['preview','production',false], ['production','production',false]]) {
      logs.length = 0;
      process.env.VERCEL_ENV = vercel; process.env.PAYMENTS_ENVIRONMENT = environment;
      creditCardCheckoutEnabled();
      previewDiagnostics.previewPaymentFailure('before_provider_post', {}, new Error('MOCK_CARD_TOKEN_SENSITIVE'));
      previewDiagnostics.logDevelopmentDiagnostic('mercado-pago', {
        code: 'unavailable', message: 'MOCK_PAN_CVV_DOCUMENT_DEVICE_QR', requestSummary: 'MOCK_BODY', httpStatus: 400,
      });
      assert.equal(logs.length > 0, expected);
      if (expected) {
        const feature = logs.find(entry => entry[0] === '[payment-preview-feature]')[1];
        assert.ok(Object.values(feature).every(value => typeof value === 'boolean'));
        assert.equal(feature.creditCardCheckoutEnabled, true);
        const serialized = JSON.stringify(logs);
        for (const forbidden of ['MOCK_PUBLIC_KEY_SENSITIVE','MOCK_CARD_TOKEN_SENSITIVE','MOCK_PAN_CVV_DOCUMENT_DEVICE_QR','MOCK_BODY',process.env.MERCADO_PAGO_ACCESS_TOKEN]) assert.ok(!serialized.includes(forbidden));
      }
    }
    process.env.VERCEL_ENV = 'preview'; process.env.PAYMENTS_ENVIRONMENT = 'test'; logs.length = 0;
    const input = { amount: 50, giftId: 'c76c72a8-ad15-4095-8d07-fad27e8ec584', giftName: 'Fixture',
      externalReference: 'gift-contribution-c76c72a8-ad15-4095-8d07-fad27e8ec584', idempotencyKey: 'fixture', payerName: 'PRIVATE_NAME', payerEmail: 'private@example.invalid' };
    const bodies = [];
    const fake = async (_url, init) => {
      bodies.push(init.body);
      return Response.json({ id: 'ORDMOCK', external_reference: input.externalReference, total_amount: '50.00', status: 'processing', status_detail: 'in_process', transactions: { payments: [] } }, { status: 201 });
    };
    await createPixOrder(input, fake);
    assert.ok(logs.some(entry => entry[1]?.stage === 'provider_http_response'));
    assert.ok(logs.some(entry => entry[1]?.stage === 'provider_parse_ok'));
    process.env.VERCEL_ENV = 'production'; logs.length = 0;
    await createPixOrder(input, fake);
    assert.equal(bodies[0], bodies[1]); assert.equal(logs.length, 0);
    assert.ok(!bodies[0].includes('diagnosticContext'));
  } finally {
    console.info = originalInfo; console.error = originalError;
    for (const [key,value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test.after(() => {
  for (const [name, value] of Object.entries({
    MERCADO_PAGO_ACCESS_TOKEN: previous.token,
    PAYMENTS_ENVIRONMENT: previous.environment,
    MERCADO_PAGO_USER_ID: previous.user,
    MERCADO_PAGO_APPLICATION_ID: previous.application,
    MERCADO_PAGO_WEBHOOK_SECRET: previous.webhook,
  })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

const response = {
  id: 'ORD_TEST_1',
  external_reference: 'gift-contribution-10000000-0000-4000-8000-000000000001',
  total_amount: '50.0',
  currency_id: 'BRL',
  status: 'action_required',
  status_detail: 'waiting_transfer',
  integration_data: { application_id: '123' },
  user_id: '456',
  transactions: { payments: [{
    id: 'PAY_TEST_1', amount: '50.00', status: 'action_required', status_detail: 'waiting_transfer',
    payment_method: { id: 'pix', type: 'bank_transfer', qr_code: '000201-test', qr_code_base64: 'base64-test', ticket_url: 'https://example.test/pix' },
  }] },
};
const giftItem = {
  giftId: '10000000-0000-4000-8000-000000000099',
  giftName: 'Docinhos finos para adoçar nosso grande dia',
};

test('Orders Pix uses server credentials, stable idempotency and the official TEST simulation', async () => {
  let captured;
  const order = await createPixOrder({
    ...giftItem,
    amount: '50.00', externalReference: response.external_reference,
    idempotencyKey: '50000000-0000-4000-8000-000000000001',
    payerEmail: 'real@example.com', payerName: 'Pessoa Real',
  }, async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify(response), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(captured.url, 'https://api.mercadopago.com/v1/orders');
  assert.equal(captured.init.headers.Authorization, 'Bearer TEST_TOKEN_NOT_REAL');
  assert.equal(captured.init.headers['X-Idempotency-Key'], '50000000-0000-4000-8000-000000000001');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.external_reference, response.external_reference);
  assert.ok(!body.external_reference.includes(':'));
  assert.match(body.external_reference, /^gift-contribution-[0-9a-f-]{36}$/);
  assert.equal(body.total_amount, '50.00');
  assert.equal(typeof body.total_amount, 'string');
  assert.deepEqual(body.items, [{
    title: giftItem.giftName,
    quantity: 1,
    unit_price: '50.00',
  }]);
  assert.equal(Object.hasOwn(body.items[0], 'external_code'), false);
  assert.equal(body.items[0].unit_price, body.total_amount);
  assert.equal(body.transactions.payments[0].amount, body.total_amount);
  assert.equal(typeof body.transactions.payments[0].amount, 'string');
  assert.equal(body.processing_mode, 'automatic');
  assert.equal(body.payer.email, 'test_user_br@testuser.com');
  assert.equal(body.payer.first_name, 'APRO');
  assert.equal(body.transactions.payments[0].payment_method.id, 'pix');
  assert.equal(body.transactions.payments[0].payment_method.type, 'bank_transfer');
  assert.equal(body.transactions.payments[0].expiration_time, 'PT30M');
  assertExpectedOrder(order, { amount: '50.00', externalReference: response.external_reference });
});

test('production Pix Order keeps the real payer and never sends TEST/APRO data', async () => {
  const previousEnvironment = process.env.PAYMENTS_ENVIRONMENT;
  process.env.PAYMENTS_ENVIRONMENT = 'production';
  try {
    let captured;
    await createPixOrder({
      ...giftItem,
      amount: 50,
      externalReference: response.external_reference,
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      payerEmail: 'contributor@example.com',
      payerName: 'Pessoa Contribuinte',
    }, async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify(response), { status: 201 });
    });
    assert.equal(captured.url, 'https://api.mercadopago.com/v1/orders');
    assert.equal(captured.init.headers['X-Idempotency-Key'], '50000000-0000-4000-8000-000000000001');
    const body = JSON.parse(captured.init.body);
    assert.deepEqual(body.payer, { email: 'contributor@example.com', first_name: 'Pessoa Contribuinte' });
    assert.ok(!captured.init.body.includes('APRO'));
    assert.ok(!captured.init.body.includes('test_user_br@testuser.com'));
    assert.equal(body.type, 'online');
    assert.equal(body.processing_mode, 'automatic');
    assert.equal(body.total_amount, '50.00');
    assert.equal(body.external_reference, response.external_reference);
    assert.deepEqual(body.items, [{ title: giftItem.giftName, quantity: 1, unit_price: '50.00' }]);
    assert.deepEqual(body.transactions.payments, [{
      amount: '50.00',
      payment_method: { id: 'pix', type: 'bank_transfer' },
      expiration_time: 'PT30M',
    }]);
  } finally {
    if (previousEnvironment === undefined) delete process.env.PAYMENTS_ENVIRONMENT;
    else process.env.PAYMENTS_ENVIRONMENT = previousEnvironment;
  }
});

test('numeric RPC amount is sent as two decimal JSON strings and validates against the Order', async () => {
  let capturedBody;
  const order = await createPixOrder({
    ...giftItem,
    amount: 50, externalReference: response.external_reference,
    idempotencyKey: '50000000-0000-4000-8000-000000000001',
    payerEmail: 'unused@example.test', payerName: 'Unused',
  }, async (_url, init) => {
    capturedBody = init.body;
    return new Response(JSON.stringify(response), { status: 201 });
  });
  const body = JSON.parse(capturedBody);
  assert.equal(body.total_amount, '50.00');
  assert.equal(typeof body.total_amount, 'string');
  assert.equal(body.transactions.payments[0].amount, '50.00');
  assert.equal(typeof body.transactions.payments[0].amount, 'string');
  assert.equal(body.items[0].unit_price, '50.00');
  assert.equal(typeof body.items[0].unit_price, 'string');
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.items[0].title, giftItem.giftName);
  assert.equal(Object.hasOwn(body.items[0], 'external_code'), false);
  assert.equal(body.items[0].unit_price, body.total_amount);
  assert.equal(body.external_reference, response.external_reference);
  assertExpectedOrder(order, { amount: 50, externalReference: response.external_reference });
});

test('partial contribution of R$50.50 keeps item and Order totals equal as strings', async () => {
  let body;
  await createPixOrder({
    ...giftItem,
    amount: 50.5, externalReference: response.external_reference,
    idempotencyKey: '50000000-0000-4000-8000-000000000001',
    payerEmail: 'unused@example.test', payerName: 'Unused',
  }, async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      ...response, total_amount: '50.50',
      transactions: { payments: [{ ...response.transactions.payments[0], amount: '50.50' }] },
    }), { status: 201 });
  });
  assert.equal(body.total_amount, '50.50');
  assert.equal(body.transactions.payments[0].amount, '50.50');
  assert.equal(body.items[0].unit_price, '50.50');
  assert.equal(typeof body.items[0].unit_price, 'string');
  assert.equal(Object.hasOwn(body.items[0], 'external_code'), false);
  assert.equal(body.items[0].unit_price, body.total_amount);
});

test('retry serializes the same item and keeps the same idempotency key', async () => {
  const bodies = [];
  const keys = [];
  const input = {
    ...giftItem,
    amount: 50, externalReference: response.external_reference,
    idempotencyKey: '50000000-0000-4000-8000-000000000001',
    payerEmail: 'unused@example.test', payerName: 'Unused',
  };
  const mockedFetch = async (_url, init) => {
    bodies.push(init.body);
    keys.push(init.headers['X-Idempotency-Key']);
    return new Response(JSON.stringify(response), { status: 201 });
  };
  await createPixOrder(input, mockedFetch);
  await createPixOrder(input, mockedFetch);
  assert.deepEqual(bodies, [bodies[0], bodies[0]]);
  assert.deepEqual(keys, [input.idempotencyKey, input.idempotencyKey]);
});

test('payment service reads the persisted gift and reuses the existing attempt on retry', async () => {
  const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const attempt = {
    payment_environment: 'test',
    payment_method: 'pix', installments: null, provider_payment_method_id: 'pix',
    id: '60000000-0000-4000-8000-000000000001',
    contribution_id: '40000000-0000-4000-8000-000000000001',
    provider_idempotency_key: '50000000-0000-4000-8000-000000000001',
    external_reference: response.external_reference,
    provider_order_id: null,
    provider_status: 'creating',
    amount: 50,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    order_submission_started_at: null,
    can_create: true,
  };
  const contribution = {
    payment_environment: 'test',
    payment_method: 'pix',
    id: attempt.contribution_id,
    gift_id: giftItem.giftId,
    payment_status: 'pending',
    contributor_name: 'Pessoa de Teste',
    contributor_email: 'unused@example.test',
  };
  const databaseUrl = moduleUrl(`
    export const queries = [];
    export async function database(path) {
      queries.push(path);
      if (path === 'rpc/claim_gift_payment_attempt_for_environment') return [${JSON.stringify(attempt)}];
      if (path === 'rpc/begin_gift_order_submission_for_environment') return true;
      if (path.startsWith('gifts?select=id,name&id=eq.')) return [{ id: ${JSON.stringify(giftItem.giftId)}, name: ${JSON.stringify(giftItem.giftName)} }];
      if (path === 'rpc/reconcile_gift_payment_attempt_for_environment') return 'pending';
      if (path.startsWith('payment_attempts?select=')) return [${JSON.stringify(attempt)}];
      throw new Error('unexpected database query: ' + path);
    }
    export async function databaseInsert() { throw new Error('unexpected insert'); }
    export async function databaseUpdate() { throw new Error('unexpected update'); }
  `);
  const clientUrl = moduleUrl(`
    export const creations = [];
    export async function createPixOrder(input) {
      creations.push(input);
      return ${JSON.stringify(response)};
    }
    export async function createCreditCardOrder() { throw new Error('unexpected card POST'); }
    export function assertExpectedOrder() {}
    export async function getOrder() { throw new Error('unexpected GET'); }
  `);
  const contributionUrl = moduleUrl(`export class GiftContributionError extends Error {}`);
  const pendingUrl = moduleUrl(`export async function createPendingGiftContribution() {
    return { payment_status: 'pending', contribution: ${JSON.stringify(contribution)} };
  }`);
  const serviceSource = (await readFile(new URL('../src/services/gift-payments.ts', import.meta.url), 'utf8'))
    .replace("import 'server-only';", '')
    .replace("from '@/lib/server-diagnostics'", `from '${diagnosticUrl}'`)
    .replace("from '@/lib/gifts/contribution'", `from '${contributionUrl}'`)
    .replace("from '@/lib/payments/contracts'", `from '${contractsUrl}'`)
    .replace("from '@/lib/payments/mercado-pago/client'", `from '${clientUrl}'`)
    .replace("from '@/lib/supabase/server'", `from '${databaseUrl}'`)
    .replace("from '@/services/gift-contributions'", `from '${pendingUrl}'`);
  const serviceOutput = ts.transpileModule(serviceSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { createGiftPayment } = await import(moduleUrl(serviceOutput));
  await createGiftPayment({});
  await createGiftPayment({});
  const { queries } = await import(databaseUrl);
  const { creations } = await import(clientUrl);
  assert.equal(queries.filter(path => path.startsWith('gifts?select=id,name&id=eq.')).length, 2);
  assert.ok(queries.every(path => !path.startsWith('gifts?') || path.includes(giftItem.giftId)));
  assert.equal(creations.length, 2);
  assert.deepEqual(creations, [creations[0], creations[0]]);
  assert.equal(creations[0].giftId, giftItem.giftId);
  assert.equal(creations[0].giftName, giftItem.giftName);
  assert.equal(creations[0].idempotencyKey, attempt.provider_idempotency_key);
  assert.equal(creations[0].externalReference, attempt.external_reference);
});

test('Mercado Pago amount normalization preserves cents without rounding', () => {
  for (const [input, expected] of [
    [50, '50.00'], [50.5, '50.50'], ['50', '50.00'],
    ['50.5', '50.50'], ['50.50', '50.50'],
    [1000, '1000.00'], [1000.01, '1000.01'],
  ]) {
    assert.equal(normalizeMercadoPagoAmount(input), expected);
  }
  for (const input of [0, -1, 1.005, '1.005', NaN, Infinity, '1e3', '50,00', '', ' 50']) {
    assert.throws(() => normalizeMercadoPagoAmount(input), MercadoPagoError);
  }
});

test('invalid RPC amounts fail before calling Mercado Pago', () => {
  let called = false;
  assert.throws(() => createPixOrder({
    ...giftItem,
    amount: 50.001, externalReference: response.external_reference,
    idempotencyKey: '50000000-0000-4000-8000-000000000001',
    payerEmail: 'unused@example.test', payerName: 'Unused',
  }, async () => { called = true; throw new Error('must not call'); }), MercadoPagoError);
  assert.equal(called, false);
});

test('Order reads are authenticated and mismatched amount, reference or payment method are rejected', async () => {
  const order = await getOrder('ORD_TEST_1', async (_url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, 'Bearer TEST_TOKEN_NOT_REAL');
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.throws(() => assertExpectedOrder(order, { amount: '51.00', externalReference: response.external_reference }), MercadoPagoError);
  assert.throws(() => assertExpectedOrder(order, { amount: '50.00', externalReference: 'another-reference' }), MercadoPagoError);
  assert.throws(() => assertExpectedOrder(order, { amount: '50.00', externalReference: response.external_reference.replace('gift-contribution-', 'gift-contribution:') }), MercadoPagoError);
  assert.throws(() => getOrder('../payments'), MercadoPagoError);
});

test('missing server-only configuration fails before any network request', () => {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
  let called = false;
  assert.throws(() => createPixOrder({
    ...giftItem,
    amount: '50.00', externalReference: response.external_reference,
    idempotencyKey: '50000000-0000-4000-8000-000000000001',
    payerEmail: 'real@example.com', payerName: 'Pessoa Real',
  }, async () => { called = true; throw new Error('must not call'); }), MercadoPagoError);
  assert.equal(called, false);
  process.env.MERCADO_PAGO_ACCESS_TOKEN = token;
});

test('non-2xx Mercado Pago response logs only sanitized diagnostic fields', async () => {
  const oldEnvironment = process.env.NODE_ENV;
  const oldError = console.error;
  const logs = [];
  process.env.NODE_ENV = 'development';
  console.error = (...items) => logs.push(items);
  try {
    await assert.rejects(createPixOrder({
      ...giftItem,
      amount: '50.00', externalReference: response.external_reference,
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      payerEmail: 'real@example.com', payerName: 'Pessoa Real',
    }, async () => new Response(JSON.stringify({
      error: 'bad_request', message: 'payer email real@example.com was rejected',
      cause: [{ code: 'invalid_payer', description: 'Invalid payer data', Authorization: 'Bearer SHOULD_NOT_LOG' }],
      qr_code: '000201SECRET_PIX',
    }), { status: 400, headers: { 'x-request-id': 'request-test-1' } })), error => {
      assert.equal(error.code, 'unavailable');
      assert.equal(error.diagnostic.httpStatus, 400);
      return true;
    });
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0][1], {
      operation: 'POST /v1/orders', httpStatus: 400, error: 'bad_request',
      message: '[redacted]',
      cause: JSON.stringify([{ code: 'invalid_payer', description: 'Invalid payer data' }]),
      requestId: 'request-test-1',
      requestSummary: JSON.stringify({
        total_amount: '50.00',
        items: [{ title: giftItem.giftName, quantity: 1, unit_price: '50.00' }],
        payment_amount: '50.00',
      }),
    });
    const logged = JSON.stringify(logs);
    for (const forbidden of ['TEST_TOKEN_NOT_REAL', 'real@example.com', '000201SECRET_PIX', 'TEST_WEBHOOK_SECRET_NOT_REAL', 'SHOULD_NOT_LOG']) {
      assert.ok(!logged.includes(forbidden));
    }
  } finally {
    console.error = oldError;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnvironment;
  }
});

test('Orders API item validation errors retain safe cause details and indexed field paths', async () => {
  const oldEnvironment = process.env.NODE_ENV;
  const oldError = console.error;
  const logs = [];
  process.env.NODE_ENV = 'development';
  console.error = (...items) => logs.push(items);
  try {
    await assert.rejects(createPixOrder({
      ...giftItem,
      amount: 50,
      externalReference: response.external_reference,
      idempotencyKey: '50000000-0000-4000-8000-000000000001',
      payerEmail: 'real@example.com', payerName: 'Pessoa Real',
    }, async () => new Response(JSON.stringify({
      error: 'bad_request', code: 'property_value',
      message: 'items[0].title is invalid',
      cause: [
        { code: 'invalid_item', description: 'items[0].title is invalid', field: 'items[0].title' },
        { code: 'invalid_total_amount', description: 'Items total does not match' },
      ],
    }), { status: 400, headers: { 'x-request-id': 'request-test-2' } })), MercadoPagoError);
    assert.equal(logs.length, 1);
    const diagnostic = logs[0][1];
    assert.equal(diagnostic.error, 'bad_request');
    assert.equal(diagnostic.code, 'property_value');
    assert.equal(diagnostic.message, 'items.0.title is invalid');
    assert.deepEqual(JSON.parse(diagnostic.cause), [
      { code: 'invalid_item', description: 'items.0.title is invalid', field: 'items.0.title' },
      { code: 'invalid_total_amount', description: 'Items total does not match' },
    ]);
    const summary = JSON.parse(diagnostic.requestSummary);
    assert.equal(summary.total_amount, '50.00');
    assert.equal(summary.payment_amount, '50.00');
    assert.equal(summary.items[0].unit_price, '50.00');
    assert.equal(summary.items[0].quantity, 1);
    assert.ok(!JSON.stringify(diagnostic).includes('real@example.com'));
  } finally {
    console.error = oldError;
    if (oldEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnvironment;
  }
});

test('non-2xx Supabase response preserves safe fields without logging the service role', async () => {
  const serverSource = (await readFile(new URL('../src/lib/supabase/server.ts', import.meta.url), 'utf8'))
    .replace("import 'server-only';", '')
    .replace("from '@/lib/server-diagnostics'", `from '${diagnosticUrl}'`);
  const serverOutput = ts.transpileModule(serverSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { databaseInsert } = await import(`data:text/javascript;base64,${Buffer.from(serverOutput).toString('base64')}`);
  const oldEnvironment = process.env.NODE_ENV;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldFetch = globalThis.fetch;
  const oldError = console.error;
  const logs = [];
  process.env.NODE_ENV = 'development';
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'TEST_SERVICE_ROLE_NOT_REAL';
  console.error = (...items) => logs.push(items);
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: '23514', message: 'constraint violation',
    details: 'payer.email real@example.com', hint: 'Check the allowed fields',
    access_token: 'TEST_TOKEN_NOT_REAL',
  }), { status: 400 });
  try {
    await assert.rejects(databaseInsert('gift_contributions?select=id', { amount: '50.00' }), error => {
      assert.equal(error.diagnostic.httpStatus, 400);
      assert.equal(error.diagnostic.code, '23514');
      return true;
    });
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0][1], {
      operation: 'POST gift_contributions', httpStatus: 400, code: '23514',
      message: 'constraint violation', details: '[redacted]', hint: 'Check the allowed fields',
    });
    const logged = JSON.stringify(logs);
    for (const forbidden of ['TEST_SERVICE_ROLE_NOT_REAL', 'TEST_TOKEN_NOT_REAL', 'real@example.com']) {
      assert.ok(!logged.includes(forbidden));
    }
  } finally {
    globalThis.fetch = oldFetch;
    console.error = oldError;
    for (const [name, value] of [['NODE_ENV', oldEnvironment], ['SUPABASE_URL', oldUrl], ['SUPABASE_SERVICE_ROLE_KEY', oldKey]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('webhook normalizes uppercase Order data.id only for signature validation', () => {
  const dataId = 'ORDTST01ABC123456789';
  const requestId = 'Request-TEST-1';
  const timestamp = Math.floor(Date.now() / 1000);
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const hash = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET).update(manifest).digest('hex');
  const signature = `ts=${timestamp},v1=${hash}`;
  assert.doesNotThrow(() => WebhookSignatureValidator.validate({
    xSignature: signature,
    xRequestId: requestId,
    dataId: dataId.toLowerCase(),
    secret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    toleranceSeconds: 300,
  }));
  const valid = new Request(`https://example.test/api/payments/mercado-pago/webhook?type=order&data.id=${dataId}`, {
    method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': signature },
  });
  const result = validateMercadoPagoWebhook(valid);
  assert.equal(result.dataId, dataId);
  assert.match(result.eventKey, /^[0-9a-f]{64}$/);
  assert.deepEqual(validationCalls.at(-1), {
    xSignature: signature,
    xRequestId: requestId,
    dataId: dataId.toLowerCase(),
    secret: process.env.MERCADO_PAGO_WEBHOOK_SECRET,
    toleranceSeconds: 300,
  });

  const withExternalReference = new Request(
    `https://example.test/api/payments/mercado-pago/webhook?data.external_reference=${response.external_reference}&data.id=${dataId}&type=order`,
    { method: 'POST', headers: { 'X-Request-Id': requestId, 'X-Signature': signature } },
  );
  const realShapeResult = validateMercadoPagoWebhook(withExternalReference);
  assert.equal(realShapeResult.dataId, dataId);
  assert.equal(realShapeResult.eventKey, result.eventKey);

  const incorrectlySigned = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
    .update(`id:${dataId};request-id:${requestId};ts:${timestamp};`).digest('hex');
  const mismatch = new Request(
    `https://example.test/api/payments/mercado-pago/webhook?data.external_reference=${response.external_reference}&data.id=${dataId}&type=order`,
    { method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${incorrectlySigned}` } },
  );
  assert.throws(() => validateMercadoPagoWebhook(mismatch), MercadoPagoWebhookError);

  const invalid = new Request(`https://example.test/api/payments/mercado-pago/webhook?type=payment&data.id=${dataId}`, {
    method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': signature },
  });
  assert.throws(() => validateMercadoPagoWebhook(invalid), MercadoPagoWebhookError);
});

test('webhook route processes only an SDK-validated notification and rejects invalid or missing signature inputs', async () => {
  const dataId = 'ORDTST01ABC123456789';
  const requestId = 'Request-TEST-route';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = manifest => `ts=${timestamp},v1=${createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
    .update(manifest).digest('hex')}`;
  const signature = sign(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`);
  const baseUrl = 'https://example.test/api/payments/mercado-pago/webhook?type=order';
  const makeRequest = (url, headers) => new Request(url, { method: 'POST', headers });
  processedCalls.length = 0;
  const valid = await postWebhook(makeRequest(`${baseUrl}&data.id=${dataId}`, {
    'x-request-id': requestId, 'x-signature': signature,
  }));
  assert.equal(valid.status, 200);
  assert.equal(processedCalls.length, 1);
  assert.equal(processedCalls[0].dataId, dataId);

  const invalidCases = [
    ['invalid signature', `${baseUrl}&data.id=${dataId}`, { 'x-request-id': requestId, 'x-signature': `ts=${timestamp},v1=${'0'.repeat(64)}` }],
    ['uppercase-only signature', `${baseUrl}&data.id=${dataId}`, { 'x-request-id': requestId, 'x-signature': sign(`id:${dataId};request-id:${requestId};ts:${timestamp};`) }],
    ['missing x-signature', `${baseUrl}&data.id=${dataId}`, { 'x-request-id': requestId }],
    ['missing x-request-id', `${baseUrl}&data.id=${dataId}`, { 'x-signature': sign(`id:${dataId};ts:${timestamp};`) }],
    ['missing data.id', baseUrl, { 'x-request-id': requestId, 'x-signature': signature }],
  ];
  for (const [label, url, headers] of invalidCases) {
    const result = await postWebhook(makeRequest(url, headers));
    assert.equal(result.status, 401, label);
    assert.equal(processedCalls.length, 1, `${label} must not process an Order`);
  }
});
