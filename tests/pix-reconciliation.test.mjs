import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './database-fixture.mjs';
import ts from 'typescript';

const migrationName = '202609260001_pix_expiry_reconciliation.sql';
const key = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('expired unsent attempts stop, uncertain sends remain pending, and known Orders reconcile monotonically', async () => {
  const db = await createDatabase({ beforeMigration: migrationName });
  try {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Meta Pix','meta-pix-expiry','house','goal',1000) returning id`)).rows[0].id;
    await db.exec('set role service_role');
    const make = async (label, overdue, n) => {
      const contribution = (await db.query(`insert into gift_contributions(
        gift_id,contributor_name,contributor_email,amount,payment_method,
        idempotency_key,request_fingerprint,created_at,expires_at)
        values ($1,$2,$3,100,'pix',gen_random_uuid(),repeat('a',64),
          now()-make_interval(mins => $4),now()+make_interval(mins => $5)) returning id`,
      [gift, label, `guest${n}@example.com`, overdue ? 31 : 0, overdue ? -1 : 30])).rows[0];
      const attempt = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
        [contribution.id, key(n)])).rows[0];
      return { contribution, attempt };
    };
    const unsent = await make('Unsent', true, 1);
    const uncertain = await make('Uncertain', true, 2);
    const known = await make('Known', true, 3);
    const fresh = await make('Fresh', false, 4);
    const providerExpired = await make('Provider expired', true, 5);
    const overdueUnsent = await make('Job expired', true, 6);
    const terminalOutside = await make('Window closed', true, 7);
    const expiredOutside = await make('Expired window closed', true, 8);
    await db.query('update payment_attempts set provider_status=$1 where id=$2', ['processing', known.attempt.id]);
    await db.exec('reset role');
    await db.exec(await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'));
    await db.exec('set role service_role');
    await db.query(`update payment_attempts
      set order_submission_state='not_started' where id in ($1,$2,$3)`,
    [unsent.attempt.id, overdueUnsent.attempt.id, fresh.attempt.id]);
    await db.query(`update payment_attempts set order_submission_state='started',
      order_submission_started_at=now()-interval '31 minutes' where id=$1`,
    [uncertain.attempt.id]);

    const stopped = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
      [unsent.contribution.id, key(99)])).rows[0];
    assert.equal(stopped.can_create, false);
    assert.equal(stopped.provider_idempotency_key, unsent.attempt.provider_idempotency_key);
    assert.equal((await db.query('select payment_status from gift_contributions where id=$1',
      [unsent.contribution.id])).rows[0].payment_status, 'expired');
    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [unsent.attempt.id])).rows[0].allowed, false);

    const unknown = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
      [uncertain.contribution.id, key(98)])).rows[0];
    assert.equal(unknown.can_create, false);
    assert.equal(unknown.provider_idempotency_key, uncertain.attempt.provider_idempotency_key);
    assert.equal((await db.query('select payment_status from gift_contributions where id=$1',
      [uncertain.contribution.id])).rows[0].payment_status, 'pending');
    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [uncertain.attempt.id])).rows[0].allowed, false);

    assert.equal((await db.query('select expire_gift_contribution_pending(null) as n')).rows[0].n, 1);
    assert.equal((await db.query('select payment_status from gift_contributions where id=$1',
      [overdueUnsent.contribution.id])).rows[0].payment_status, 'expired');
    assert.equal((await db.query('select payment_status from gift_contributions where id=$1',
      [uncertain.contribution.id])).rows[0].payment_status, 'pending');

    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [fresh.attempt.id])).rows[0].allowed, true);
    assert.ok((await db.query('select order_submission_started_at from payment_attempts where id=$1',
      [fresh.attempt.id])).rows[0].order_submission_started_at);

    const reconcile = async (status, detail) => (await db.query(`select reconcile_gift_payment_attempt(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as status`, [
      known.attempt.id, 'ORD-EXPIRED-KNOWN', 'PAY-EXPIRED-KNOWN', status, detail,
      100, known.attempt.external_reference, known.attempt.expires_at,
      null, null, null,
    ])).rows[0].status;
    assert.equal(await reconcile('processing', 'in_process'), 'pending');
    assert.equal((await db.query(`select reconcile_gift_payment_attempt(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as status`, [
      providerExpired.attempt.id, 'ORD-PROVIDER-EXPIRED', null,
      'expired', 'expired', 100, providerExpired.attempt.external_reference,
      providerExpired.attempt.expires_at, null, null, null,
    ])).rows[0].status, 'expired');
    await db.query(`update payment_attempts set provider_checked_at=now()-interval '1 day'
      where id=$1`, [known.attempt.id]);
    const firstBatch = (await db.query('select * from claim_due_gift_payment_reconciliation(10,120)')).rows;
    assert.deepEqual(firstBatch.map(row => row.id), [known.attempt.id]);
    assert.equal((await db.query('select count(*)::int as n from claim_due_gift_payment_reconciliation(10,120)')).rows[0].n, 0);
    assert.equal(await reconcile('failed', 'failed'), 'failed');
    assert.ok((await db.query('select terminal_followup_until from payment_attempts where id=$1',
      [known.attempt.id])).rows[0].terminal_followup_until);
    await db.query(`update payment_attempts set provider_checked_at=now()-interval '31 minutes'
      where id=$1`, [known.attempt.id]);
    assert.deepEqual((await db.query('select * from claim_due_gift_payment_reconciliation(10,120)')).rows
      .map(row => row.id), [known.attempt.id]);
    assert.equal(await reconcile('processed', 'accredited'), 'confirmed');
    assert.equal(await reconcile('processed', 'accredited'), 'confirmed');
    assert.equal(await reconcile('processing', 'in_process'), 'confirmed');
    assert.equal(await reconcile('expired', 'expired'), 'confirmed');
    assert.equal((await db.query('select provider_status from payment_attempts where id=$1',
      [known.attempt.id])).rows[0].provider_status, 'processed');
    assert.equal((await db.query('select terminal_followup_until from payment_attempts where id=$1',
      [known.attempt.id])).rows[0].terminal_followup_until, null);
    await db.query(`update payment_attempts set provider_checked_at=now()-interval '31 minutes'
      where id=$1`, [providerExpired.attempt.id]);
    assert.deepEqual((await db.query('select * from claim_due_gift_payment_reconciliation(10,120)')).rows
      .map(row => row.id), [providerExpired.attempt.id]);
    assert.equal((await db.query(`select reconcile_gift_payment_attempt(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as status`, [
      providerExpired.attempt.id, 'ORD-PROVIDER-EXPIRED', null,
      'processed', 'accredited', 100, providerExpired.attempt.external_reference,
      providerExpired.attempt.expires_at, null, null, null,
    ])).rows[0].status, 'confirmed');
    assert.equal((await db.query(`select reconcile_gift_payment_attempt(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as status`, [
      terminalOutside.attempt.id, 'ORD-WINDOW-CLOSED', null,
      'failed', 'failed', 100, terminalOutside.attempt.external_reference,
      terminalOutside.attempt.expires_at, null, null, null,
    ])).rows[0].status, 'failed');
    assert.equal((await db.query(`select reconcile_gift_payment_attempt(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as status`, [
      expiredOutside.attempt.id, 'ORD-EXPIRED-WINDOW-CLOSED', null,
      'expired', 'expired', 100, expiredOutside.attempt.external_reference,
      expiredOutside.attempt.expires_at, null, null, null,
    ])).rows[0].status, 'expired');
    await db.query(`update payment_attempts set terminal_followup_until=now()-interval '1 second',
      provider_checked_at=now()-interval '31 minutes' where id in ($1,$2)`,
    [terminalOutside.attempt.id, expiredOutside.attempt.id]);
    assert.equal((await db.query('select count(*)::int as n from claim_due_gift_payment_reconciliation(10,120)')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('new reconciliation guard confirms an issued Pix after expiry above a completed goal', async () => {
  const db = await createDatabase({ beforeMigration: migrationName });
  try {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Late goal','late-goal-pix','house','goal',1000) returning id`)).rows[0].id;
    await db.exec('set role service_role');
    await db.query(`insert into gift_contributions(gift_id,contributor_name,contributor_email,
      amount,payment_method,payment_status,confirmed_at,idempotency_key,request_fingerprint)
      values ($1,'Previous','previous@example.com',900,'pix','confirmed',now(),gen_random_uuid(),repeat('a',64))`, [gift]);
    const contribution = (await db.query(`insert into gift_contributions(gift_id,
      contributor_name,contributor_email,amount,payment_method,idempotency_key,
      request_fingerprint,created_at,expires_at)
      values ($1,'Late','late@example.com',200,'pix',gen_random_uuid(),repeat('b',64),
        now()-interval '31 minutes',now()-interval '1 minute') returning id`, [gift])).rows[0];
    const attempt = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
      [contribution.id, key(91)])).rows[0];
    await db.exec('reset role');
    await db.exec(await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'));
    await db.exec('set role service_role');
    const result = (await db.query(`select reconcile_gift_payment_attempt(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as status`, [
      attempt.id, 'ORD-LATE-GOAL', 'PAY-LATE-GOAL', 'processed', 'accredited',
      200, attempt.external_reference, attempt.expires_at, null, null, null,
    ])).rows[0].status;
    assert.equal(result, 'confirmed');
    const progress = (await db.query('select * from get_gift_progress() where gift_id=$1', [gift])).rows[0];
    assert.equal(Number(progress.total_raised), 1100);
    assert.equal(Number(progress.percentage), 100);
  } finally { await db.close(); }
});

test('migration preserves historical confirmed payments and quarantines legacy attempts without Orders', async () => {
  const db = await createDatabase({ beforeMigration: migrationName });
  try {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Legacy Pix','legacy-pix-audit','house','goal',1000) returning id`)).rows[0].id;
    await db.exec('set role service_role');
    const make = async (n) => {
      const contribution = (await db.query(`insert into gift_contributions(
        gift_id,contributor_name,contributor_email,amount,payment_method,
        idempotency_key,request_fingerprint,created_at,expires_at)
        values ($1,'Legacy',$2,50,'pix',gen_random_uuid(),repeat('a',64),
          now()-interval '31 minutes',now()-interval '1 minute') returning id`,
      [gift, `legacy${n}@example.com`])).rows[0];
      const attempt = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
        [contribution.id, key(n)])).rows[0];
      return { contribution, attempt };
    };
    const unknown = await make(71);
    const known = await make(72);
    const confirmed = await make(73);
    const failed = await make(74);
    const expired = await make(75);
    await db.query(`update payment_attempts set provider_order_id='ORD-LEGACY-KNOWN',
      provider_status='processing' where id=$1`, [known.attempt.id]);
    const observe = async (entry, orderId, status, detail) => db.query(`
      select reconcile_gift_payment_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      entry.attempt.id, orderId, null, status, detail, 50,
      entry.attempt.external_reference, entry.attempt.expires_at, null, null, null,
    ]);
    await observe(confirmed, 'ORD-LEGACY-CONFIRMED', 'processed', 'accredited');
    await observe(failed, 'ORD-LEGACY-FAILED', 'failed', 'failed');
    await observe(expired, 'ORD-LEGACY-EXPIRED', 'expired', 'expired');
    const confirmedBefore = (await db.query(`select gc.payment_status, gc.confirmed_at,
      pa.provider_status, pa.confirmed_at as attempt_confirmed_at
      from gift_contributions gc join payment_attempts pa on pa.contribution_id=gc.id
      where gc.id=$1`, [confirmed.contribution.id])).rows[0];
    await db.exec('reset role');
    await db.exec(await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'));
    await db.exec('set role service_role');
    const historical = (await db.query(`select id, order_submission_state,
      order_submission_started_at, reconciliation_lease_until, terminal_followup_until
      from payment_attempts where id in ($1,$2,$3,$4,$5)`, [
      unknown.attempt.id, known.attempt.id, confirmed.attempt.id,
      failed.attempt.id, expired.attempt.id,
    ])).rows;
    assert.equal(historical.length, 5);
    for (const row of historical) {
      assert.equal(row.order_submission_state, 'legacy');
      assert.equal(row.order_submission_started_at, null);
      assert.equal(row.reconciliation_lease_until, null);
    }
    assert.equal((await db.query('select expire_gift_contribution_pending(null) as n')).rows[0].n, 0);
    const quarantined = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
      [unknown.contribution.id, key(99)])).rows[0];
    assert.equal(quarantined.can_create, false);
    assert.equal(quarantined.order_submission_state, 'legacy');
    assert.equal(quarantined.provider_idempotency_key, unknown.attempt.provider_idempotency_key);
    assert.equal(quarantined.external_reference, unknown.attempt.external_reference);
    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [unknown.attempt.id])).rows[0].allowed, false);
    assert.equal((await db.query('select payment_status from gift_contributions where id=$1',
      [unknown.contribution.id])).rows[0].payment_status, 'pending');
    assert.equal((await db.query('select * from claim_due_gift_payment_reconciliation(10,120)')).rows
      .map(row => row.id).includes(known.attempt.id), true);
    const confirmedAfter = (await db.query(`select gc.payment_status, gc.confirmed_at,
      pa.provider_status, pa.confirmed_at as attempt_confirmed_at
      from gift_contributions gc join payment_attempts pa on pa.contribution_id=gc.id
      where gc.id=$1`, [confirmed.contribution.id])).rows[0];
    assert.deepEqual(confirmedAfter, confirmedBefore);
    assert.equal(historical.find(row => row.id === confirmed.attempt.id).terminal_followup_until, null);
    assert.ok(historical.find(row => row.id === failed.attempt.id).terminal_followup_until);
    assert.ok(historical.find(row => row.id === expired.attempt.id).terminal_followup_until);
  } finally { await db.close(); }
});

test('new attempts receive only one durable POST authorization after a lease expires', async () => {
  const db = await createDatabase();
  try {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Single POST','single-post-pix','house','goal',1000) returning id`)).rows[0].id;
    await db.exec('set role service_role');
    const contribution = (await db.query(`insert into gift_contributions(
      gift_id,contributor_name,contributor_email,amount,payment_method,
      idempotency_key,request_fingerprint)
      values ($1,'New','new@example.com',50,'pix',gen_random_uuid(),repeat('a',64))
      returning id`, [gift])).rows[0];
    const first = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
      [contribution.id, key(81)])).rows[0];
    assert.equal(first.order_submission_state, 'not_started');
    assert.equal(first.can_create, true);
    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [first.id])).rows[0].allowed, true);
    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [first.id])).rows[0].allowed, false);
    await db.query(`update payment_attempts set creation_lease_until=now()-interval '1 second'
      where id=$1`, [first.id]);
    const afterCrash = (await db.query('select * from claim_gift_payment_attempt($1,$2,30)',
      [contribution.id, key(82)])).rows[0];
    assert.equal(afterCrash.can_create, false);
    assert.equal(afterCrash.order_submission_state, 'started');
    assert.equal(afterCrash.id, first.id);
    assert.equal(afterCrash.provider_idempotency_key, first.provider_idempotency_key);
    assert.equal(afterCrash.external_reference, first.external_reference);
    assert.equal((await db.query('select begin_gift_order_submission($1) as allowed',
      [first.id])).rows[0].allowed, false);
    assert.equal((await db.query('select count(*)::int as n from payment_attempts where contribution_id=$1',
      [contribution.id])).rows[0].n, 1);
  } finally { await db.close(); }
});

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

