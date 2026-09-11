import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase,ids } from './database-fixture.mjs';
test('Migrations, RLS, RSVP atomicity and edits',async()=>{
 const db=await createDatabase();
 try{
  const guests=(await db.query('select id from guests where invitation_group_id=$1 order by id',[ids.silva])).rows;
  const answers=guests.map(g=>({...g,status:'confirmed'}));
  const save=async(list,notes='Nossa observação')=>(await db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5) as value',[ids.silva,JSON.stringify(list),'+55 11 99999-9999','Pedro: sem lactose',notes])).rows[0].value;
  const first=await save(answers);assert.equal(first.updated,false);
  assert.equal((await db.query("select count(*)::int as n from guests where attendance_status='confirmed'")).rows[0].n,3);
  const edited=await save(answers.map((g,i)=>({...g,status:i===2?'declined':'confirmed'})),'Planos atualizados');
  assert.equal(edited.updated,true);assert.equal(edited.submitted_at,first.submitted_at);
  assert.ok(new Date(edited.updated_at)>=new Date(first.updated_at));
  const stored=(await db.query('select * from rsvps where invitation_group_id=$1',[ids.silva])).rows[0];
  assert.equal(stored.notes,'Planos atualizados');assert.equal(stored.dietary_restrictions,'Pedro: sem lactose');
  assert.equal((await db.query("select attendance_status from guests where name='Pedro Silva'")).rows[0].attendance_status,'declined');
  const other=(await db.query('select id from guests where invitation_group_id=$1',[ids.oliveira])).rows[0].id;
  await assert.rejects(save([{id:other,status:'declined'},...answers.slice(1)]));
  await assert.rejects(save([answers[0],answers[0],answers[2]]));
  await assert.rejects(save(answers.slice(1)));
  await assert.rejects(save(answers.map(g=>({...g,status:'pending'}))));
  assert.equal((await db.query('select notes from rsvps')).rows[0].notes,'Planos atualizados');
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   for(const table of ['invitation_groups','guests','rsvps','event_private_details','invitation_rate_limits']){
    await assert.rejects(db.query('select * from '+table));
    await assert.rejects(db.query('delete from '+table));
   }
   await assert.rejects(db.query("select consume_invitation_limit('x',1,60)"));
   await assert.rejects(save(answers));
   await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await db.query('select count(*)::int as n from invitation_groups')).rows[0].n,3);
  await db.exec('reset role');
  await db.query('update invitation_groups set active=false where id=$1',[ids.silva]);
  await assert.rejects(save(answers));
  assert.equal((await db.query("select consume_invitation_limit('test',1,60) as value")).rows[0].value,true);
  assert.equal((await db.query("select consume_invitation_limit('test',1,60) as value")).rows[0].value,false);
 }finally{await db.close();}
});

