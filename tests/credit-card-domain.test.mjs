import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';
import { createDatabase } from './database-fixture.mjs';

const migrationName = '202610070003_credit_card_domain.sql';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const migrationSql = await readFile(new URL(migrationName, migrations), 'utf8');
const contractSource = await readFile(new URL('../src/lib/payments/contracts.ts', import.meta.url), 'utf8');
const contractOutput = ts.transpileModule(contractSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { validatePaymentAttemptMethod } = await import(
  `data:text/javascript;base64,${Buffer.from(contractOutput).toString('base64')}`
);

async function gift(db, slug, mode = 'open') {
  return (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
    values ($1,$1,'party',$2,case when $2='goal' then 100 when $2='fixed' then 75 else null end) returning id`,
    [slug, mode])).rows[0].id;
}

async function contribution(db, giftId, method = 'credit_card', environment = 'production', amount = 50) {
  return (await db.query(`insert into gift_contributions(gift_id,payment_method,payment_environment,
    contributor_name,contributor_email,amount,idempotency_key,request_fingerprint)
    values ($1,$2,$3,'Fixture','fixture@example.invalid',$4,gen_random_uuid(),repeat('a',64)) returning *`,
    [giftId, method, environment, amount])).rows[0];
}

async function attempt(db, row, installments = 1, methodId = 'visa', method = row.payment_method) {
  return (await db.query(`insert into payment_attempts(contribution_id,payment_environment,
    provider_idempotency_key,external_reference,amount,expires_at,payment_method,
    installments,provider_payment_method_id,creation_lease_until)
    values ($1,$2,gen_random_uuid(),$3,$4,$5,$6,$7,$8,now()+interval '30 seconds') returning *`,
    [row.id, row.payment_environment, `gift-contribution-${row.id}`, row.amount, row.expires_at,
      method, installments, methodId])).rows[0];
}

async function reconcile(db, row, status = 'processed', detail = 'accredited', environment = row.payment_environment) {
  return (await db.query(`select reconcile_gift_payment_attempt_for_environment(
    $1,$2,$3,null,$4,$5,$6,$7,$8,null,null,null) as result`,
    [row.id, environment, `ORD-FIXTURE-${row.id}`, status, detail, row.amount,
      row.external_reference, row.expires_at])).rows[0].result;
}

test('domain accepts only persistable method metadata and integer installments 1..12', () => {
  for (let installments = 1; installments <= 12; installments++) {
    const card = { payment_method: 'credit_card', installments, provider_payment_method_id: 'visa' };
    assert.deepEqual(validatePaymentAttemptMethod(card), card);
  }
  for (const card of [
    { payment_method: 'pix', installments: null, provider_payment_method_id: 'pix' },
    { payment_method: 'external', installments: null, provider_payment_method_id: null },
  ]) assert.deepEqual(validatePaymentAttemptMethod(card), card);
  const valid = { payment_method: 'credit_card', installments: 1, provider_payment_method_id: 'visa' };
  for (const methodId of ['master', 'brand-v2.0', 'VISA', 'Cartão', 'a'.repeat(64), '🎴'.repeat(64)]) {
    const card = { ...valid, provider_payment_method_id: methodId };
    assert.deepEqual(validatePaymentAttemptMethod(card), card);
  }
  for (const methodId of ['', ' ', ' master', 'master ', 'brand\u0001', 'brand\u007f', 'brand\tname', 'brand\nname', 'a'.repeat(65), '🎴'.repeat(65)]) {
    assert.throws(() => validatePaymentAttemptMethod({ ...valid, provider_payment_method_id: methodId }), /invalid_payment_attempt_method/);
  }
  for (const installments of [null, undefined, 0, 13, 1.5, NaN, Infinity, '1']) {
    assert.throws(() => validatePaymentAttemptMethod({ ...valid, installments }), /invalid_payment_attempt_method/);
  }
  for (const input of [
    null, [], { ...valid, payment_method: 'debit_card' }, { ...valid, provider_payment_method_id: 'pix' },
    { ...valid, provider_payment_method_id: null }, { ...valid, provider_payment_method_id: ' VISA ' },
    { payment_method: 'pix', installments: 1, provider_payment_method_id: 'pix' },
    { payment_method: 'external', installments: 1, provider_payment_method_id: null },
    ...['pan', 'cvv', 'expiration_month', 'expiration_year', 'card_token', 'token'].map(key => ({ ...valid, [key]: 'fixture' })),
  ]) assert.throws(() => validatePaymentAttemptMethod(input), /invalid_payment_attempt_method/);
});

test('incremental migration preserves every historical Pix field and legacy environment', async () => {
  const base = '202609270001_payment_environment_isolation.sql';
  const db = await createDatabase({ beforeMigration: base });
  try {
    const giftId = await gift(db, 'historical-pix-contract');
    for (const status of ['pending', 'confirmed', 'failed', 'expired', 'cancelled']) {
      const row = (await db.query(`insert into gift_contributions(gift_id,payment_method,
        contributor_name,amount,idempotency_key,request_fingerprint)
        values ($1,'pix','Fixture',50,gen_random_uuid(),repeat('b',64)) returning *`, [giftId])).rows[0];
      const claimed = (await db.query('select * from claim_gift_payment_attempt($1,gen_random_uuid(),30)', [row.id])).rows[0];
      if (status === 'confirmed') {
        await db.query(`select reconcile_gift_payment_attempt(
          $1,$2,null,'processed','accredited',50,$3,$4,null,null,null)`,
          [claimed.id, `ORD-HISTORY-${claimed.id}`, claimed.external_reference, claimed.expires_at]);
      } else if (status !== 'pending') {
        await db.query('update gift_contributions set payment_status=$2 where id=$1', [row.id, status]);
        await db.query('update payment_attempts set provider_status=$2 where id=$1', [claimed.id, status]);
      }
    }
    for (const filename of (await readdir(migrations)).filter(file => file.endsWith('.sql') && file >= base && file < migrationName).sort()) {
      await db.exec(await readFile(new URL(filename, migrations), 'utf8'));
    }
    const contributionsBefore = (await db.query('select * from gift_contributions order by id')).rows;
    const attemptsBefore = (await db.query('select * from payment_attempts order by id')).rows;
    const rpcsBefore = (await db.query(`select oid::text,pg_get_functiondef(oid) as definition from pg_proc
      where pronamespace='public'::regnamespace and proname in (
        'claim_gift_payment_attempt_for_environment','begin_gift_order_submission_for_environment',
        'reconcile_gift_payment_attempt_for_environment') order by oid`)).rows;
    await db.exec(migrationSql);
    assert.deepEqual((await db.query('select * from gift_contributions order by id')).rows, contributionsBefore);
    const attemptsAfter = (await db.query('select * from payment_attempts order by id')).rows;
    assert.equal(attemptsAfter.length, 5);
    assert.deepEqual(attemptsAfter.map(({ payment_method, installments, provider_payment_method_id, ...row }) => {
      assert.equal(payment_method, 'pix');
      assert.equal(installments, null);
      assert.equal(provider_payment_method_id, 'pix');
      assert.equal(row.payment_environment, null);
      return row;
    }), attemptsBefore);
    assert.deepEqual((await db.query(`select oid::text,pg_get_functiondef(oid) as definition from pg_proc
      where pronamespace='public'::regnamespace and proname in (
        'claim_gift_payment_attempt_for_environment','begin_gift_order_submission_for_environment',
        'reconcile_gift_payment_attempt_for_environment') order by oid`)).rows, rpcsBefore);
    assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [giftId])).rows[0].total_raised), 0);
    await assert.rejects(db.exec(migrationSql), /credit_card_domain_already_applied_or_partial/);
    await db.exec('rollback');
    assert.deepEqual((await db.query('select * from payment_attempts order by id')).rows, attemptsAfter);
  } finally { await db.close(); }
});

test('credit card database contract, existing RPCs and private adjustments', async t => {
  const db = await createDatabase();
  try {
    const giftId = await gift(db, 'card-contract');
    await t.test('card requires integer installments: 1 and 12 valid; NULL, 0, 13 and fractions rejected', async () => {
      for (const installments of [1, 12]) {
        const row = await contribution(db, giftId);
        assert.equal(Number((await attempt(db, row, installments)).installments), installments);
      }
      for (const installments of [null, 0, 13, 1.5]) {
        const row = await contribution(db, giftId);
        await assert.rejects(attempt(db, row, installments), /payment_attempt_method_metadata_valid/);
      }
      for (const methodId of [null, 'pix']) {
        await assert.rejects(attempt(db, await contribution(db, giftId), 1, methodId), /payment_attempt_method_(metadata_valid|id_valid)/);
      }
      const penny = await contribution(db, giftId, 'credit_card', 'production', 0.01);
      assert.equal(Number((await attempt(db, penny)).amount), 0.01);
      const fixedGift = await gift(db, 'card-fixed-contract', 'fixed');
      const fixed = await contribution(db, fixedGift, 'credit_card', 'production', 75);
      assert.equal(Number((await attempt(db, fixed, 12)).amount), 75);
      await assert.rejects(contribution(db, fixedGift, 'credit_card', 'production', 50), /fixed_amount_required/);
    });

    await t.test('provider method identifier has structural validation without an arbitrary alphabet', async () => {
      for (const methodId of ['master', 'brand-v2.0', 'VISA', 'Cartão', 'a'.repeat(64), '🎴'.repeat(64)]) {
        assert.equal((await attempt(db, await contribution(db, giftId), 1, methodId)).provider_payment_method_id, methodId);
      }
      for (const methodId of ['', ' ', ' master', 'master ', 'brand\u0001', 'brand\u007f', 'brand\tname', 'brand\nname', 'a'.repeat(65), '🎴'.repeat(65)]) {
        await assert.rejects(attempt(db, await contribution(db, giftId), 1, methodId), /payment_attempt_method_id_valid/);
      }
    });

    await t.test('invalid methods, Pix/external installments and method mismatch rejected', async () => {
      await assert.rejects(contribution(db, giftId, 'debit_card'), /gift_contributions_payment_method_check/);
      const pix = await contribution(db, giftId, 'pix');
      await assert.rejects(attempt(db, pix, 1, 'pix'), /payment_attempt_method_metadata_valid/);
      await assert.rejects(attempt(db, pix, 1, 'visa', 'credit_card'), /payment_attempt_method_mismatch/);
      const external = await contribution(db, giftId, 'external');
      await assert.rejects(attempt(db, external, 1, null), /payment_attempt_method_metadata_valid/);
      assert.equal((await attempt(db, external, null, null)).payment_method, 'external');
      const card = await contribution(db, giftId);
      await assert.rejects(db.query(`select * from claim_gift_payment_attempt_for_environment(
        $1,'production',gen_random_uuid(),30)`, [card.id]), /payment_attempt_method_mismatch/);
      assert.equal((await db.query('select count(*)::int as n from payment_attempts where contribution_id=$1', [card.id])).rows[0].n, 0);
    });

    await t.test('method, installments, brand and idempotency immutable; UNIQUE contribution retained', async () => {
      const row = await contribution(db, giftId);
      const card = await attempt(db, row, 12);
      for (const [field, value] of [['payment_method', 'pix'], ['installments', 1], ['provider_payment_method_id', 'master']]) {
        await assert.rejects(db.query(`update payment_attempts set ${field}=$2 where id=$1`, [card.id, value]), /payment_attempt_method_immutable/);
      }
      await assert.rejects(db.query("update gift_contributions set payment_method='pix' where id=$1", [row.id]), /contribution_payment_method_immutable/);
      await assert.rejects(db.query('update payment_attempts set provider_idempotency_key=gen_random_uuid() where id=$1', [card.id]), /payment_attempt_identity_immutable/);
      await assert.rejects(attempt(db, row, 12), /payment_attempts_contribution_id_key/);
      await reconcile(db, card, 'failed', 'rejected');
      await assert.rejects(attempt(db, row, 12), /payment_attempts_contribution_id_key/);
      await assert.rejects(db.query(`select * from claim_gift_payment_attempt_for_environment(
        $1,'production',gen_random_uuid(),30)`, [row.id]), /contribution_not_payable/);
      assert.equal((await db.query('select count(*)::int as n from payment_attempts where contribution_id=$1', [row.id])).rows[0].n, 1);
    });

    await t.test('unchanged Pix claim/submission/reconciliation preserves retry and financial rules', async () => {
      const row = await contribution(db, giftId, 'pix');
      const claim = () => db.query('select * from claim_gift_payment_attempt_for_environment($1,$2,gen_random_uuid(),30)', [row.id, 'production']);
      const first = (await claim()).rows[0];
      const second = (await claim()).rows[0];
      assert.equal(first.id, second.id);
      assert.equal(first.provider_idempotency_key, second.provider_idempotency_key);
      const persisted = (await db.query('select * from payment_attempts where id=$1', [first.id])).rows[0];
      assert.equal(persisted.payment_method, 'pix');
      assert.equal(persisted.installments, null);
      assert.equal(persisted.provider_payment_method_id, 'pix');
      assert.equal((await db.query('select begin_gift_order_submission_for_environment($1,$2) as allowed', [first.id, 'production'])).rows[0].allowed, true);
      assert.equal((await db.query('select begin_gift_order_submission_for_environment($1,$2) as allowed', [first.id, 'production'])).rows[0].allowed, false);
      assert.equal(await reconcile(db, persisted, 'processing', 'in_process'), 'pending');
      assert.equal(await reconcile(db, persisted), 'confirmed');
    });

    await t.test('card confirmation/progress preserves TEST/PRODUCTION and processed/accredited authority', async () => {
      const goal = await gift(db, 'card-environments', 'goal');
      const testCard = await attempt(db, await contribution(db, goal, 'credit_card', 'test', 100));
      await assert.rejects(reconcile(db, testCard, 'processed', 'accredited', 'production'), /payment_environment_mismatch/);
      assert.equal(await reconcile(db, testCard), 'confirmed');
      assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [goal])).rows[0].total_raised), 0);
      const productionCard = await attempt(db, await contribution(db, goal, 'credit_card', 'production', 25), 12);
      assert.equal((await db.query('select begin_gift_order_submission_for_environment($1,$2) as allowed', [productionCard.id, 'production'])).rows[0].allowed, true);
      await assert.rejects(reconcile(db, productionCard, 'processed', 'accredited', 'test'), /payment_environment_mismatch/);
      for (const [status, detail] of [['processing', 'in_process'], ['processed', 'pending']]) {
        assert.equal(await reconcile(db, productionCard, status, detail), 'pending');
        assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [goal])).rows[0].total_raised), 0);
      }
      assert.equal(await reconcile(db, productionCard), 'confirmed');
      assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1', [goal])).rows[0].total_raised), 25);
      assert.equal(await reconcile(db, productionCard, 'failed', 'rejected'), 'confirmed');
      await assert.rejects(db.query("update payment_attempts set payment_environment='test' where id=$1", [productionCard.id]), /payment_environment_immutable/);
    });

    await t.test('adjustments private, environment-bound, append-only and idempotent; originals preserved', async () => {
      const row = await contribution(db, giftId);
      const card = await attempt(db, row);
      await reconcile(db, card);
      const before = (await db.query('select * from gift_contributions where id=$1', [row.id])).rows[0];
      const insert = (reference, environment = 'production', kind = 'refund') => db.query(`insert into payment_financial_adjustments(
        attempt_id,payment_environment,external_reference,kind,amount,occurred_at)
        values ($1,$2,$3,$4,50,'2026-10-07T12:00:00Z') on conflict (provider,external_reference) do nothing returning id`,
        [card.id, environment, reference, kind]);
      await assert.rejects(insert('wrong-env', 'test'), /payment_environment_mismatch/);
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query('select * from payment_financial_adjustments'), /permission denied/);
          await assert.rejects(insert(`denied-${role}`), /permission denied/);
        } finally { await db.exec('reset role'); }
      }
      await db.exec('set role service_role');
      try {
        assert.equal((await insert('refund-fixture')).rows.length, 1);
        assert.equal((await insert('refund-fixture')).rows.length, 0);
        assert.equal((await insert('chargeback-fixture', 'production', 'chargeback')).rows.length, 1);
        assert.equal((await insert('reversal-fixture', 'production', 'chargeback_reversal')).rows.length, 1);
        assert.equal((await db.query('select count(*)::int as n from payment_financial_adjustments where attempt_id=$1', [card.id])).rows[0].n, 3);
        await assert.rejects(db.query('update payment_financial_adjustments set amount=1 where attempt_id=$1', [card.id]), /permission denied/);
        await assert.rejects(db.query('delete from payment_financial_adjustments where attempt_id=$1', [card.id]), /permission denied/);
      } finally { await db.exec('reset role'); }
      await assert.rejects(db.query('update payment_financial_adjustments set amount=1 where attempt_id=$1', [card.id]), /financial_adjustment_append_only/);
      await assert.rejects(db.query('delete from payment_financial_adjustments where attempt_id=$1', [card.id]), /financial_adjustment_append_only/);
      await assert.rejects(insert('invalid-kind', 'production', 'void'), /check constraint/);
      await assert.rejects(db.query(`insert into payment_financial_adjustments(attempt_id,payment_environment,
        external_reference,kind,amount,occurred_at) values ($1,'production','zero','refund',0,now())`, [card.id]), /check constraint/);
      assert.deepEqual((await db.query('select * from gift_contributions where id=$1', [row.id])).rows[0], before);
      const schema = (await db.query(`select column_name from information_schema.columns where table_schema='public'
        and table_name in ('gift_contributions','payment_attempts','payment_financial_adjustments')`)).rows.map(row => row.column_name);
      assert.ok(!schema.some(column => /(^pan$|cvv|card_number|expir(ation|y)_(month|year)|card_token|^token$)/i.test(column)));
      assert.equal((await db.query(`select relrowsecurity from pg_class where oid='payment_financial_adjustments'::regclass`)).rows[0].relrowsecurity, true);
    });
  } finally { await db.close(); }
});