async function paymentServiceFixture({ attempt, orderStatus = 'processing', orderDetail = 'in_process', providerError = 0 }) {
  const contribution = {
    id: attempt.contribution_id, gift_id: '70000000-0000-4000-8000-000000000001',
    payment_status: 'pending', contributor_name: 'Test', contributor_email: 'test@example.test',
  };
  const databaseUrl = moduleUrl(`
    export const calls = [];
    export async function database(path) {
      calls.push(path);
      if (path === 'rpc/claim_gift_payment_attempt') return [${JSON.stringify(attempt)}];
      if (path === 'rpc/begin_gift_order_submission') return false;
      if (path === 'rpc/expire_gift_contribution_pending') return 0;
      if (path === 'rpc/claim_due_gift_payment_reconciliation') return [{ id: ${JSON.stringify(attempt.id)}, contribution_id: ${JSON.stringify(attempt.contribution_id)} }];
      if (path === 'rpc/reconcile_gift_payment_attempt') return 'pending';
      if (path.startsWith('gift_contributions?')) return [${JSON.stringify(contribution)}];
      if (path.startsWith('payment_attempts?')) return [${JSON.stringify(attempt)}];
      if (path.startsWith('gifts?')) return [{ id: ${JSON.stringify(contribution.gift_id)}, name: 'Test gift' }];
      throw new Error('unexpected query: ' + path);
    }
    export async function databaseInsert() { throw new Error('unexpected insert'); }
    export async function databaseUpdate() { throw new Error('unexpected update'); }
  `);
  const clientUrl = moduleUrl(`
    export const calls = [];
    export async function createPixOrder() { calls.push('POST'); throw new Error('POST must not happen'); }
    export async function getOrder() { calls.push('GET');
      const simulatedError = ${JSON.stringify(providerError)};
      if (simulatedError) { const error = new Error('provider unavailable');
        if (simulatedError === 'timeout') error.name = 'TimeoutError';
        else error.diagnostic = { httpStatus: simulatedError };
        throw error; }
      return {
      id: 'ORD-KNOWN', external_reference: ${JSON.stringify(attempt.external_reference)},
      total_amount: '50.00', currency_id: 'BRL', status: ${JSON.stringify(orderStatus)},
      status_detail: ${JSON.stringify(orderDetail)}, payment: null,
    }; }
    export function assertExpectedOrder() {}
  `);
  const contributionUrl = moduleUrl('export class GiftContributionError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }');
  const pendingUrl = moduleUrl(`export async function createPendingGiftContribution() {
    return { payment_status: 'pending', contribution: ${JSON.stringify(contribution)} };
  }`);
  const source = (await readFile(new URL('../src/services/gift-payments.ts', import.meta.url), 'utf8'))
    .replace("import 'server-only';", '')
    .replace("from '@/lib/gifts/contribution'", `from '${contributionUrl}'`)
    .replace("from '@/lib/payments/mercado-pago/client'", `from '${clientUrl}'`)
    .replace("from '@/lib/supabase/server'", `from '${databaseUrl}'`)
    .replace("from '@/services/gift-contributions'", `from '${pendingUrl}'`);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    service: await import(moduleUrl(output)),
    provider: await import(clientUrl),
    database: await import(databaseUrl),
  };
}

