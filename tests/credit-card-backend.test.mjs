import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { createDatabase } from './database-fixture.mjs';
import { typescriptModule } from './typescript-fixture.mjs';

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const contracts = await import(await typescriptModule('../src/lib/payments/contracts.ts'));
const domain = await import(await typescriptModule('../src/lib/gifts/contribution.ts'));
const client = await import(await typescriptModule('../src/lib/payments/mercado-pago/client.ts'));
let fixtureId = 0;

async function fixture(db, { environment = 'production', post = ['processing', 'in_process'] } = {}) {
  const name = `__card_backend_${++fixtureId}`;
  const writes = [], calls = [], http = [];
  const saved = Object.fromEntries(['PAYMENTS_ENVIRONMENT', 'MERCADO_PAGO_ACCESS_TOKEN',
    'MERCADO_PAGO_USER_ID', 'MERCADO_PAGO_APPLICATION_ID', 'MERCADO_PAGO_WEBHOOK_SECRET', 'NODE_ENV']
    .map(key => [key, process.env[key]]));
  process.env.PAYMENTS_ENVIRONMENT = environment;
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'MOCK_ACCESS_TOKEN_NEVER_REAL';
  process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'MOCK_SIGNATURE_SECRET_NEVER_REAL';
  delete process.env.MERCADO_PAGO_USER_ID;
  delete process.env.MERCADO_PAGO_APPLICATION_ID;
  const savedFetch = globalThis.fetch;
  let lastOrder;
  let getStatus;
  const callback = async (path, body) => {
    calls.push({ path, body });
    if (path === 'rpc/get_gift_progress_for_environment') return (await db.query('select * from get_gift_progress_for_environment($1)', [body.p_environment])).rows;
    if (path === 'rpc/expire_gift_contribution_pending_for_environment') return (await db.query('select expire_gift_contribution_pending_for_environment($1,$2) as value', [body.p_environment, body.p_idempotency_key])).rows[0].value;
    if (path === 'rpc/claim_gift_payment_attempt_for_environment') return (await db.query('select * from claim_gift_payment_attempt_for_environment($1,$2,$3,$4)', [body.p_contribution_id, body.p_environment, body.p_provider_idempotency_key, body.p_lease_seconds])).rows;
    if (path === 'rpc/claim_gift_card_payment_attempt') return (await db.query('select * from claim_gift_card_payment_attempt($1,$2,$3,$4,$5,$6)', [body.p_contribution_id, body.p_environment, body.p_provider_idempotency_key, body.p_installments, body.p_method_id, body.p_lease_seconds])).rows;
    if (path === 'rpc/begin_gift_order_submission_for_environment') return (await db.query('select begin_gift_order_submission_for_environment($1,$2) as value', [body.p_attempt_id, body.p_environment])).rows[0].value;
    if (path === 'rpc/reconcile_gift_payment_attempt_for_environment') return (await db.query('select reconcile_gift_payment_attempt_for_environment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [body.p_attempt_id, body.p_environment, body.p_provider_order_id, body.p_provider_payment_id, body.p_provider_status, body.p_provider_status_detail, body.p_amount, body.p_external_reference, body.p_expires_at, body.p_pix_qr_code, body.p_pix_qr_code_base64, body.p_ticket_url])).rows[0].value;
    if (path === 'rpc/claim_due_gift_payment_reconciliation_for_environment') return (await db.query('select * from claim_due_gift_payment_reconciliation_for_environment($1,$2,$3)', [body.p_environment, body.p_limit, body.p_lease_seconds])).rows;
    const url = new URL(path, 'https://fixture.invalid/');
    const table = url.pathname.slice(1);
    assert.ok(['gifts', 'gift_contributions', 'payment_attempts', 'payment_webhook_events'].includes(table));
    const parameters = [], filters = [];
    for (const [key, value] of url.searchParams) {
      if (['select', 'limit'].includes(key)) continue;
      assert.ok(['id', 'idempotency_key', 'contribution_id', 'provider_order_id', 'provider', 'event_key'].includes(key));
      assert.ok(value.startsWith('eq.'));
      parameters.push(value.slice(3)); filters.push(`${key}=$${parameters.length}`);
    }
    return (await db.query(`select * from ${table}${filters.length ? ` where ${filters.join(' and ')}` : ''}`, parameters)).rows;
  };
  const insert = async (path, body) => {
    const table = path.split('?')[0];
    assert.ok(['gift_contributions', 'payment_webhook_events'].includes(table));
    writes.push({ table, body: structuredClone(body) });
    for (const key of ['card_token', 'token', 'pan', 'cvv', 'payer', 'device_id', 'installments', 'payment_method_id']) assert.ok(!Object.hasOwn(body, key));
    const fields = Object.keys(body);
    assert.ok(fields.every(field => /^[a-z_]+$/.test(field)));
    return (await db.query(`insert into ${table}(${fields.join(',')}) values (${fields.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(body))).rows;
  };
  const update = async (path, body) => {
    writes.push({ table: path.split('?')[0], body: structuredClone(body) });
    assert.match(path, /^payment_webhook_events\?id=eq\./);
    return (await db.query('update payment_webhook_events set processed_at=$2,outcome=$3 where id=$1 returning *', [path.split('eq.')[1], body.processed_at, body.outcome])).rows;
  };
  globalThis[name] = { callback, insert, update };
  const databaseUrl = moduleUrl(`export const database = (...args) => globalThis[${JSON.stringify(name)}].callback(...args);
    export const databaseInsert = (...args) => globalThis[${JSON.stringify(name)}].insert(...args);
    export const databaseUpdate = (...args) => globalThis[${JSON.stringify(name)}].update(...args);`);
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://api.mercadopago.com/v1/orders'));
    http.push({ method: init.method, body: init.body, headers: init.headers, url });
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if (post === 'timeout') throw new DOMException('mock timeout', 'TimeoutError');
      if (post === 'unknown') return Response.json({ unknown: true }, { status: 201 });
      const method = body.transactions.payments[0].payment_method;
      lastOrder = { id: `ORD-FIXTURE-${randomUUID()}`, external_reference: body.external_reference,
        total_amount: body.total_amount, currency: 'BRL', status: post[0], status_detail: post[1],
        transactions: { payments: [{ id: `PAY-FIXTURE-${randomUUID()}`, amount: body.total_amount,
          status: post[0], status_detail: post[1], payment_method: { ...method,
            ...(post[1] === 'pending_challenge' ? { transaction_security: { url: 'https://issuer.example/challenge?temporary=MOCK_CHALLENGE' } } : {}) } }] } };
      return Response.json(lastOrder, { status: 201 });
    }
    assert.equal(init.method, 'GET');
    assert.ok(lastOrder);
    const order = structuredClone(lastOrder);
    if (getStatus) {
      [order.status, order.status_detail] = getStatus;
      [order.transactions.payments[0].status, order.transactions.payments[0].status_detail] = getStatus;
    }
    return Response.json(order);
  };
  const replacements = { '@/lib/supabase/server': databaseUrl };
  const serviceUrl = await typescriptModule('../src/services/gift-payments.ts', replacements);
  const service = await import(serviceUrl);
  const request = async (mode = 'open') => {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount,gift_type)
      values ('Fixture gift',$1,'party',$2,case when $2='open' then null when $2='fixed' then 75 else 100 end,'regular') returning *`, [randomUUID(), mode])).rows[0];
    return { idempotency_key: randomUUID(), gift_id: gift.id, amount: '50,00',
      contributor_name: 'Pessoa Fixture', contributor_phone: '11999999999', contributor_email: 'fixture@example.invalid',
      payment_method: 'credit_card', card_token: `MOCK_CARD_TOKEN_${fixtureId}`, payment_method_id: 'master', installments: 1,
      payer: { identification: { type: 'CPF', number: '12345678909' } }, device_id: `MOCK_DEVICE_${fixtureId}` };
  };
  const state = async key => (await db.query(`select gc.*,pa.id as attempt_id,pa.provider_order_id,
    pa.provider_idempotency_key,pa.installments,pa.provider_payment_method_id,pa.order_submission_state,pa.order_submission_started_at
    from gift_contributions gc left join payment_attempts pa on pa.contribution_id=gc.id where gc.idempotency_key=$1`, [key])).rows[0];
  return { service, serviceUrl, request, state, writes, calls, http,
    get order() { return lastOrder; }, setGet(status, detail) { getStatus = [status, detail]; },
    restore() { globalThis.fetch = savedFetch; delete globalThis[name]; for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    } } };
}

test('card request contract rejects raw data and preserves stable payment fingerprints', () => {
  const input = { idempotency_key: randomUUID(), gift_id: randomUUID(), amount: '50,00',
    contributor_name: 'Fixture', contributor_phone: '11999999999', contributor_email: 'fixture@example.invalid',
    payment_method: 'credit_card', card_token: 'MOCK_TOKEN', payment_method_id: 'master', installments: 1 };
  const gift = { id: input.gift_id, active: true, funding_mode: 'goal', target_amount: 100, gift_type: 'regular' };
  const progress = { remaining_amount: 1, goal_reached: false };
  const first = domain.preparePendingContribution(input, gift, progress);
  assert.equal(first.amount, '50.00');
  assert.equal(first.payment_method, 'credit_card');
  assert.equal(domain.preparePendingContribution({ ...input, amount: '0,01' }, gift, progress).amount, '0.01');
  assert.ok(!JSON.stringify(first).includes(input.card_token));
  assert.equal(domain.preparePendingContribution({ ...input, card_token: 'MOCK_TOKEN_NEW' }, gift, progress).request_fingerprint, first.request_fingerprint);
  for (const changed of [{ installments: 12 }, { payment_method_id: 'visa' }]) assert.notEqual(domain.preparePendingContribution({ ...input, ...changed }, gift, progress).request_fingerprint, first.request_fingerprint);
  for (const installments of [0, 13, 1.5, null]) assert.throws(() => domain.preparePendingContribution({ ...input, installments }, gift, progress), /dados do pagamento/);
  for (const payment_method_id of ['pix', '', ' master', 'master\n', 'x'.repeat(65)]) assert.throws(() => domain.preparePendingContribution({ ...input, payment_method_id }, gift, progress));
  for (const field of ['pan', 'card_number', 'cvv', 'expiration_month', 'expiration_year']) assert.throws(() => domain.preparePendingContribution({ ...input, [field]: 'MOCK_RAW' }, gift, progress));
  assert.throws(() => contracts.parseContributionPayment({ ...input, card_token: undefined }));
  assert.throws(() => contracts.parseContributionPayment({ ...input, payer: { identification: input.payer, cvv: 'MOCK_RAW' } }));
});

test('card backend with PostgreSQL and mocked Orders, never real network', async t => {
  const db = await createDatabase();
  try {
    await t.test('card RPC remains private, enforces metadata/environment and prevents Pix reuse', async () => {
      const signature = 'public.claim_gift_card_payment_attempt(uuid,text,uuid,numeric,text,integer)';
      for (const role of ['anon', 'authenticated']) assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', [role, signature, 'EXECUTE'])).rows[0].allowed, false);
      assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', ['service_role', signature, 'EXECUTE'])).rows[0].allowed, true);
      assert.equal((await db.query("select has_function_privilege('service_role','public.claim_gift_payment_attempt_method_core(uuid,uuid,integer,text,numeric,text)','EXECUTE') as allowed")).rows[0].allowed, false);
      const f = await fixture(db);
      try {
        const input = await f.request();
        const row = domain.preparePendingContribution(input, { id: input.gift_id, active: true, funding_mode: 'open', target_amount: null, gift_type: 'regular' }, null);
        const persisted = (await globalThis[`__card_backend_${fixtureId}`].insert('gift_contributions', row))[0];
        const claim = (environment, installments, method) => db.query('select * from claim_gift_card_payment_attempt($1,$2,gen_random_uuid(),$3,$4,30)', [persisted.id, environment, installments, method]);
        for (const installments of [null, 0, 13, 1.5]) await assert.rejects(claim('production', installments, 'master'), /invalid_card_payment_method/);
        await assert.rejects(claim('test', 1, 'master'), /payment_environment_mismatch/);
        const first = (await claim('production', 1, 'master')).rows[0];
        const reused = (await claim('production', 1, 'master')).rows[0];
        assert.equal(first.id, reused.id);
        assert.equal(first.provider_idempotency_key, reused.provider_idempotency_key);
        await assert.rejects(claim('production', 12, 'master'), /payment_attempt_method_mismatch/);
        await assert.rejects(claim('production', 1, 'visa'), /payment_attempt_method_mismatch/);
      } finally { f.restore(); }
    });

    await t.test('goal/open/fixed, gross total and installments 1/12; token never persisted', async () => {
      for (const mode of ['goal', 'open', 'fixed']) {
        const f = await fixture(db, { post: ['processed', 'accredited'] });
        try {
          const input = await f.request(mode); input.installments = mode === 'fixed' ? 12 : 1;
          if (mode === 'goal') await db.query(`insert into gift_contributions(gift_id,payment_environment,payment_method,
            contributor_name,amount,payment_status,confirmed_at,idempotency_key,request_fingerprint)
            values ($1,'production','external','Fixture',90,'confirmed',now(),gen_random_uuid(),repeat('a',64))`, [input.gift_id]);
          const result = await f.service.createGiftPayment(input);
          assert.equal(result.payment_status, 'confirmed');
          const row = await f.state(input.idempotency_key), body = JSON.parse(f.http[0].body);
          assert.equal(Number(row.amount), mode === 'fixed' ? 75 : 50);
          assert.equal(Number(row.installments), input.installments);
          assert.equal(row.provider_payment_method_id, 'master');
          assert.equal(body.total_amount, body.items[0].unit_price);
          assert.equal(body.total_amount, body.transactions.payments[0].amount);
          assert.equal(body.transactions.payments[0].payment_method.token, input.card_token);
          assert.equal(body.transactions.payments[0].payment_method.installments, input.installments);
          assert.equal(f.http[0].headers['X-Idempotency-Key'], row.provider_idempotency_key);
          assert.equal(f.http[0].headers['X-meli-session-id'], input.device_id);
          assert.equal(body.payer.email, input.contributor_email);
          assert.ok(!f.http[0].body.includes('APRO'));
          assert.equal(body.config.online.transaction_security.validation, 'on_fraud_risk');
          assert.equal(Object.hasOwn(body.transactions.payments[0], 'expiration_time'), false);
          const persisted = JSON.stringify([row, f.writes, f.calls]);
          for (const secret of [input.card_token, input.payer.identification.number, input.device_id]) assert.ok(!persisted.includes(secret));
          assert.ok(!JSON.stringify(result).includes(input.card_token));
          const after = await f.service.createGiftPayment(input);
          assert.equal(after.payment_status, 'confirmed');
          assert.equal(f.http.filter(call => call.method === 'POST').length, 1);
          if (mode === 'goal') assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [input.gift_id])).rows[0].total_raised), 140);
        } finally { f.restore(); }
      }
    });

    await t.test('pending/failed/canceled/expired map safely, HTTP 201 never confirms by itself', async () => {
      for (const [status, detail, expected] of [
        ['created', 'created', 'pending'], ['processing', 'in_process', 'pending'],
        ['processed', 'pending', 'pending'], ['approved', 'accredited', 'pending'], ['failed', 'cc_rejected_other_reason', 'failed'],
        ['canceled', 'canceled', 'cancelled'], ['expired', 'expired', 'expired'],
      ]) {
        const f = await fixture(db, { post: [status, detail] });
        try {
          const input = await f.request('goal');
          assert.equal((await f.service.createGiftPayment(input)).payment_status, expected);
          assert.equal((await f.state(input.idempotency_key)).payment_status, expected);
          assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [input.gift_id])).rows[0].total_raised), 0);
          await f.service.createGiftPayment(input);
          assert.equal(f.http.filter(call => call.method === 'POST').length, 1);
        } finally { f.restore(); }
      }
    });

    await t.test('TEST approved money excluded from production and Pix/card cannot reuse identity', async () => {
      const f = await fixture(db, { environment: 'test', post: ['processed', 'accredited'] });
      try {
        const input = await f.request('goal');
        assert.equal((await f.service.createGiftPayment(input)).payment_status, 'confirmed');
        assert.equal(JSON.parse(f.http[0].body).payer.email, 'test@testuser.com');
        assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [input.gift_id])).rows[0].total_raised), 0);
        const pix = { ...input, payment_method: 'pix' };
        for (const key of ['card_token', 'payment_method_id', 'installments', 'payer', 'device_id']) delete pix[key];
        await assert.rejects(f.service.createGiftPayment(pix), error => error.code === 'idempotency_conflict');
        const pixFirst = { ...pix, idempotency_key: randomUUID() };
        await f.service.createGiftPayment(pixFirst);
        assert.equal((await f.state(pixFirst.idempotency_key)).payment_method, 'pix');
        await assert.rejects(f.service.createGiftPayment({ ...input, idempotency_key: pixFirst.idempotency_key }), error => error.code === 'idempotency_conflict');
        process.env.PAYMENTS_ENVIRONMENT = 'production';
        await assert.rejects(f.service.getGiftPaymentStatus({ idempotency_key: input.idempotency_key }), /payment_environment_mismatch/);
        await assert.rejects(f.service.processMercadoPagoOrder((await f.state(input.idempotency_key)).provider_order_id, 'wrong-environment-event'), /payment_environment_mismatch/);
      } finally { f.restore(); }
    });

    await t.test('concurrent retries submit only once; missing token is rejected before any write', async () => {
      const f = await fixture(db);
      try {
        const input = await f.request();
        await assert.rejects(f.service.createGiftPayment({ ...input, card_token: undefined }), error => error.code === 'invalid_payment');
        assert.equal(f.calls.length, 0);
        assert.equal(f.writes.length, 0);
        await Promise.all([f.service.createGiftPayment(input), f.service.createGiftPayment(input)]);
        assert.equal(f.http.filter(call => call.method === 'POST').length, 1);
        assert.equal((await db.query('select count(*)::int as n from gift_contributions where idempotency_key=$1', [input.idempotency_key])).rows[0].n, 1);
        assert.equal((await db.query('select count(*)::int as n from payment_attempts where contribution_id=$1', [(await f.state(input.idempotency_key)).id])).rows[0].n, 1);
      } finally { f.restore(); }
    });

    await t.test('3DS returns only transient HTTPS challenge, then status GET confirms', async () => {
      const f = await fixture(db, { post: ['action_required', 'pending_challenge'] });
      try {
        const input = await f.request();
        const result = await f.service.createGiftPayment(input);
        assert.equal(result.payment_status, 'pending');
        assert.equal(result.payment.status, 'action_required');
        assert.deepEqual(result.payment.challenge, { url: 'https://issuer.example/challenge?temporary=MOCK_CHALLENGE' });
        assert.ok(!JSON.stringify([f.writes, f.calls, await f.state(input.idempotency_key)]).includes('MOCK_CHALLENGE'));
        f.setGet('processed', 'accredited');
        const response = await f.service.getGiftPaymentStatus({ idempotency_key: input.idempotency_key });
        assert.equal(response.payment_status, 'confirmed');
        assert.ok(!Object.hasOwn(response.payment, 'challenge'));
        assert.deepEqual(f.http.map(call => call.method), ['POST', 'GET']);
      } finally { f.restore(); }
    });

    await t.test('timeout/unknown response after begin never cause another POST or status creation', async () => {
      for (const post of ['timeout', 'unknown']) {
        const f = await fixture(db, { post });
        try {
          const input = await f.request();
          await assert.rejects(f.service.createGiftPayment(input));
          const before = await f.state(input.idempotency_key);
          assert.equal(before.order_submission_state, 'started');
          assert.ok(before.order_submission_started_at);
          assert.equal(before.provider_order_id, null);
          assert.equal((await f.service.createGiftPayment({ ...input, card_token: 'MOCK_NEW_TOKEN' })).payment.status, 'investigating');
          const noOrder = await f.service.getGiftPaymentStatus({ idempotency_key: input.idempotency_key });
          assert.equal(noOrder.payment_status, 'pending');
          assert.equal(noOrder.payment.status, 'investigating');
          const after = await f.state(input.idempotency_key);
          assert.equal(after.attempt_id, before.attempt_id);
          assert.equal(after.provider_idempotency_key, before.provider_idempotency_key);
          assert.equal(f.http.length, 1);
        } finally { f.restore(); }
      }
    });

    await t.test('card status with no attempt never claims or posts; public card creation remains disabled', async () => {
      const f = await fixture(db);
      try {
        const input = await f.request();
        const row = domain.preparePendingContribution(input, { id: input.gift_id, active: true, funding_mode: 'open', gift_type: 'regular', target_amount: null }, null);
        await globalThis[`__card_backend_${fixtureId}`].insert('gift_contributions', row);
        const httpUrl = moduleUrl(`export const assertSameOrigin=()=>{}; export const limit=async()=>{}; export const readBody=r=>r.json();`);
        const status = await import(await typescriptModule('../src/app/api/gift-contributions/status/route.ts', {
          '@/services/gift-payments': f.serviceUrl, '@/lib/invitations/http': httpUrl,
        }));
        const response = await status.POST(new Request('https://fixture.invalid/api/gift-contributions/status', { method: 'POST', body: JSON.stringify({ idempotency_key: input.idempotency_key }) }));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).payment_status, 'pending');
        assert.equal(f.http.length, 0);
        assert.ok(!f.calls.some(call => call.path.includes('claim_gift')));
        const creation = await import(await typescriptModule('../src/app/api/gift-contributions/route.ts', {
          '@/services/gift-payments': f.serviceUrl, '@/lib/invitations/http': httpUrl,
        }));
        const blocked = await creation.POST(new Request('https://fixture.invalid/api/gift-contributions', { method: 'POST', body: JSON.stringify(input) }));
        assert.equal(blocked.status, 409);
        assert.equal(f.http.length, 0);
      } finally { f.restore(); }
    });

    await t.test('signed webhook and scheduler reconcile known card Orders with no new charge', async () => {
      const f = await fixture(db, { post: ['processing', 'in_process'] });
      try {
        const input = await f.request();
        await f.service.createGiftPayment(input);
        const row = await f.state(input.idempotency_key);
        f.setGet('processed', 'accredited');
        const sdk = new URL('../node_modules/mercadopago/dist/index.js', import.meta.url).href;
        const webhook = await import(await typescriptModule('../src/app/api/payments/mercado-pago/webhook/route.ts', {
          '@/services/gift-payments': f.serviceUrl, mercadopago: sdk,
        }));
        const ts = String(Math.floor(Date.now() / 1000)), requestId = 'mock-request-id';
        const v1 = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
          .update(`id:${f.order.id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
        const response = await webhook.POST(new Request(`https://fixture.invalid/api/payments/mercado-pago/webhook?type=order&data.id=${f.order.id}`, {
          method: 'POST', headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${v1}` },
        }));
        assert.equal(response.status, 200);
        assert.equal((await f.state(input.idempotency_key)).payment_status, 'confirmed');
        assert.equal(f.http.filter(call => call.method === 'POST').length, 1);
        assert.equal((await db.query('select count(*)::int as n from payment_attempts where contribution_id=$1', [row.id])).rows[0].n, 1);
        const pending = await f.request();
        f.setGet('processing', 'in_process');
        await f.service.createGiftPayment(pending);
        const pendingRow = await f.state(pending.idempotency_key);
        await db.query("update payment_attempts set provider_checked_at=now()-interval '10 minutes' where id=$1", [pendingRow.attempt_id]);
        f.setGet('processed', 'accredited');
        const beforePosts = f.http.filter(call => call.method === 'POST').length;
        const batch = await f.service.reconcilePendingGiftPaymentsBatch();
        assert.ok(batch.reconciled >= 1);
        assert.equal(batch.deferred, 0);
        assert.equal((await f.state(pending.idempotency_key)).payment_status, 'confirmed');
        assert.equal(f.http.filter(call => call.method === 'POST').length, beforePosts);
      } finally { f.restore(); }
    });
  } finally { await db.close(); }
});

test('card provider errors redact transient values; malformed challenge URLs never returned', async () => {
  const db = await createDatabase();
  const f = await fixture(db);
  const messages = [], savedError = console.error;
  try {
    const input = await f.request();
    process.env.NODE_ENV = 'development';
    console.error = (...args) => messages.push(args);
    await assert.rejects(client.createCreditCardOrder({ ...input, amount: 50, giftId: input.gift_id,
      giftName: 'Fixture', externalReference: 'gift-contribution-fixture', idempotencyKey: input.idempotency_key,
      payerEmail: input.contributor_email, payerName: input.contributor_name }, async () => Response.json({
      message: `Invalid ${input.card_token}`, cause: [{ description: input.payer.identification.number }],
    }, { status: 400 })));
    const logs = JSON.stringify(messages);
    for (const secret of [input.card_token, input.payer.identification.number, input.device_id]) assert.ok(!logs.includes(secret));
    await assert.rejects(client.getOrder('ORD-MOCK', async () => Response.json({
      message: 'Unknown provider card token and document 12345678909',
    }, { status: 400 }), true));
    assert.ok(!JSON.stringify(messages).includes('12345678909'));
    for (const url of ['http://issuer.example/challenge', 'javascript:alert(1)', 'https://user:password@issuer.example/challenge']) {
      const order = await client.getOrder('ORD-MOCK', async () => Response.json({
        id: 'ORD-MOCK', external_reference: 'fixture', total_amount: '50.00', status: 'action_required', status_detail: 'pending_challenge',
        transactions: { payments: [{ amount: '50.00', status: 'action_required', status_detail: 'pending_challenge',
          payment_method: { id: 'master', type: 'credit_card', installments: 1, token: 'MOCK_ECHOED_TOKEN', transaction_security: { url } } }] },
      }));
      assert.equal(order.payment.payment_method.challenge_url, null);
      assert.ok(!JSON.stringify(order).includes('MOCK_ECHOED_TOKEN'));
      const inconsistent = { ...order, status: 'processed', status_detail: 'accredited' };
      assert.throws(() => client.assertExpectedOrder(inconsistent, { amount: 50, externalReference: 'fixture',
        paymentMethod: 'credit_card', paymentMethodId: 'master', installments: 1 }));
    }
  } finally { console.error = savedError; f.restore(); await db.close(); }
});
