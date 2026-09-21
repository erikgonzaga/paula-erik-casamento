import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './database-fixture.mjs';
import { seedAdmin, adminId, nonadminId } from './admin-fixture.mjs';

test('Admin RLS, explicit authorization, calculations and read-only snapshot',async()=>{
  const db=await createDatabase();
  try {
    await seedAdmin(db);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      for(const table of ['admin_users','admin_sessions']) {
        await assert.rejects(db.query(`select * from ${table}`));
        await assert.rejects(db.query(`delete from ${table}`));
      }
      await assert.rejects(db.query('select get_admin_dashboard($1)',[adminId]));
      await assert.rejects(db.query('select revoke_admin_session($1)',['a'.repeat(64)]));
      await assert.rejects(db.query('insert into admin_users(user_id) values ($1)',[nonadminId]));
      await assert.rejects(db.query('update admin_users set active=true'));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(db.query('select get_admin_dashboard($1)',[nonadminId]));
    await assert.rejects(db.query('update admin_users set active=true'));
    await db.exec('begin read only');
    const data=(await db.query('select get_admin_dashboard($1) as data',[adminId])).rows[0].data;
    await db.exec('commit');
    assert.deepEqual(data.guests,{total:3,adults:2,children:1,confirmed:1,declined:1,pending:1});
    assert.deepEqual(data.groups,{total:1,responded:1,unanswered:0});
    assert.equal(data.gifts.total,3);assert.equal(data.gifts.party,2);assert.equal(data.gifts.insanos,1);
    assert.deepEqual(data.goal_totals,{target:100,raised:40,percentage:40});
    assert.deepEqual(data.contributions,{pending:1,confirmed:4,expired:1,cancelled:1,failed:1,total:415,goal:90,open:300,fixed:25,insanos:25});
    assert.equal(data.goals.length,1);assert.equal(data.goals[0].remaining,60);
    assert.ok(!JSON.stringify(data.goals).includes('Pessoa de teste'));
    assert.equal(data.recent.length,8);
    assert.ok(data.recent.every((r,i)=>!i||Date.parse(data.recent[i-1].created_at)>=Date.parse(r.created_at)));
    const config=(await db.query("select provolatile,prosecdef from pg_proc where oid='public.get_admin_dashboard(uuid)'::regprocedure")).rows[0];
    assert.equal(config.provolatile,'s');assert.equal(config.prosecdef,false);
    await db.exec('reset role');await db.query('update admin_users set active=false where user_id=$1',[adminId]);
    await db.exec('set role service_role');await assert.rejects(db.query('select get_admin_dashboard($1)',[adminId]));
  }finally{await db.close();}
});

test('Dashboard empty state, recent limit, cents and persisted pending remain unchanged',async()=>{
  const db=await createDatabase();
  try {
    await db.query('insert into auth.users(id) values ($1)',[adminId]);await db.query('insert into admin_users(user_id) values ($1)',[adminId]);
    let data=(await db.query('select get_admin_dashboard($1) as data',[adminId])).rows[0].data;
    assert.equal(data.goal_totals.percentage,0);assert.equal(data.contributions.total,0);assert.deepEqual(data.goals,[]);assert.deepEqual(data.recent,[]);
    const gift=(await db.query("insert into gifts(name,slug,category,funding_mode,target_amount) values ('Livre','livre','party','open',null) returning id")).rows[0].id;
    for(let i=0;i<25;i++) await db.query(`insert into gift_contributions(gift_id,contributor_name,amount,payment_method,payment_status,confirmed_at,idempotency_key,request_fingerprint)
      values ($1,'Teste',0.10,'pix','confirmed',now(),gen_random_uuid(),repeat('a',64))`,[gift]);
    await db.query(`insert into gift_contributions(gift_id,contributor_name,amount,payment_method,idempotency_key,request_fingerprint,created_at,expires_at)
      values ($1,'Pendente antigo',1,'pix',gen_random_uuid(),repeat('a',64),now()-interval '1 day',now()-interval '1 day'+interval '15 minutes')`,[gift]);
    data=(await db.query('select get_admin_dashboard($1) as data',[adminId])).rows[0].data;
    assert.equal(data.recent.length,20);assert.equal(data.contributions.total,2.5);assert.equal(data.contributions.pending,1);assert.equal(data.contributions.expired,0);
  }finally{await db.close();}
});