test('service never posts an expired attempt, including one with a lost response', async () => {
  const base = {
    id: key(31), contribution_id: key(32), provider_idempotency_key: key(33),
    external_reference: `gift-contribution-${key(32)}`, provider_order_id: null,
    provider_status: 'creating', provider_status_detail: null, amount: 50,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    provider_checked_at: null, pix_qr_code: null, pix_qr_code_base64: null,
    ticket_url: null, can_create: false,
  };
  const unsent = await paymentServiceFixture({ attempt: { ...base,
    order_submission_started_at: null, order_submission_state: 'not_started' } });
  assert.equal((await unsent.service.createGiftPayment({})).payment_status, 'expired');
  assert.deepEqual(unsent.provider.calls, []);
  const uncertain = await paymentServiceFixture({
    attempt: { ...base, order_submission_started_at: new Date(Date.now() - 90_000).toISOString(),
      order_submission_state: 'started' },
  });
  const result = await uncertain.service.getGiftPaymentStatus({ idempotency_key: key(34) });
  assert.equal(result.payment_status, 'pending');
  assert.equal(result.payment.status, 'investigating');
  assert.deepEqual(uncertain.provider.calls, []);
  const legacy = await paymentServiceFixture({ attempt: { ...base,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    order_submission_started_at: null, order_submission_state: 'legacy' } });
  assert.equal((await legacy.service.createGiftPayment({})).payment.status, 'investigating');
  assert.deepEqual(legacy.provider.calls, []);
  const crashedBeforeDeadline = await paymentServiceFixture({ attempt: { ...base,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    order_submission_started_at: new Date().toISOString(), order_submission_state: 'started' } });
  assert.equal((await crashedBeforeDeadline.service.createGiftPayment({})).payment.status, 'investigating');
  assert.deepEqual(crashedBeforeDeadline.provider.calls, []);
});

