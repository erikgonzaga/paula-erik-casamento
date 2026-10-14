import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { typescriptModule } from './typescript-fixture.mjs';

const require = createRequire(import.meta.url);
const moduleUrl = value => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
const checkout = await import(await typescriptModule('../src/lib/payments/card-checkout.ts'));
const lifecycle = await import(await typescriptModule('../src/lib/payments/card-brick-lifecycle.ts'));
const policy = await import(await typescriptModule('../src/lib/payments/card-checkout-policy.ts'));
const installmentDiagnostic = await import(await typescriptModule('../src/lib/payments/card-installment-diagnostics.ts'));
const settings = () => ({ initialization: { amount: 50, payer: { email: 'fixture@example.invalid' } },
  customization: { paymentMethods: { types: { excluded: ['debit_card', 'prepaid_card'] }, minInstallments: 1, maxInstallments: 12 }, visual: { style: { theme: 'flat' } } },
  callbacks: { onReady() {}, onError() {}, async onSubmit() {} } });
const tokenData = (installments = 1, token = 'MOCK_TEMP_TOKEN') => ({ token, payment_method_id: 'master', installments,
  payer: { email: 'ignored@example.invalid', identification: { type: 'CPF', number: '12345678909' } },
  issuer_id: 'ignored', transaction_amount: 999999, card_number: 'MOCK_PAN', cvv: 'MOCK_CVV', expiration_date: 'MOCK_EXPIRY' });
const paymentResult = (status = 'pending', detail = 'waiting', challenge) => ({ payment_status: status,
  payment: { status: detail, expires_at: '2026-10-10T00:00:00Z', qr_code: null, qr_code_base64: null, ticket_url: null,
    ...(challenge ? { challenge: { url: challenge } } : {}) } });

const installmentResponse = (method = 'master') => [{ payment_method_id: method, issuer: { id: 210, name: 'Banco de teste',
  document: 'MOCK_DOCUMENT' }, bin: '8'.repeat(8), card_token: 'MOCK_TEMP_TOKEN', payer: { name: 'MOCK_HOLDER' },
  payer_costs: [{ installments: 2, installment_rate: 5.42, installment_amount: 105.42, total_amount: 210.84,
    discount_rate: 0, installment_rate_collector: ['MERCADOPAGO'], labels: ['CFT_5.42%'], payment_method_option_id: 'option-2',
    cvv: 'MOCK_CVV', device_id: 'MOCK_DEVICE', recommended_message: 'MOCK_PRIVATE_MESSAGE' }] }];

test('installment diagnostic projects only allowed fields, drops sensitive/invalid data and formats BRL/rates', () => {
  const offers = installmentDiagnostic.sanitizeInstallmentOffers(installmentResponse(), '8'.repeat(8));
  assert.deepEqual(offers, [{ payment_method_id: 'master', issuer_id: '210', issuer_name: 'Banco de teste',
    installments: 2, installment_rate: 5.42, installment_amount: 105.42, total_amount: 210.84, discount_rate: 0,
    installment_rate_collector: ['MERCADOPAGO'], labels: ['CFT_5.42%'], payment_method_option_id: 'option-2' }]);
  const safe = JSON.stringify(offers);
  for (const sensitive of ['MOCK_DOCUMENT', 'MOCK_TEMP_TOKEN', 'MOCK_HOLDER', 'MOCK_CVV', 'MOCK_DEVICE', 'MOCK_PRIVATE_MESSAGE', '8'.repeat(8)]) {
    assert.ok(!safe.includes(sensitive));
  }
  const raw = installmentResponse('visa');
  Object.assign(raw[0].payer_costs[0], { installment_amount: '200.00', total_amount: NaN, installment_rate: Infinity,
    labels: ['SAFE', '8'.repeat(8), '9'.repeat(16), 'private@example.invalid', 'https://private.invalid/token', '\u0000'],
    payment_method_option_id: { token: 'MOCK_TEMP_TOKEN' } });
  const [projected] = installmentDiagnostic.sanitizeInstallmentOffers(raw, '8'.repeat(8));
  assert.equal(projected.installment_amount, 200); assert.equal(projected.total_amount, null);
  assert.equal(projected.installment_rate, null); assert.equal(projected.payment_method_option_id, null);
  assert.deepEqual(projected.labels, ['SAFE']);
  for (const invalid of [null, {}, 'raw-error', [{ payer_costs: [null, { installments: 0 }, { installments: 1.5 }] }]]) {
    assert.deepEqual(installmentDiagnostic.sanitizeInstallmentOffers(invalid), []);
  }
  assert.equal(installmentDiagnostic.formatInstallmentMoney(200).replace(/\s/g, ' '), 'R$ 200,00');
  assert.equal(installmentDiagnostic.formatInstallmentMoney(105.42).replace(/\s/g, ' '), 'R$ 105,42');
  assert.equal(installmentDiagnostic.formatInstallmentMoney(null), '—');
  assert.equal(installmentDiagnostic.formatInstallmentRate(5.42), '5,42%');
  assert.equal(installmentDiagnostic.formatInstallmentRate(0), '0%');
});

