import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDatabase } from './database-fixture.mjs';

test('Gifts constraints and public read-only RLS', async () => {
  const db = await createDatabase();

  try {
    await db.query(
      `insert into gifts(name,slug,category,target_amount,gift_type,display_order,active,funding_mode)
       values
        ('Presente de festa','presente-festa','party',50,'regular',5,true,'goal'),
        ('Presente ativo','presente-ativo','house',100,'regular',20,true,'goal'),
        ('Presente inativo','presente-inativo','travel',200,'regular',10,false,'goal'),
        ('Moeda teste','moeda-teste','insanos',300,'insanos',30,true,'fixed')`,
    );

    await assert.rejects(
      db.query("insert into gifts(name,slug,category,target_amount,gift_type) values ('Inválido','preco-invalido','house',0,'regular')"),
    );
    await assert.rejects(
      db.query("insert into gifts(name,slug,category,target_amount,gift_type) values ('Inválido','categoria-invalida','other',10,'regular')"),
    );
    await assert.rejects(
      db.query("insert into gifts(name,slug,category,target_amount,gift_type) values ('Inválido','categoria-antiga','clothing',10,'regular')"),
    );
    await assert.rejects(
      db.query("insert into gifts(name,slug,category,target_amount,gift_type) values ('Inválido','tipo-incompativel','insanos',10,'regular')"),
    );

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      const visible = await db.query('select slug from gifts order by display_order,id');
      assert.deepEqual(visible.rows.map((gift) => gift.slug), ['presente-festa', 'presente-ativo', 'moeda-teste']);
      await assert.rejects(db.query("insert into gifts(name,slug,category,target_amount) values ('Novo','novo','house',10)"));
      await assert.rejects(db.query("update gifts set name='Alterado' where slug='presente-ativo'"));
      await assert.rejects(db.query("delete from gifts where slug='presente-ativo'"));
      await db.exec('reset role');
    }

    await db.exec('set role service_role');
    assert.equal((await db.query('select count(*)::int as count from gifts')).rows[0].count, 4);
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('Development gift seed stays separate and preserves the approved catalog split', async () => {
  const db = await createDatabase();

  try {
    const seed = await readFile(new URL('../supabase/seeds/gifts-development.sql', import.meta.url), 'utf8');
    await db.exec(seed);
    const counts = await db.query(
      `select gift_type, count(*)::int as count
       from gifts
       group by gift_type
       order by gift_type`,
    );
    assert.deepEqual(counts.rows, [
      { gift_type: 'insanos', count: 3 },
      { gift_type: 'regular', count: 9 },
    ]);
  } finally {
    await db.close();
  }
});

test('Funding modes, private contributions and confirmed-only public progress', async () => {
  const db = await createDatabase();
  try {
    const addGift = async (slug, mode, target, type = 'regular', multiple = true) => {
      const result = await db.query(
        `insert into gifts(name,slug,category,funding_mode,target_amount,gift_type,allow_multiple)
         values ($1,$1,$2,$3,$4,$5,$6) returning id`,
        [slug, type === 'insanos' ? 'insanos' : 'party', mode, target, type, multiple],
      );
      return result.rows[0].id;
    };
    const goal = await addGift('goal', 'goal', 100);
    const open = await addGift('open', 'open', null);
    const fixed = await addGift('fixed', 'fixed', 25, 'insanos');
    const unique = await addGift('unique', 'fixed', 10, 'regular', false);
    for (const [mode, target] of [['goal', null], ['goal', 0], ['fixed', null], ['open', 10], ['other', 10], ['goal', 'NaN']]) {
      await assert.rejects(addGift('invalid', mode, target));
    }
    await assert.rejects(addGift('invalid', 'goal', 10, 'insanos'));
    await assert.rejects(addGift('invalid', 'fixed', 10, 'insanos', false));

    const contribute = async (gift, amount, status = 'pending', vest = null, date = status === 'confirmed' ? new Date().toISOString() : null) => {
      const result = await db.query(
        `insert into gift_contributions(gift_id,contributor_name,amount,payment_status,payment_method,vest_name,confirmed_at,
          idempotency_key,request_fingerprint)
         values ($1,'Pessoa de teste',$2,$3,'pix',$4,$5,gen_random_uuid(),repeat('a',64)) returning id`,
        [gift, amount, status, vest, date],
      );
      return result.rows[0].id;
    };
    await db.exec('set role service_role');
    for (const amount of [0, -1, 'NaN']) await assert.rejects(contribute(goal, amount));
    await assert.rejects(contribute(goal, 10, 'confirmed', null, null));
    await assert.rejects(contribute(goal, 10, 'pending', null, new Date().toISOString()));
    await assert.rejects(contribute(goal, 10, 'unknown'));
    await contribute(goal, 20, 'confirmed');
    await assert.rejects(contribute(goal, 80.01), /gift_goal_exceeded/);
    await assert.rejects(contribute(goal, 80.01, 'confirmed'), /gift_goal_exceeded/);
    const pending = await contribute(goal, 80);
    const competing = await contribute(goal, 80);
    await contribute(goal, 30, 'cancelled');
    await contribute(goal, 40, 'failed');
    await contribute(open, 500, 'confirmed');
    await assert.rejects(contribute(fixed, 25, 'confirmed'));
    await assert.rejects(contribute(fixed, 25), /vest_name_required/);
    await assert.rejects(contribute(fixed, 25, 'confirmed', '   '), /vest_name_required/);
    await assert.rejects(contribute(fixed, 24, 'confirmed', 'Colete'));
    await assert.rejects(contribute(fixed, 26, 'confirmed', 'Colete'), /fixed_amount_required/);
    await contribute(fixed, 25, 'confirmed', 'Colete A');
    await contribute(fixed, 25, 'confirmed', 'Colete B');
    await contribute(unique, 10, 'confirmed');
    await assert.rejects(contribute(unique, 10));
    await db.exec('reset role');

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from gift_contributions'));
      await assert.rejects(contribute(open, 10));
      await assert.rejects(db.query("update gift_contributions set message='alterado'"));
      await assert.rejects(db.query('delete from gift_contributions'));
      const result = await db.query('select * from get_gift_progress() where gift_id=$1', [goal]);
      assert.deepEqual(Object.keys(result.rows[0]).sort(), ['gift_id','goal_reached','percentage','remaining_amount','target_amount','total_raised'].sort());
      assert.equal(Number(result.rows[0].total_raised), 20);
      assert.equal(Number(result.rows[0].percentage), 20);
      assert.equal(Number(result.rows[0].remaining_amount), 80);
      assert.equal(result.rows[0].goal_reached, false);
      const unlimited = await db.query('select * from get_gift_progress() where gift_id in ($1,$2)', [open, fixed]);
      for (const progress of unlimited.rows) {
        assert.equal(progress.percentage, null);
        assert.equal(progress.remaining_amount, null);
        assert.equal(progress.goal_reached, false);
      }
      assert.equal(Number(unlimited.rows.find(row => row.gift_id === fixed).total_raised), 50);
      assert.equal(unlimited.rows.find(row => row.gift_id === open).target_amount, null);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.query("update gift_contributions set payment_status='confirmed',confirmed_at=now() where id=$1", [pending]);
    await assert.rejects(db.query("update gift_contributions set payment_status='confirmed',confirmed_at=now() where id=$1", [competing]));
    await assert.rejects(contribute(goal, 1));
    const reached = (await db.query('select * from get_gift_progress() where gift_id=$1', [goal])).rows[0];
    assert.equal(reached.goal_reached, true);
    assert.equal(Number(reached.total_raised), 100);
    assert.equal(Number(reached.remaining_amount), 0);
    await db.query('update gifts set active=false where id=$1', [goal]);
    assert.equal((await db.query('select * from get_gift_progress() where gift_id=$1', [goal])).rows.length, 0);
    await assert.rejects(contribute(goal, 1));
    await db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      assert.equal((await db.query('select * from get_gift_progress() where gift_id=$1', [goal])).rows.length, 0);
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('External references are optional, globally unique and private', async () => {
  const db = await createDatabase();
  try {
    const gifts = await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Teste A','external-a','house','open',null),
             ('Teste B','external-b','travel','open',null) returning id`);
    const [first, second] = gifts.rows.map(row => row.id);
    const insert = (reference, gift = first) => db.query(
      `insert into gift_contributions(gift_id,contributor_name,amount,payment_method,external_reference,
        idempotency_key,request_fingerprint)
       values ($1,'Pessoa teste',10,'external',$2,gen_random_uuid(),repeat('b',64)) returning id`, [gift, reference],
    );
    await db.exec('set role service_role');
    await insert('provider:test-payment-1');
    await assert.rejects(insert('provider:test-payment-1', second), { code: '23505' });
    const nullable = await insert(null);
    await insert(null);
    assert.equal((await db.query('select count(*)::int as count from gift_contributions where external_reference is null')).rows[0].count, 2);
    await assert.rejects(db.query('update gift_contributions set external_reference=$1 where id=$2',
      ['provider:test-payment-1', nullable.rows[0].id]), { code: '23505' });
    for (const reference of ['', ' ', ' padded', 'padded ', 'line\nbreak', 'tab\tref', 'x'.repeat(256)]) {
      await assert.rejects(insert(reference), { code: '23514' });
    }
    await insert('x'.repeat(255));
    await insert('provider:TEST-payment-1'); // Opaque references remain case-sensitive.
    await db.exec('reset role');
    const functionConfig = (await db.query(`select prosecdef,provolatile,proconfig
      from pg_proc where oid='public.get_gift_progress()'::regprocedure`)).rows[0];
    assert.equal(functionConfig.prosecdef, true);
    assert.equal(functionConfig.provolatile, 's');
    assert.ok(functionConfig.proconfig.includes('search_path=""'));
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select external_reference from gift_contributions'), { code: '42501' });
      const progress = await db.query('select * from public.get_gift_progress()');
      for (const row of progress.rows) {
        assert.deepEqual(Object.keys(row).sort(), ['gift_id','target_amount','total_raised','percentage','remaining_amount','goal_reached'].sort());
        assert.equal(Number(row.total_raised), 0); // All contributions are pending.
      }
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('Persistent idempotency and pending expiration remain private and out of progress', async () => {
  const db = await createDatabase();
  try {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Meta expiração','meta-expiracao','house','goal',500) returning id`)).rows[0].id;
    const pendingKey = '20000000-0000-4000-8000-000000000001';
    const expiredKey = '20000000-0000-4000-8000-000000000002';
    const confirmedKey = '20000000-0000-4000-8000-000000000003';
    await db.exec('set role service_role');
    const pending = await db.query(`insert into gift_contributions(
        gift_id,contributor_name,amount,payment_method,idempotency_key,request_fingerprint)
      values ($1,'Pending recente',50,'pix',$2,repeat('c',64))
      returning id,created_at,expires_at,payment_status`, [gift, pendingKey]);
    const lifetime = (new Date(pending.rows[0].expires_at) - new Date(pending.rows[0].created_at)) / 1000;
    assert.equal(lifetime, 15 * 60);
    assert.equal(pending.rows[0].payment_status, 'pending');
    await assert.rejects(db.query(`insert into gift_contributions(
      gift_id,contributor_name,amount,payment_method,idempotency_key,request_fingerprint)
      values ($1,'Duplicada',50,'pix',$2,repeat('c',64))`, [gift, pendingKey]), { code: '23505' });
    assert.equal((await db.query(
      `select count(*)::int as count from gift_contributions where idempotency_key=$1`,
      [pendingKey],
    )).rows[0].count, 1);

    await db.query(`insert into gift_contributions(
        gift_id,contributor_name,amount,payment_method,idempotency_key,request_fingerprint,created_at,expires_at)
      values ($1,'Pending vencida',60,'pix',$2,repeat('d',64),now()-interval '16 minutes',now()-interval '1 minute')`,
    [gift, expiredKey]);
    assert.equal((await db.query(`select payment_status from gift_contributions where idempotency_key=$1`, [expiredKey])).rows[0].payment_status, 'pending');
    assert.equal((await db.query(`select expire_gift_contribution_pending($1) as count`, [pendingKey])).rows[0].count, 0);
    assert.equal((await db.query(`select payment_status from gift_contributions where idempotency_key=$1`, [pendingKey])).rows[0].payment_status, 'pending');
    assert.equal((await db.query(`select expire_gift_contribution_pending($1) as count`, [expiredKey])).rows[0].count, 1);
    assert.equal((await db.query(`select payment_status from gift_contributions where idempotency_key=$1`, [expiredKey])).rows[0].payment_status, 'expired');

    await db.query(`insert into gift_contributions(
        gift_id,contributor_name,amount,payment_method,payment_status,confirmed_at,idempotency_key,request_fingerprint)
      values ($1,'Confirmada',75,'pix','confirmed',now(),$2,repeat('e',64))`, [gift, confirmedKey]);
    const progress = (await db.query('select * from get_gift_progress() where gift_id=$1', [gift])).rows[0];
    assert.equal(Number(progress.total_raised), 75);
    await assert.rejects(db.query(`update gift_contributions set request_fingerprint=repeat('f',64) where idempotency_key=$1`, [pendingKey]),
      /contribution_attempt_metadata_immutable/);
    await db.exec('reset role');

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select idempotency_key,request_fingerprint from gift_contributions'), { code: '42501' });
      await assert.rejects(db.query(`select expire_gift_contribution_pending($1)`, [expiredKey]), { code: '42501' });
      const publicProgress = (await db.query('select * from get_gift_progress() where gift_id=$1', [gift])).rows[0];
      assert.equal(Number(publicProgress.total_raised), 75);
      assert.deepEqual(Object.keys(publicProgress).sort(), ['gift_id','target_amount','total_raised','percentage','remaining_amount','goal_reached'].sort());
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

test('Expiration accepts the contribution id and changes only overdue pending rows', async () => {
  const db = await createDatabase();
  try {
    const gift = (await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount)
      values ('Meta rotina expiração','meta-rotina-expiracao','house','goal',500) returning id`)).rows[0].id;
    await db.exec('set role service_role');

    async function insertContribution(label, status, ageMinutes, confirmed = false) {
      return (await db.query(`insert into gift_contributions(
          gift_id,contributor_name,amount,payment_method,payment_status,confirmed_at,
          idempotency_key,request_fingerprint,created_at,expires_at)
        values ($1,$2,10,'pix',$3,$4,gen_random_uuid(),
          md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
          now() - make_interval(mins => $5),
          now() - make_interval(mins => $5) + interval '15 minutes')
        returning id,idempotency_key,payment_status,created_at,expires_at`,
      [gift, label, status, confirmed ? new Date().toISOString() : null, ageMinutes])).rows[0];
    }

    const recent = await insertContribution('Pending recente', 'pending', 10);
    const overdue = await insertContribution('Pending vencida', 'pending', 16);
    const expired = await insertContribution('Já expirada', 'expired', 16);
    const confirmed = await insertContribution('Confirmada', 'confirmed', 16, true);
    const cancelled = await insertContribution('Cancelada', 'cancelled', 16);
    const failed = await insertContribution('Falhou', 'failed', 16);

    assert.notEqual(overdue.id, overdue.idempotency_key);
    assert.equal(new Date(overdue.expires_at) - new Date(overdue.created_at), 15 * 60 * 1000);
    assert.ok(Date.now() > new Date(overdue.expires_at).getTime());

    async function expireByContributionId(contribution) {
      return (await db.query(
        `select public.expire_gift_contribution_pending($1) as count`,
        [contribution.id],
      )).rows[0].count;
    }

    assert.equal(await expireByContributionId(recent), 0);
    assert.equal(await expireByContributionId(overdue), 1);
    assert.equal(await expireByContributionId(overdue), 0);
    assert.equal(await expireByContributionId(expired), 0);
    assert.equal(await expireByContributionId(confirmed), 0);
    assert.equal(await expireByContributionId(cancelled), 0);
    assert.equal(await expireByContributionId(failed), 0);

    const statuses = await db.query(`select contributor_name,payment_status
      from gift_contributions where gift_id=$1`, [gift]);
    assert.deepEqual(Object.fromEntries(statuses.rows.map(row => [row.contributor_name, row.payment_status])), {
      'Pending recente': 'pending',
      'Pending vencida': 'expired',
      'Já expirada': 'expired',
      Confirmada: 'confirmed',
      Cancelada: 'cancelled',
      Falhou: 'failed',
    });
  } finally {
    await db.close();
  }
});
