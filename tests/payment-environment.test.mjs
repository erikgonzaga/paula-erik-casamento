import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './database-fixture.mjs';

const migration = new URL('../supabase/migrations/202609270001_payment_environment_isolation.sql', import.meta.url);
const legacyBase = '202609270001_payment_environment_isolation.sql';

async function gift(db, slug) {
  return (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
    values ($1,$1,'party','goal',100) returning id`, [slug])).rows[0].id;
}

async function contribution(db, giftId, environment, amount, status = 'pending') {
  const row = (await db.query(`insert into gift_contributions(
    gift_id,payment_environment,contributor_name,contributor_email,amount,
    payment_method,payment_status,confirmed_at,idempotency_key,request_fingerprint)
    values ($1,$2,'Fixture','fixture@example.invalid',$3,'pix',$4,
      case when $4='confirmed' then now() else null end,gen_random_uuid(),repeat('a',64)) returning id`,
    [giftId, environment, amount, status])).rows[0];
  return row.id;
}

async function claim(db, contributionId, environment) {
  return (await db.query(`select * from claim_gift_payment_attempt_for_environment($1,$2,gen_random_uuid(),30)`,
    [contributionId, environment])).rows[0];
}

async function reconcile(db, attempt, environment, status, detail, orderId) {
  return (await db.query(`select reconcile_gift_payment_attempt_for_environment(
    $1,$2,$3,null,$4,$5,$6,$7,$8,null,null,null) as result`,
    [attempt.id, environment, orderId, status, detail, attempt.amount,
      attempt.external_reference, attempt.expires_at])).rows[0].result;
}

test('environment migration preserves legacy rows and fails closed until classification', async () => {
  const db = await createDatabase({ beforeMigration: legacyBase });
  try {
    const legacyGift = await gift(db, 'legacy-financial-hold');
    const legacyConfirmed = (await db.query(`insert into gift_contributions(
      gift_id,contributor_name,contributor_email,amount,payment_method,
      payment_status,confirmed_at,idempotency_key,request_fingerprint)
      values ($1,'Legacy','legacy@example.invalid',50,'pix','confirmed',now(),gen_random_uuid(),repeat('b',64))
      returning id`, [legacyGift])).rows[0].id;
    const legacyPending = (await db.query(`insert into gift_contributions(
      gift_id,contributor_name,contributor_email,amount,payment_method,
      idempotency_key,request_fingerprint)
      values ($1,'Legacy','legacy@example.invalid',10,'pix',gen_random_uuid(),repeat('c',64))
      returning id`, [legacyGift])).rows[0].id;
    const legacyAttempt = (await db.query(`select * from claim_gift_payment_attempt($1,gen_random_uuid(),30)`,
      [legacyPending])).rows[0];
    await db.exec(await readFile(migration, 'utf8'));

    const historical = (await db.query(`select id,payment_environment,payment_status,amount
      from gift_contributions where id=$1`, [legacyConfirmed])).rows[0];
    assert.equal(historical.payment_environment, null);
    assert.equal(historical.payment_status, 'confirmed');
    assert.equal(Number(historical.amount), 50);
    assert.equal((await db.query('select payment_environment from payment_attempts where id=$1',
      [legacyAttempt.id])).rows[0].payment_environment, null);
    assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1',
      [legacyGift])).rows[0].total_raised), 0);
    await assert.rejects(contribution(db, legacyGift, 'production', 1), /legacy_financial_hold/);
    await assert.rejects(db.query(`insert into payment_attempts(
      contribution_id,payment_environment,provider_idempotency_key,external_reference,amount,expires_at)
      values ($1,'test',gen_random_uuid(),'gift-contribution-legacy-fixture',50,now()+interval '30 minutes')`,
      [legacyConfirmed]), /payment_environment_mismatch/);
    await assert.rejects(claim(db, legacyPending, 'production'), /payment_environment_mismatch/);
    await assert.rejects(db.query(`update gift_contributions set payment_status='failed'
      where id=$1`, [legacyPending]), /legacy_payment_unclassified/);
    await assert.rejects(reconcile(db, legacyAttempt, 'test', 'processed', 'accredited', 'ORD-LEGACY'),
      /payment_environment_mismatch/);
    await assert.rejects(contribution(db, legacyGift, null, 1), /payment_environment_required/);
    for (const signature of [
      'claim_gift_payment_attempt(uuid,uuid,integer)',
      'begin_gift_order_submission(uuid)',
      'expire_gift_contribution_pending(uuid)',
      'claim_due_gift_payment_reconciliation(integer,integer)',
      'reconcile_gift_payment_attempt(uuid,text,text,text,text,numeric,text,timestamptz,text,text,text)',
    ]) {
      const allowed = (await db.query(`select has_function_privilege('service_role',$1,'EXECUTE') as allowed`,
        [`public.${signature}`])).rows[0].allowed;
      assert.equal(allowed, false, signature);
    }
  } finally { await db.close(); }
});

test('TEST money is isolated from production goals, reservations, job and confirmation', async () => {
  const db = await createDatabase();
  try {
    const goal = await gift(db, 'separate-financial-environments');
    const testConfirmed = await contribution(db, goal, 'test', 90, 'confirmed');
    const testPending = await contribution(db, goal, 'test', 10);
    const testAttempt = await claim(db, testPending, 'test');
    assert.equal(testAttempt.payment_environment, 'test');
    assert.equal(await reconcile(db, testAttempt, 'test', 'processing', 'in_process', 'ORDTST01ISOLATED'), 'pending');
    await assert.rejects(reconcile(db, testAttempt, 'production', 'processed', 'accredited', 'ORDTST01ISOLATED'),
      /payment_environment_mismatch/);
    assert.equal(await reconcile(db, testAttempt, 'test', 'processed', 'accredited', 'ORDTST01ISOLATED'), 'confirmed');
    assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1',
      [goal])).rows[0].total_raised), 0);
    assert.equal(Number((await db.query(`select total_raised from get_gift_progress_for_environment('test')
      where gift_id=$1`, [goal])).rows[0].total_raised), 100);
    assert.equal((await db.query(`select goal_reached from get_gift_progress() where gift_id=$1`,
      [goal])).rows[0].goal_reached, false);

    const production = await contribution(db, goal, 'production', 20);
    const productionAttempt = await claim(db, production, 'production');
    assert.equal(productionAttempt.payment_environment, 'production');
    const reused = await claim(db, production, 'production');
    assert.equal(reused.id, productionAttempt.id);
    assert.equal(reused.provider_idempotency_key, productionAttempt.provider_idempotency_key);
    await assert.rejects(db.query(`update payment_attempts set payment_environment='test' where id=$1`,
      [productionAttempt.id]), /payment_environment_immutable/);
    await assert.rejects(reconcile(db, productionAttempt, 'test', 'processed', 'accredited', 'ORDPROD01ISOLATED'),
      /payment_environment_mismatch/);
    assert.equal(await reconcile(db, productionAttempt, 'production', 'processing', 'in_process', 'ORDPROD01ISOLATED'), 'pending');
    assert.equal((await db.query('select payment_status from gift_contributions where id=$1',
      [production])).rows[0].payment_status, 'pending');
    assert.equal(await reconcile(db, productionAttempt, 'production', 'processed', 'accredited', 'ORDPROD01ISOLATED'), 'confirmed');
    assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1',
      [goal])).rows[0].total_raised), 20);
    assert.equal((await db.query('select payment_environment from gift_contributions where id=$1',
      [testConfirmed])).rows[0].payment_environment, 'test');
    await assert.rejects(db.query(`update gift_contributions set payment_environment='production' where id=$1`,
      [testConfirmed]), /payment_environment_immutable/);

    await assert.rejects(contribution(db, goal, 'test', 5), /gift_goal_reached/);
    const dueGift = await gift(db, 'test-order-not-for-production-job');
    const dueContribution = await contribution(db, dueGift, 'test', 5);
    const dueAttempt = await claim(db, dueContribution, 'test');
    await reconcile(db, dueAttempt, 'test', 'processing', 'in_process', 'ORDTST01DUE');
    await db.query(`update payment_attempts set provider_checked_at=now()-interval '10 minutes'
      where id=$1`, [dueAttempt.id]);
    assert.equal((await db.query(`select count(*)::int as n from
      claim_due_gift_payment_reconciliation_for_environment('production',10,120)`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from
      claim_due_gift_payment_reconciliation_for_environment('test',10,120)`)).rows[0].n, 1);
    await db.query(`insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001')`);
    await db.query(`insert into admin_users(user_id) values ('90000000-0000-4000-8000-000000000001')`);
    const admin = (await db.query(`select get_admin_dashboard('90000000-0000-4000-8000-000000000001') as data`)).rows[0].data;
    assert.equal(Number(admin.contributions.total), 20);
    assert.equal(admin.contributions.confirmed, 1);

    const unique = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount,allow_multiple)
      values ('One contribution per environment','unique-env','party','goal',100,false) returning id`)).rows[0].id;
    await contribution(db, unique, 'test', 50, 'confirmed');
    const uniqueProd = await contribution(db, unique, 'production', 10);
    assert.equal((await claim(db, uniqueProd, 'production')).payment_environment, 'production');

    const overfundedGift = await gift(db, 'production-late-pix');
    const first = await claim(db, await contribution(db, overfundedGift, 'production', 90), 'production');
    const second = await claim(db, await contribution(db, overfundedGift, 'production', 20), 'production');
    assert.equal(await reconcile(db, first, 'production', 'processed', 'accredited', 'ORDPROD01FIRST'), 'confirmed');
    assert.equal(await reconcile(db, second, 'production', 'processed', 'accredited', 'ORDPROD01SECOND'), 'confirmed');
    assert.equal(Number((await db.query('select total_raised from get_gift_progress() where gift_id=$1',
      [overfundedGift])).rows[0].total_raised), 110);
    await assert.rejects(contribution(db, overfundedGift, 'production', 1), /gift_goal_reached/);
  } finally { await db.close(); }
});