test('card checkout policy is fail-closed: test + explicit flag + public key; production always blocked', async () => {
  const keys = ['PAYMENTS_ENVIRONMENT', 'ENABLE_CREDIT_CARD_CHECKOUT', 'NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const [environment, flag, key, expected] of [
      ['test', 'true', 'MOCK_PUBLIC_KEY', true], ['test', 'false', 'MOCK_PUBLIC_KEY', false],
      ['test', 'TRUE', 'MOCK_PUBLIC_KEY', false], ['test', 'true', '', false],
      ['production', 'true', 'MOCK_PUBLIC_KEY', false], ['', 'true', 'MOCK_PUBLIC_KEY', false],
    ]) {
      process.env.PAYMENTS_ENVIRONMENT = environment; process.env.ENABLE_CREDIT_CARD_CHECKOUT = flag;
      process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY = key;
      assert.equal(policy.creditCardCheckoutEnabled(), expected);
    }
    let created = 0;
    globalThis.__cardRouteFixture = () => { created++; return paymentResult(); };
    const service = moduleUrl('export const createGiftPayment = async (...args) => globalThis.__cardRouteFixture(...args);');
    const http = moduleUrl('export const assertSameOrigin = () => {}; export const limit = async () => {}; export const readBody = r => r.json();');
    const route = await import(await typescriptModule('../src/app/api/gift-contributions/route.ts', { '@/services/gift-payments': service, '@/lib/invitations/http': http }));
    for (const [environment, flag, expected] of [['production', 'true', 409], ['test', 'false', 409], ['test', 'true', 201]]) {
      process.env.PAYMENTS_ENVIRONMENT = environment; process.env.ENABLE_CREDIT_CARD_CHECKOUT = flag;
      process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY = 'MOCK_PUBLIC_KEY';
      const response = await route.POST(new Request('https://fixture.invalid/api/gift-contributions', { method: 'POST', body: JSON.stringify({ payment_method: 'credit_card' }) }));
      assert.equal(response.status, expected);
      if (expected === 409) assert.deepEqual(await response.json(), {
        code: 'credit_card_unavailable', message: 'Pagamento por cartão ainda não está disponível.' });
    }
    assert.equal(created, 1);
  } finally {
    delete globalThis.__cardRouteFixture;
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('contribution API exposes only structured application errors; unexpected errors stay generic', async () => {
  const domainUrl = await typescriptModule('../src/lib/gifts/contribution.ts');
  const { GiftContributionError } = await import(domainUrl);
  const service = moduleUrl('export const createGiftPayment = async () => { throw globalThis.__rejectionFixture; };');
  const http = moduleUrl('export const assertSameOrigin = () => {}; export const limit = async () => {}; export const readBody = r => r.json();');
  const route = await import(await typescriptModule('../src/app/api/gift-contributions/route.ts', {
    '@/lib/gifts/contribution': domainUrl, '@/services/gift-payments': service, '@/lib/invitations/http': http }));
  try {
    for (const [status, code, message] of [[409, 'goal_reached', 'Esse presente acabou de atingir a meta ❤️'],
      [409, 'gift_unavailable', 'Este presente não está mais disponível.'], [400, 'invalid_payment', 'Confira os dados do pagamento.']]) {
      globalThis.__rejectionFixture = new GiftContributionError(status, code, message);
      const response = await route.POST(new Request('https://fixture.invalid', { method: 'POST', body: '{}' }));
      assert.equal(response.status, status); assert.deepEqual(await response.json(), { code, message });
    }
    globalThis.__rejectionFixture = new Error('MOCK_TOKEN MOCK_PAN MOCK_CVV MOCK_DOCUMENT MOCK_BIN MOCK_KEY fixture@example.invalid');
    const response = await route.POST(new Request('https://fixture.invalid', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: 'Não foi possível registrar a contribuição agora. Tente novamente em alguns instantes.' });
    for (const value of [null, {}, { code: 'unknown', message: 'private' }, { code: 'goal_reached' }]) {
      assert.equal(checkout.parseCardSubmissionRejection(409, value), null);
    }
    assert.equal(checkout.parseCardSubmissionRejection(503, { code: 'goal_reached', message: 'private' }), null);
  } finally { delete globalThis.__rejectionFixture; }
});

test('Brick projection allows provider installments 1/12, rejects 13/debit, and copies no raw card data', () => {
  for (const installments of [1, 12]) {
    const data = checkout.brickPaymentInput(tokenData(installments), { paymentTypeId: 'credit_card' }, 'MOCK_DEVICE');
    assert.equal(data.installments, installments);
    assert.equal(data.card_token, 'MOCK_TEMP_TOKEN');
    for (const field of ['card_number', 'cvv', 'expiration_date', 'issuer_id', 'transaction_amount']) assert.ok(!Object.hasOwn(data, field));
    assert.ok(!JSON.stringify(data).includes('ignored@example.invalid'));
  }
  for (const installments of [0, 13, 1.5, '12']) assert.throws(() => checkout.brickPaymentInput(tokenData(installments), { paymentTypeId: 'credit_card' }));
  assert.throws(() => checkout.brickPaymentInput(tokenData(), { paymentTypeId: 'debit_card' }));
  for (const value of ['50', '50,50', '1.000,01', '0,01']) assert.ok(checkout.cardCheckoutAmount(value) > 0);
  for (const value of ['0', '-50', '50,005', 'not-money']) assert.throws(() => checkout.cardCheckoutAmount(value));
  const gift = randomUUID();
  checkout.rememberCardOperation(gift, 'MOCK_OPERATION_KEY', paymentResult('pending', 'action_required', 'https://issuer.example/challenge?token=MOCK_CHALLENGE'));
  assert.ok(!JSON.stringify(checkout.recalledCardOperation(gift)).includes('MOCK_CHALLENGE'));
  checkout.rememberCardOperation(gift, 'MOCK_OPERATION_KEY', paymentResult('confirmed', 'confirmed'));
  assert.equal(checkout.recalledCardOperation(gift), undefined, 'Confirmed open/fixed gifts allow another intentional contribution');
});

test('Brick lifecycle serializes pending create/unmount/reopen; failures cannot duplicate an uncertain instance', async () => {
  let resolveCreate, created = 0, removed = 0;
  const manager = lifecycle.createCardBrickManager(async () => ({ create: async () => {
    created++; return new Promise(resolve => { resolveCreate = () => resolve({ unmount: async () => { removed++; } }); });
  } }));
  const first = manager.mount('first', settings());
  await new Promise(resolve => setImmediate(resolve));
  const disposing = first.dispose();
  const second = manager.mount('second', settings());
  resolveCreate(); await first.ready; await disposing;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(created, 2); assert.equal(removed, 1);
  resolveCreate(); await second.ready; await second.dispose();
  assert.equal(removed, 2);
  let attempts = 0;
  const uncertain = lifecycle.createCardBrickManager(async () => ({ create: async () => { attempts++; throw new Error('MOCK_CREATE_ERROR'); } }));
  await uncertain.mount('a', settings()).ready;
  await uncertain.mount('b', settings()).ready;
  assert.equal(attempts, 1);
});

test('React checkout with mocked SDK/HTTP: lifecycle, Pix, idempotency, privacy and 3DS', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://fixture.invalid/' });
  const globals = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLIFrameElement', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const old = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals.slice(0, -1)) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const originalFetch = globalThis.fetch;
  const logs = [], previousConsole = {};
  for (const method of ['log', 'warn', 'error', 'info']) { previousConsole[method] = console[method]; console[method] = (...args) => logs.push(args); }
  let storageCalls = 0;
  const originalSet = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = function (...args) { storageCalls++; return originalSet.apply(this, args); };
  const locks = new Map();
  Object.defineProperty(dom.window.navigator, 'locks', { value: { request(name, callback) {
    const next = (locks.get(name) ?? Promise.resolve()).then(callback); locks.set(name, next.catch(() => {})); return next;
  } } });
  const timers = new Map(); let timerId = 0;
  dom.window.setInterval = callback => { const id = ++timerId; timers.set(id, callback); return id; };
  dom.window.clearInterval = id => timers.delete(id);
  const instances = []; let refreshes = 0;
  globalThis.__cardUI = {
    async load() { return { async create(type, id, settings) {
      assert.equal(type, 'cardPayment');
      const instance = { id, settings, removed: 0 }; instances.push(instance);
      dom.window.document.getElementById(id).textContent = 'MOCK SECURE BRICK';
      settings.callbacks.onReady();
      return { async unmount() { instance.removed++; } };
    } }; }, refresh() { refreshes++; }, async conditions() { return []; },
  };
  const sdk = moduleUrl('export const loadCardBrickBuilder = () => globalThis.__cardUI.load(); export const cardDeviceId = () => "MOCK_DEVICE"; export const getCardInstallments = (...args) => globalThis.__cardUI.conditions(...args);');
  const navigation = moduleUrl('export const useRouter = () => ({ refresh: () => globalThis.__cardUI.refresh() });');
  const image = moduleUrl(`import React from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};
    export default function Image({unoptimized, ...props}) { return React.createElement('img', props); }`);
  const replacements = { '@/lib/payments/card-sdk': sdk, 'next/navigation': navigation, 'next/image': image };
  // Relative SDK import in the lifecycle must use the same fake.
  replacements['./card-sdk'] = sdk;
  const { GiftContributionForm } = await import(await typescriptModule('../src/components/gift-contribution-form.tsx', replacements));
  let root, calls, currentResponse, statusResponse, blockedPost;
  const container = dom.window.document.getElementById('root');
  const gift = () => ({ id: randomUUID(), slug: 'fixture', name: 'Fixture', gift_type: 'regular', funding_mode: 'open', active: true, target_amount: null });
  function button(text) { return [...container.querySelectorAll('button')].find(element => element.textContent.includes(text)); }
  async function click(text) { assert.ok(button(text), `Missing button ${text}`); await act(async () => { button(text).click(); }); }
  async function fill(field, value) {
    await act(async () => {
      const input = container.querySelector(`[name="${field}"]`);
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  }
  async function mount(currentGift = gift(), enabled = true) {
    calls = []; currentResponse = paymentResult(); statusResponse = checkout.recalledCardOperation(currentGift.id)?.result ?? paymentResult(); blockedPost = null;
    globalThis.fetch = async (url, init) => {
      assert.ok(['/api/gift-contributions', '/api/gift-contributions/status'].includes(url));
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith('/status')) return statusResponse instanceof Response ? statusResponse.clone() : Response.json(statusResponse);
      if (blockedPost) await blockedPost;
      if (currentResponse instanceof Error) throw currentResponse;
      return currentResponse instanceof Response ? currentResponse.clone() : Response.json(currentResponse, { status: 201 });
    };
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(GiftContributionForm, { gift: currentGift, cardCheckoutEnabled: enabled }))); });
    return currentGift;
  }
  async function unmount() { if (root) { await act(async () => { root.unmount(); await new Promise(resolve => setImmediate(resolve)); }); root = null; } }
  async function details() { await fill('amount', '50,00'); await fill('contributor_name', 'Fixture'); await fill('contributor_phone', '11999999999'); await fill('contributor_email', 'fixture@example.invalid'); }
  async function card() { await details(); await click('Cartão de crédito'); await click('CONTINUAR'); }
  async function token(installments = 1, value = 'MOCK_TEMP_TOKEN') {
    await act(async () => { await instances.at(-1).settings.callbacks.onSubmit(tokenData(installments, value), { paymentTypeId: 'credit_card' }); });
  }
  try {
    await t.test('explicit pre-provider rejections show safe messages, discard ghosts and never poll or auto-retry', async () => {
      for (const [code, status, message] of [
        ['goal_reached', 409, 'Esse presente acabou de atingir a meta ❤️'],
        ['gift_unavailable', 409, 'Este presente não está mais disponível.'],
        ['invalid_payment', 400, 'Confira os dados do pagamento.'],
        ['credit_card_unavailable', 409, 'Pagamento por cartão ainda não está disponível.'],
      ]) {
        const currentGift = await mount(); await card();
        currentResponse = Response.json({ code, message }, { status }); await token();
        assert.ok(container.textContent.includes(message));
        assert.ok(!container.textContent.includes('verificando'));
        assert.equal(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id), null);
        assert.equal(checkout.recalledCardOperation(currentGift.id), undefined);
        assert.equal(timers.size, 0);
        assert.equal(calls.length, 1);
        await unmount(); await mount(currentGift);
        assert.equal(calls.length, 0); assert.equal(timers.size, 0); await unmount();
      }
    });
    await t.test('existing-attempt conflicts stop misleading waiting but retain the key and cannot start a new payment', async () => {
      for (const code of ['idempotency_conflict', 'payment_environment_mismatch', 'payment_expired']) {
        const currentGift = await mount(); await card();
        currentResponse = Response.json({ code, message: 'MOCK_TEMP_TOKEN private@example.invalid MOCK_PAN' }, { status: 409 }); await token();
        const key = calls[0].body.idempotency_key;
        assert.ok(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id).includes(key));
        assert.ok(!container.textContent.includes('verificando'));
        assert.equal(timers.size, 0);
        assert.equal(button('INICIAR NOVA TENTATIVA'), undefined);
        statusResponse = Response.json({}, { status: 404 }); await click('CONSULTAR PAGAMENTO');
        assert.equal(button('TENTAR ENVIO COM A MESMA CHAVE'), undefined);
        assert.equal(calls.filter(call => !call.url.endsWith('/status')).length, 1);
        for (const sensitive of [key, 'MOCK_TEMP_TOKEN', 'private@example.invalid', 'MOCK_PAN']) {
          assert.ok(!container.textContent.includes(sensitive)); assert.ok(!JSON.stringify(logs).includes(sensitive));
        }
        await unmount();
      }
    });
    await t.test('validation on an uncertain same-key retry does not discard the earlier submission', async () => {
      const currentGift = await mount(); await card(); currentResponse = new Error('MOCK_TIMEOUT'); await token();
      const key = calls[0].body.idempotency_key;
      assert.equal(timers.size, 1);
      statusResponse = Response.json({}, { status: 404 }); await click('CONSULTAR PAGAMENTO');
      assert.equal(calls.filter(call => !call.url.endsWith('/status')).length, 1);
      await click('TENTAR ENVIO COM A MESMA CHAVE');
      currentResponse = Response.json({ code: 'invalid_payment', message: 'Confira os dados do pagamento.' }, { status: 400 }); await token();
      assert.ok(container.textContent.includes('Confira os dados do pagamento.'));
      assert.ok(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id).includes(key));
      assert.equal(timers.size, 0); assert.equal(button('VOLTAR AO FORMULÁRIO'), undefined);
      await unmount();
    });
    await t.test('a definitive goal rejection on explicit same-key retry removes the old ghost', async () => {
      const currentGift = await mount(); await card(); currentResponse = new Error('MOCK_TIMEOUT'); await token();
      const key = calls[0].body.idempotency_key;
      statusResponse = Response.json({}, { status: 404 }); await click('CONSULTAR PAGAMENTO');
      assert.ok(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id).includes(key));
      await click('TENTAR ENVIO COM A MESMA CHAVE');
      currentResponse = Response.json({ code: 'goal_reached', message: 'Esse presente acabou de atingir a meta ❤️' }, { status: 409 }); await token();
      assert.equal(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id), null);
      assert.equal(timers.size, 0);
      const posts = calls.filter(call => !call.url.endsWith('/status'));
      assert.equal(posts.length, 2); assert.equal(posts[1].body.idempotency_key, key);
      assert.ok(!container.textContent.includes('verificando')); await unmount();
    });
    await t.test('flag-off UI keeps Pix; TEST choice mounts once, switches back, closes and reopens cleanly', async () => {
      const before = instances.length;
      await mount(gift(), false); assert.equal(button('Cartão de crédito'), undefined); await unmount();
      const currentGift = await mount(); await card();
      assert.equal(instances.length, before + 1);
      assert.deepEqual(instances.at(-1).settings.customization.paymentMethods.types.excluded, ['debit_card', 'prepaid_card']);
      assert.equal(instances.at(-1).settings.customization.paymentMethods.maxInstallments, 12);
      await click('VOLTAR AO PIX'); assert.equal(instances.at(-1).removed, 1);
      await click('Cartão de crédito'); await click('CONTINUAR');
      assert.equal(instances.length, before + 2);
      await unmount(); assert.equal(instances.at(-1).removed, 1);
      await mount(currentGift); await card(); assert.equal(instances.length, before + 3); await unmount();
    });
    await t.test('Pix QR, copy, polling and confirmation stay intact', async () => {
      await mount(gift(), false); await details();
      currentResponse = paymentResult(); currentResponse.payment.qr_code = 'MOCK_PIX_CODE';
      currentResponse.payment.qr_code_base64 = 'MOCK_BASE64'; currentResponse.payment.ticket_url = 'https://fixture.invalid/ticket';
      await click('CONTINUAR');
      assert.equal(calls[0].body.payment_method, undefined);
      assert.ok(container.textContent.includes('Pix Copia e Cola'));
      assert.equal(container.querySelector('textarea').value, 'MOCK_PIX_CODE');
      let copied; Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { async writeText(value) { copied = value; } } });
      await click('COPIAR CÓDIGO PIX'); assert.equal(copied, 'MOCK_PIX_CODE');
      statusResponse = paymentResult('confirmed', 'confirmed');
      await act(async () => { for (const poll of [...timers.values()]) await poll(); });
      assert.ok(container.textContent.includes('Pagamento confirmado.')); await unmount();
    });
    await t.test('double submit sends once, 12 installments accepted, token never enters state/log/storage', async () => {
      const currentGift = await mount(); await card();
      let release; blockedPost = new Promise(resolve => { release = resolve; });
      const data = tokenData(12);
      await act(async () => {
        const first = instances.at(-1).settings.callbacks.onSubmit(data, { paymentTypeId: 'credit_card' });
        await instances.at(-1).settings.callbacks.onSubmit(data, { paymentTypeId: 'credit_card' });
        release(); await first;
        // A repeated SDK callback before the pending render must not send again.
        await instances.at(-1).settings.callbacks.onSubmit(data, { paymentTypeId: 'credit_card' });
      });
      assert.equal(calls.filter(call => call.url === '/api/gift-contributions').length, 1);
      assert.equal(calls.find(call => call.url === '/api/gift-contributions').body.installments, 12);
      for (const field of ['card_number', 'cvv', 'expiration_date', 'issuer_id']) assert.ok(!Object.hasOwn(calls[0].body, field));
      for (const value of ['MOCK_TEMP_TOKEN', 'MOCK_PAN', 'MOCK_CVV', 'MOCK_EXPIRY', '12345678909', 'MOCK_DEVICE']) {
        assert.ok(!container.outerHTML.includes(value)); assert.ok(!JSON.stringify(logs).includes(value));
        assert.ok(!JSON.stringify(checkout.recalledCardOperation(currentGift.id)).includes(value));
      }
      assert.ok(storageCalls > 0);
      const stored = JSON.stringify(dom.window.localStorage);
      for (const value of ['MOCK_TEMP_TOKEN', 'MOCK_PAN', 'MOCK_CVV', 'MOCK_EXPIRY', '12345678909', 'MOCK_DEVICE', 'fixture@example.invalid', 'MOCK_CHALLENGE']) assert.ok(!stored.includes(value));
      assert.equal(dom.window.sessionStorage.length, 0);
      assert.ok(container.textContent.includes('Pagamento pendente')); await unmount();
    });
    await t.test('13 is rejected before fetch; declined requires explicit new operation and fresh Brick token', async () => {
      await mount(); await card();
      await assert.rejects(token(13), /card_submission_unavailable/); assert.equal(calls.length, 0);
      currentResponse = paymentResult('failed', 'failed'); await token(1, 'MOCK_FIRST_TOKEN');
      const firstKey = calls[0].body.idempotency_key;
      assert.ok(container.textContent.includes('recusado')); await click('INICIAR NOVA TENTATIVA');
      await click('CONTINUAR'); currentResponse = paymentResult('confirmed', 'confirmed'); await token(1, 'MOCK_SECOND_TOKEN');
      const second = calls.filter(call => call.url === '/api/gift-contributions').at(-1).body;
      assert.notEqual(second.idempotency_key, firstKey); assert.equal(second.card_token, 'MOCK_SECOND_TOKEN');
      assert.ok(container.textContent.includes('aprovado e confirmado')); await unmount();
    });
    await t.test('communication error resumes on reopen; an explicit retry preserves the original key', async () => {
      const currentGift = await mount(); await card(); currentResponse = new Error('MOCK_NETWORK'); await token();
      const key = calls[0].body.idempotency_key;
      assert.ok(container.textContent.includes('comunicação')); await unmount();
      await mount(currentGift); assert.ok(container.textContent.includes('verificando')); assert.equal(calls.filter(call => call.url === '/api/gift-contributions').length, 0);
      statusResponse = Response.json({ message: 'not found' }, { status: 404 }); await click('CONSULTAR PAGAMENTO');
      await click('TENTAR ENVIO COM A MESMA CHAVE'); await token(1, 'MOCK_RETRY_TOKEN');
      assert.equal(calls.filter(call => call.url === '/api/gift-contributions')[0].body.idempotency_key, key); await unmount();
    });
    await t.test('a late status response cannot overwrite a new intentional operation', async () => {
      const currentGift = await mount(); await card(); await token();
      let release, oldResult;
      const originalMock = globalThis.fetch;
      globalThis.fetch = async (url, init) => url.endsWith('/status')
        ? new Promise(resolve => { release = () => resolve(Response.json(oldResult)); }) : originalMock(url, init);
      let status;
      await act(async () => { status = button('CONSULTAR PAGAMENTO').click(); });
      // Closing a modal retains the operation, while a terminal response enables
      // an explicit new operation after reopening. Simulate that intervening check.
      checkout.rememberCardOperation(currentGift.id, calls[0].body.idempotency_key, paymentResult('failed', 'failed'));
      await unmount(); await mount(currentGift);
      await click('INICIAR NOVA TENTATIVA'); await card(); await token(1, 'MOCK_NEW_TOKEN');
      const newKey = calls.find(call => call.url === '/api/gift-contributions').body.idempotency_key;
      oldResult = paymentResult('confirmed', 'confirmed');
      await act(async () => { release(); await status; await new Promise(resolve => setImmediate(resolve)); });
      assert.equal(checkout.recalledCardOperation(currentGift.id)?.key, newKey);
      assert.ok(container.textContent.includes('Pagamento pendente')); await unmount();
    });
    await t.test('reload discards UI memory, recovers the durable key, and never auto-posts', async () => {
      for (const [status, detail] of [['confirmed', 'confirmed'], ['pending', 'investigating'], ['pending', 'action_required'], ['failed', 'failed'], ['cancelled', 'cancelled'], ['expired', 'expired']]) {
        const currentGift = await mount(); await card(); currentResponse = new Error('LOST_RESPONSE'); await token();
        const key = calls.find(call => call.url === '/api/gift-contributions').body.idempotency_key;
        await unmount(); checkout.forgetCardOperation(currentGift.id);
        await mount(currentGift);
        assert.equal(calls[0].url, '/api/gift-contributions/status');
        assert.equal(calls[0].body.idempotency_key, key);
        assert.equal(calls.filter(call => call.url === '/api/gift-contributions').length, 0);
        statusResponse = paymentResult(status, detail); await click('CONSULTAR PAGAMENTO');
        if (status === 'confirmed') assert.ok(container.textContent.includes('aprovado e confirmado'));
        else if (status !== 'pending') assert.ok(button('INICIAR NOVA TENTATIVA'));
        else assert.ok(button('CONSULTAR PAGAMENTO'));
        assert.ok(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id).includes(key));
        await unmount();
      }
    });
    await t.test('reload plus 404 retokenizes with the same key and re-entered details', async () => {
      const currentGift = await mount(); await card(); currentResponse = new Error('LOST_RESPONSE'); await token();
      const key = calls.find(call => call.url === '/api/gift-contributions').body.idempotency_key;
      await unmount(); checkout.forgetCardOperation(currentGift.id);
      await mount(currentGift);
      statusResponse = Response.json({}, { status: 404 }); await click('CONSULTAR PAGAMENTO');
      await click('TENTAR ENVIO COM A MESMA CHAVE'); await details(); await click('CONTINUAR'); await token();
      assert.equal(calls.find(call => call.url === '/api/gift-contributions').body.idempotency_key, key);
      await unmount();
    });
    await t.test('storage notification switches an already open tab to tracking without POST', async () => {
      const currentGift = await mount();
      const key = randomUUID();
      dom.window.localStorage.setItem('pe:card-operation:v1:' + currentGift.id, JSON.stringify({ version: 1, gift_id: currentGift.id, key, created_at: new Date().toISOString() }));
      await act(async () => { dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'pe:card-operation:v1:' + currentGift.id })); });
      assert.equal(calls[0].body.idempotency_key, key);
      assert.equal(calls.filter(call => call.url === '/api/gift-contributions').length, 0);
      assert.ok(button('CONSULTAR PAGAMENTO')); await unmount();
    });
    await t.test('a tab submitting after another tab persisted must follow, even without a storage event', async () => {
      const currentGift = await mount(); await card(); const key = randomUUID();
      dom.window.localStorage.setItem('pe:card-operation:v1:' + currentGift.id, JSON.stringify({ version: 1, gift_id: currentGift.id, key, created_at: new Date().toISOString() }));
      await token();
      assert.equal(calls.filter(call => call.url === '/api/gift-contributions').length, 0);
      assert.equal(calls[0].body.idempotency_key, key); await unmount();
    });
    await t.test('blocked durable storage prevents card POST but keeps Pix available', async () => {
      await mount(); await card();
      const set = dom.window.Storage.prototype.setItem;
      dom.window.Storage.prototype.setItem = () => { throw new Error('quota'); };
      try {
        await token();
        assert.equal(calls.length, 0);
        assert.equal(button('VOLTAR AO PIX').disabled, false);
        await click('VOLTAR AO PIX'); assert.ok(button('CONTINUAR'));
      } finally { dom.window.Storage.prototype.setItem = set; await unmount(); }
    });
    await t.test('old pending references remain; only backend terminal evidence allows age cleanup', async () => {
      const currentGift = gift(), key = randomUUID();
      dom.window.localStorage.setItem('pe:card-operation:v1:' + currentGift.id, JSON.stringify({ version: 1, gift_id: currentGift.id, key, created_at: '2020-01-01T00:00:00.000Z' }));
      await mount(currentGift);
      assert.ok(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id));
      statusResponse = paymentResult('expired', 'expired'); await click('CONSULTAR PAGAMENTO');
      assert.equal(dom.window.localStorage.getItem('pe:card-operation:v1:' + currentGift.id), null);
      await unmount();
    });
    await t.test('3DS pins origin + iframe source, prevents top navigation and confirms only via status', async () => {
      await mount(); await card(); currentResponse = paymentResult('pending', 'action_required', 'https://issuer.example/challenge?temporary=MOCK_CHALLENGE'); await token();
      const frame = container.querySelector('iframe'); assert.ok(frame);
      assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms allow-same-origin');
      assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
      const before = calls.length;
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://attacker.example', source: frame.contentWindow, data: { status: 'COMPLETE' } }));
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://issuer.example', source: dom.window, data: { status: 'COMPLETE' } }));
      }); assert.equal(calls.length, before);
      await act(async () => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { origin: 'https://issuer.example', source: frame.contentWindow, data: { status: 'COMPLETE' } })); });
      assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).url, '/api/gift-contributions/status');
      assert.ok(!container.textContent.includes('aprovado')); assert.ok(container.textContent.includes('pendente'));
      statusResponse = paymentResult('confirmed', 'confirmed'); await click('CONSULTAR PAGAMENTO');
      assert.ok(container.textContent.includes('aprovado e confirmado')); assert.equal(container.querySelector('iframe'), null); await unmount();
    });
    await t.test('cancelled/expired show terminal messages; dangerous challenge URLs fail closed', async () => {
      for (const [status, message] of [['cancelled', 'cancelado'], ['expired', 'expirou']]) {
        await mount(); await card(); currentResponse = paymentResult(status, status); await token();
        assert.ok(container.textContent.includes(message)); await unmount();
      }
      for (const url of ['http://issuer.example', 'javascript:alert(1)', 'https://user:password@issuer.example', 'https://fixture.invalid/challenge']) {
        assert.equal(checkout.safeChallengeUrl(url, 'https://fixture.invalid'), null);
      }
    });
    await t.test('temporary token, identification and device are discarded on success and error', async () => {
      const { CardPaymentBrick } = await import(await typescriptModule('../src/components/card-payment-brick.tsx', replacements));
      for (const fail of [false, true]) {
        let temporary;
        root = createRoot(container);
        await act(async () => { root.render(React.createElement(CardPaymentBrick, { amount: 50, email: 'fixture@example.invalid',
          async onSubmit(input) { temporary = input; if (fail) throw new Error('MOCK_FAILURE'); },
        })); });
        if (fail) await assert.rejects(token(), /card_submission_unavailable/); else await token();
        assert.equal(temporary.card_token, '');
        assert.equal(temporary.payer, undefined); assert.equal(temporary.device_id, undefined);
        await unmount();
      }
    });
    await t.test('TEST-only installment panel changes safely before submit, ignores old responses and sanitizes errors', async () => {
      const { CardPaymentBrick } = await import(await typescriptModule('../src/components/card-payment-brick.tsx', replacements));
      const keys = ['PAYMENTS_ENVIRONMENT', 'ENABLE_CREDIT_CARD_CHECKOUT', 'NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY'];
      const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
      const requests = [], beforeStorage = storageCalls, beforeHTTP = calls.length;
      globalThis.__cardUI.conditions = (amount, bin) => new Promise((resolve, reject) => requests.push({ amount, bin, resolve, reject }));
      async function mountDiagnostic(environment, flag = 'true') {
        process.env.PAYMENTS_ENVIRONMENT = environment; process.env.ENABLE_CREDIT_CARD_CHECKOUT = flag;
        process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY = 'MOCK_PUBLIC_KEY';
        root = createRoot(container);
        await act(async () => { root.render(React.createElement(CardPaymentBrick, { amount: 200, email: 'fixture@example.invalid',
          installmentDiagnosticsEnabled: policy.creditCardCheckoutEnabled(), onSubmit() { assert.fail('Diagnostic must not submit a payment'); } })); });
      }
      async function binChanged(bin) { await act(async () => { instances.at(-1).settings.callbacks.onBinChange(bin); }); }
      try {
        for (const [environment, flag] of [['production', 'true'], ['test', 'false']]) {
          await mountDiagnostic(environment, flag);
          assert.equal(instances.at(-1).settings.callbacks.onBinChange, undefined);
          assert.ok(!container.textContent.includes('Diagnóstico temporário'));
          await unmount();
        }
        await mountDiagnostic('test');
        assert.ok(container.textContent.includes('R$\u00a0200,00'));
        assert.equal(instances.at(-1).settings.initialization.amount, 200);
        await binChanged('8'.repeat(8)); assert.equal(requests[0].amount, 200);
        assert.equal(requests[0].bin, '8'.repeat(8));
        await binChanged('7'.repeat(8));
        await act(async () => { requests[1].resolve(installmentResponse('amex')); });
        assert.ok(container.textContent.includes('amex'));
        assert.ok(container.textContent.includes('210,84'));
        await act(async () => { requests[0].resolve(installmentResponse('visa')); });
        assert.ok(!container.textContent.includes('visa'));
        await binChanged('6'.repeat(8));
        assert.ok(!container.textContent.includes('amex')); assert.ok(container.textContent.includes('Consultando condições'));
        await act(async () => { requests[2].reject(new Error('MOCK_PRIVATE_ERROR ' + '6'.repeat(8))); });
        assert.ok(container.textContent.includes('Não foi possível consultar'));
        assert.ok(!container.textContent.includes('MOCK_PRIVATE_ERROR'));
        await binChanged('partial'); assert.equal(requests.length, 3);
        assert.ok(container.textContent.includes('Aguardando identificação'));
        assert.equal(storageCalls, beforeStorage); assert.equal(calls.length, beforeHTTP);
        for (const sensitive of ['MOCK_DOCUMENT', 'MOCK_TEMP_TOKEN', 'MOCK_HOLDER', 'MOCK_CVV', 'MOCK_DEVICE', 'MOCK_PRIVATE_MESSAGE', '7'.repeat(8), '6'.repeat(8)]) {
          assert.ok(!container.textContent.includes(sensitive)); assert.ok(!JSON.stringify(logs).includes(sensitive));
        }
        await binChanged('5'.repeat(8)); await unmount();
        await act(async () => { requests[3].resolve(installmentResponse('master')); });
        assert.equal(container.textContent, '');
      } finally {
        await unmount(); globalThis.__cardUI.conditions = async () => [];
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    });
    assert.ok(refreshes >= 3);
    const sensitiveSources = ['../src/components/card-payment-brick.tsx', '../src/components/card-payment-challenge.tsx', '../src/components/gift-contribution-form.tsx', '../src/lib/payments/card-checkout.ts'];
    for (const file of sensitiveSources) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(log|info|warn|error)|track\(/);
    }
  } finally {
    await unmount(); globalThis.fetch = originalFetch;
    for (const [key, descriptor] of Object.entries(old)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    for (const [method, callback] of Object.entries(previousConsole)) console[method] = callback;
    dom.window.Storage.prototype.setItem = originalSet; delete globalThis.__cardUI; dom.window.close();
  }
});