test('provider timeout, 429 and 503 defer the job without financial reconciliation', async () => {
  for (const providerError of ['timeout', 429, 503]) {
    const attempt = {
      id: key(51), contribution_id: key(52), provider_idempotency_key: key(53),
      external_reference: `gift-contribution-${key(52)}`, provider_order_id: 'ORD-KNOWN',
      provider_status: 'processing', amount: 50,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      provider_checked_at: null, order_submission_started_at: new Date().toISOString(),
    };
    const fixture = await paymentServiceFixture({ attempt, providerError });
    assert.deepEqual(await fixture.service.reconcilePendingGiftPaymentsBatch(),
      { expiredUnsent: 0, selected: 1, reconciled: 0, deferred: 1 });
    assert.ok(!fixture.database.calls.includes('rpc/reconcile_gift_payment_attempt'));
    assert.deepEqual(fixture.provider.calls, ['GET']);
  }
});

test('expired known Order is read and job never creates an Order', async () => {
  const attempt = {
    id: key(41), contribution_id: key(42), provider_idempotency_key: key(43),
    external_reference: `gift-contribution-${key(42)}`,
    provider_order_id: 'ORD-KNOWN', provider_status: 'processing',
    provider_status_detail: 'in_process', amount: 50,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    provider_checked_at: null, order_submission_started_at: new Date(Date.now() - 31 * 60_000).toISOString(),
    pix_qr_code: null, pix_qr_code_base64: null, ticket_url: null, can_create: false,
  };
  const fixture = await paymentServiceFixture({ attempt });
  assert.equal((await fixture.service.createGiftPayment({})).payment_status, 'pending');
  assert.deepEqual(fixture.provider.calls, ['GET']);
  assert.deepEqual(await fixture.service.reconcilePendingGiftPaymentsBatch(),
    { expiredUnsent: 0, selected: 1, reconciled: 1, deferred: 0 });
  assert.deepEqual(fixture.provider.calls, ['GET', 'GET']);
  assert.ok(!fixture.provider.calls.includes('POST'));
});

