import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './database-fixture.mjs';
import { adminId, nonadminId } from './admin-fixture.mjs';

test('recovery migration keeps tokens private, single use, and revokes dashboard sessions', async () => {
  const db = await createDatabase();
  try {
    await db.query('insert into auth.users(id) values ($1),($2)', [adminId, nonadminId]);
    await db.query('insert into admin_users(user_id) values ($1)', [adminId]);
    const hash = 'a'.repeat(64);
    const expires = new Date(Date.now() + 8 * 60_000).toISOString();
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from admin_password_recovery_sessions'));
      await assert.rejects(db.query('select register_admin_password_recovery_session($1,$2,$3)', [hash, adminId, expires]));
      await assert.rejects(db.query('select consume_admin_password_recovery_session($1,$2)', [hash, adminId]));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(db.query('select register_admin_password_recovery_session($1,$2,$3)', [hash, nonadminId, expires]));
    await assert.rejects(db.query('update admin_password_recovery_sessions set token_hash=$1', ['b'.repeat(64)]));
    await db.query('select register_admin_password_recovery_session($1,$2,$3)', [hash, adminId, expires]);
    const stored = (await db.query('select token_hash,user_id,expires_at from admin_password_recovery_sessions')).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].token_hash, hash);
    assert.equal(stored[0].user_id, adminId);
    assert.ok(Date.parse(stored[0].expires_at) <= Date.now() + 10 * 60_000);
    await db.query('insert into admin_sessions(token_hash,user_id,expires_at) values ($1,$2,now()+interval \'1 hour\')', ['c'.repeat(64), adminId]);
    assert.equal((await db.query('select consume_admin_password_recovery_session($1,$2) as ok', [hash, nonadminId])).rows[0].ok, false);
    assert.equal((await db.query('select consume_admin_password_recovery_session($1,$2) as ok', [hash, adminId])).rows[0].ok, true);
    assert.equal((await db.query('select count(*)::int as count from admin_sessions')).rows[0].count, 0);
    assert.equal((await db.query('select consume_admin_password_recovery_session($1,$2) as ok', [hash, adminId])).rows[0].ok, false);
    await db.query('select register_admin_password_recovery_session($1,$2,$3)', ['d'.repeat(64), adminId, expires]);
    await db.exec('reset role');
    await db.query('update admin_users set active=false where user_id=$1', [adminId]);
    await db.exec('set role service_role');
    assert.equal((await db.query('select consume_admin_password_recovery_session($1,$2) as ok', ['d'.repeat(64), adminId])).rows[0].ok, false);
  } finally { await db.close(); }
});