test('durable reference arbitration serializes tabs and fails closed without locks or storage', async () => {
  const store = await import(await typescriptModule('../src/lib/payments/card-operation-storage.ts'));
  const dom = new JSDOM('', { url: 'https://fixture.invalid' });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const queues = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request(name, fn) {
    const next = (queues.get(name) ?? Promise.resolve()).then(fn); queues.set(name, next.catch(() => {})); return next;
  } } } });
  try {
    const gift = randomUUID(), seen = [];
    await Promise.all([1, 2].map(() => store.withCardOperation(gift, async (reference, created) => {
      seen.push({ reference, created }); await new Promise(resolve => setImmediate(resolve));
    })));
    assert.equal(seen.filter(x => x.created).length, 1);
    assert.equal(seen[0].reference.key, seen[1].reference.key);
    const afterReload = await import((await typescriptModule('../src/lib/payments/card-operation-storage.ts')) + '#fresh');
    assert.deepEqual(afterReload.readCardReference(gift), seen[0].reference);
    assert.deepEqual(Object.keys(seen[0].reference).sort(), ['created_at', 'gift_id', 'key', 'version']);
    await store.clearTerminalCardReference(gift, randomUUID());
    assert.ok(store.readCardReference(gift), 'A stale tab cannot clear another key');
    await store.clearTerminalCardReference(gift, seen[0].reference.key); assert.equal(store.readCardReference(gift), null);
    const originalSet = dom.window.Storage.prototype.setItem;
    dom.window.Storage.prototype.setItem = () => { throw new Error('quota'); };
    let called = false;
    await assert.rejects(store.withCardOperation(gift, async () => { called = true; }));
    assert.equal(called, false, 'No POST before durable persistence');
    dom.window.Storage.prototype.setItem = originalSet;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    let sent = false;
    await assert.rejects(store.withCardOperation(gift, async () => { sent = true; })); assert.equal(sent, false);
    dom.window.localStorage.setItem(store.cardReferencePrefix + gift, '{broken');
    assert.throws(() => store.readCardReference(gift));
    const original = dom.window.Storage.prototype.getItem;
    dom.window.Storage.prototype.getItem = () => { throw new Error('blocked'); };
    assert.throws(() => store.readCardReference(gift));
    dom.window.Storage.prototype.getItem = original;
  } finally {
    for (const [key, descriptor] of [['window', oldWindow], ['navigator', oldNavigator]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  }
});
