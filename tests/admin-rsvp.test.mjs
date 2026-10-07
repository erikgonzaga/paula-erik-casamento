import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './database-fixture.mjs';
import { adminId, nonadminId } from './admin-fixture.mjs';

test('Admin RSVP details keep individual status and group answers isolated', async () => {
  const db = await createDatabase();
  try {
    await db.query('insert into auth.users(id) values ($1),($2)', [adminId, nonadminId]);
    await db.query('insert into admin_users(user_id) values ($1)', [adminId]);
    let codeNumber=234;
    const addGroup = async (name, active = true, isDemo = false) =>
      (await db.query('insert into invitation_groups(name,slug,code,active,is_demo) values ($1,$2,$3,$4,$5) returning id',
        [name, randomUUID(), 'ADM'+codeNumber++, active, isDemo])).rows[0].id;
    const silvaA = await addGroup('Família Silva');
    const silvaB = await addGroup('Família Silva');
    const demo = await addGroup('Família Demo', true, true);
    const inactiveGroup = await addGroup('Família Inativa', false);
    await db.query(`insert into guests(invitation_group_id,name,type,attendance_status,active,phone) values
      ($1,'José Josias','adult','confirmed',true,'11911111111'),
      ($1,'Maria Juraci','adult','declined',true,'11922222222'),
      ($1,'Adulto sem telefone','adult','pending',true,null),
      ($1,'Oculto','adult','confirmed',false,null),
      ($2,'Samuel Silva','adult','pending',true,null),
      ($2,'Criança Silva','child','pending',true,null),
      ($3,'Demo','adult','confirmed',true,null),
      ($4,'Grupo inativo','adult','confirmed',true,null)`, [silvaA, silvaB, demo, inactiveGroup]);
    await db.query(`insert into rsvps(invitation_group_id,phone,dietary_restrictions,notes)
      values ($1,'11999990000','Sem lactose','Chega cedo'),($2,'11988880000','Demo','Ocultar')`, [silvaA, demo]);

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select get_admin_rsvp_details($1)', [adminId]));
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(db.query('select get_admin_rsvp_details($1)', [nonadminId]));
    await db.exec('begin read only');
    const data = (await db.query('select get_admin_rsvp_details($1) as data', [adminId])).rows[0].data;
    await db.exec('commit');
    assert.deepEqual(data.summary, { total: 5, confirmed: 1, declined: 1, pending: 3 });
    assert.equal(data.guests.length, 5);
    assert.deepEqual(data.guests.map(guest => guest.name).sort(), ['Adulto sem telefone', 'Criança Silva', 'José Josias', 'Maria Juraci', 'Samuel Silva']);
    const jose = data.guests.find(guest => guest.name === 'José Josias');
    const maria = data.guests.find(guest => guest.name === 'Maria Juraci');
    const samuel = data.guests.find(guest => guest.name === 'Samuel Silva');
    const child = data.guests.find(guest => guest.name === 'Criança Silva');
    const noPhone = data.guests.find(guest => guest.name === 'Adulto sem telefone');
    assert.equal(jose.attendance_status, 'confirmed');
    assert.equal(maria.attendance_status, 'declined');
    assert.equal(samuel.attendance_status, 'pending');
    assert.equal(child.type, 'child');
    assert.equal(jose.group_name, samuel.group_name);
    assert.notEqual(jose.group_id, samuel.group_id);
    assert.equal(jose.phone, '11911111111');
    assert.equal(maria.phone, '11922222222');
    assert.notEqual(jose.phone, maria.phone);
    assert.equal(noPhone.phone, null, 'legacy group phone must not be assigned to another adult');
    assert.equal(child.phone, null);
    assert.ok(data.guests.every(guest => guest.phone !== '11999990000'), 'legacy group phone is not used');
    assert.equal(maria.dietary_restrictions, 'Sem lactose');
    assert.equal(maria.notes, 'Chega cedo');
    assert.ok(jose.submitted_at);
    for (const guest of [samuel, child]) {
      assert.equal(guest.phone, null);
      assert.equal(guest.submitted_at, null);
      assert.equal(guest.dietary_restrictions, null);
      assert.equal(guest.notes, null);
    }
    const config = (await db.query("select provolatile,prosecdef,proconfig from pg_proc where oid='public.get_admin_rsvp_details(uuid)'::regprocedure")).rows[0];
    assert.equal(config.provolatile, 's');
    assert.equal(config.prosecdef, false);
    assert.ok(config.proconfig.some(setting => setting === 'search_path=""'));
    await db.exec('reset role');
    await db.query('update admin_users set active=false where user_id=$1', [adminId]);
    await db.exec('set role service_role');
    await assert.rejects(db.query('select get_admin_rsvp_details($1)', [adminId]));
  } finally { await db.close(); }
});