test('private job route fails closed before executing a batch', async () => {
  const serviceUrl = moduleUrl(`export const calls = []; export async function reconcilePendingGiftPaymentsBatch() {
    calls.push('run'); return { expiredUnsent: 0, selected: 0, reconciled: 0, deferred: 0 }; }`);
  const source = (await readFile(new URL('../src/app/api/internal/reconcile-gift-payments/route.ts', import.meta.url), 'utf8'))
    .replace("from '@/services/gift-payments'", `from '${serviceUrl}'`);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { POST } = await import(moduleUrl(output));
  const { calls } = await import(serviceUrl);
  const old = process.env.PAYMENT_RECONCILIATION_SECRET;
  try {
    delete process.env.PAYMENT_RECONCILIATION_SECRET;
    assert.equal((await POST(new Request('https://example.test', { method: 'POST' }))).status, 401);
    process.env.PAYMENT_RECONCILIATION_SECRET = 'TEST_ONLY_RECONCILIATION_SECRET_123456';
    assert.equal((await POST(new Request('https://example.test', { method: 'POST',
      headers: { authorization: 'Bearer incorrect' },
    }))).status, 401);
    assert.deepEqual(calls, []);
    const ok = await POST(new Request('https://example.test', { method: 'POST',
      headers: { authorization: 'Bearer TEST_ONLY_RECONCILIATION_SECRET_123456' },
    }));
    assert.equal(ok.status, 200);
    assert.deepEqual(calls, ['run']);
  } finally {
    if (old === undefined) delete process.env.PAYMENT_RECONCILIATION_SECRET;
    else process.env.PAYMENT_RECONCILIATION_SECRET = old;
  }
});
