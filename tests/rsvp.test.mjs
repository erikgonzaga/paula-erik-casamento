import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createDatabase,ids } from './database-fixture.mjs';
test('Short invitation code migration preserves answered RSVPs and all relationships',async()=>{
 const migration='202610070001_short_invitation_codes.sql';
 const db=await createDatabase({beforeMigration:migration});
 try {
  await db.query("insert into rsvps(invitation_group_id,notes) values ($1,'Resposta preservada')",[ids.silva]);
  await db.query("update guests set attendance_status='confirmed',phone='11999990001' where invitation_group_id=$1 and type='adult'",[ids.silva]);
  const snapshot=async()=>({
   groups:(await db.query("select to_jsonb(g)-'code' as data from invitation_groups g order by id")).rows,
   guests:(await db.query('select * from guests order by id')).rows,
   rsvps:(await db.query('select * from rsvps order by id')).rows,
  });
  const before=await snapshot();
  const sql=await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8');
  await db.exec(sql);
  assert.deepEqual(await snapshot(),before);
  const codes=(await db.query('select code from invitation_groups order by id')).rows.map(row=>row.code);
  assert.ok(codes.every(code=>/^[A-Z0-9]{6}$/.test(code)));
  assert.equal(new Set(codes).size,codes.length);
  await db.exec(sql);
  assert.deepEqual((await db.query('select code from invitation_groups order by id')).rows.map(row=>row.code),codes);
  for(const invalid of ['ABCDE','ABCDEFG','abc123','ABC-12'])
   await assert.rejects(db.query('update invitation_groups set code=$1 where id=$2',[invalid,ids.silva]));
  await assert.rejects(db.query('update invitation_groups set code=$1 where id=$2',[codes[0],ids.oliveira]));
  assert.deepEqual(await snapshot(),before);
 } finally {await db.close();}
});

test('Unambiguous rotation changes every code once and preserves answered RSVP data',async()=>{
 const migration='202610070002_rotate_unambiguous_invitation_codes.sql';
 const db=await createDatabase({beforeMigration:migration});
 try {
  // Include groups already using allowed characters: they must rotate too.
  await db.query("insert into rsvps(invitation_group_id,notes) values ($1,'Resposta preservada')",[ids.silva]);
  await db.query("update guests set attendance_status='confirmed',phone='11999990001' where invitation_group_id=$1 and type='adult'",[ids.silva]);
  const snapshot=async()=>({
   groups:(await db.query("select to_jsonb(g)-'code' as data from invitation_groups g order by id")).rows,
   guests:(await db.query('select * from guests order by id')).rows,
   rsvps:(await db.query('select * from rsvps order by id')).rows,
  });
  const before=await snapshot();
  const oldCodes=(await db.query('select code from invitation_groups order by id')).rows.map(row=>row.code);
  const sql=await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8');
  await db.exec(sql);
  assert.deepEqual(await snapshot(),before);
  const codes=(await db.query('select code from invitation_groups order by id')).rows.map(row=>row.code);
  assert.equal(codes.length,oldCodes.length);
  assert.ok(codes.every(code=>code.length===6 && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code)));
  assert.ok(codes.every(code=>!/[ILO01]/.test(code) && !oldCodes.includes(code)));
  assert.equal(new Set(codes).size,codes.length);
  await db.exec(sql);
  assert.deepEqual((await db.query('select code from invitation_groups order by id')).rows.map(row=>row.code),codes);
  for(const invalid of ['ABCDE','ABCDEFG','abc234','ABCI23','ABCL23','ABCO23','ABC023','ABC123'])
   await assert.rejects(db.query('update invitation_groups set code=$1 where id=$2',[invalid,ids.silva]));
  await assert.rejects(db.query('update invitation_groups set code=$1 where id=$2',[codes[0],ids.oliveira]));
  assert.deepEqual(await snapshot(),before);
 } finally {await db.close();}
});

test('Invitation lookup temporarily accepts legacy and short codes while the database authorizes access',async()=>{
 let source=await readFile(new URL('../src/services/invitations.ts',import.meta.url),'utf8');
 source=source.replace("import 'server-only';",'').replace("import { database } from '@/lib/supabase/server';",'const database=globalThis.__shortCodeDatabase;')
  .replace("import { InvitationError } from '@/lib/invitations/validation';",'class InvitationError extends Error { constructor(status,message){super(message);this.status=status;} }');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const calls=[];
 globalThis.__shortCodeDatabase=async path=>{calls.push(path);return path.includes('code=eq.ZZZ999&')?[]:[{id:ids.silva,active:true}];};
 try {
  const {findInvitationByCode}=await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  await findInvitationByCode('ABC234');
  await findInvitationByCode('  aBc234  ');
  assert.match(calls[0],/code=eq\.ABC234&/);
  assert.equal(calls[0],calls[1]);
  for(const code of ['ABCO23','ABC023','ABCI23','ABCL23','ABC123']) {
   await findInvitationByCode('  '+code.toLowerCase()+'  ');
   assert.ok(calls.at(-1).includes('code=eq.'+code+'&'));
  }
  for(const size of [20,32,64]) {
   await findInvitationByCode('  '+'a'.repeat(size)+'  ');
   assert.ok(calls.at(-1).includes('code=eq.'+'A'.repeat(size)+'&'));
  }
  for(const code of ['ABCDE','ABCDEFG','ABC-12','ÁBC234','A'.repeat(19),'A'.repeat(65)])
   assert.throws(()=>findInvitationByCode(code),error=>error.status===404);
  assert.equal(calls.length,10);
  await assert.rejects(findInvitationByCode('ZZZ999'),error=>error.status===404);
  assert.equal(calls.length,11,'valid format alone must not authorize an unknown code');
 } finally {delete globalThis.__shortCodeDatabase;}
});
test('Migrations, RLS, RSVP atomicity and edits',async()=>{
 const db=await createDatabase();
 try{
  const guests=(await db.query('select id,type from guests where invitation_group_id=$1 order by id',[ids.silva])).rows;
  const answers=guests.map((g,index)=>({...g,status:'confirmed',phone:g.type==='adult'?`+55 11 99999-000${index+1}`:null}));
  const save=async(list,notes='Nossa observação')=>(await db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5) as value',[ids.silva,JSON.stringify(list),list.find(g=>g.phone)?.phone??null,'Pedro: sem lactose',notes])).rows[0].value;
  const first=await save(answers);assert.equal(first.updated,false);
  assert.equal((await db.query("select count(*)::int as n from guests where attendance_status='confirmed'")).rows[0].n,3);
  const edited=await save(answers.map((g,i)=>({...g,status:i===2?'declined':'confirmed'})),'Planos atualizados');
  assert.equal(edited.updated,true);assert.equal(edited.submitted_at,first.submitted_at);
  assert.ok(new Date(edited.updated_at)>=new Date(first.updated_at));
  const stored=(await db.query('select * from rsvps where invitation_group_id=$1',[ids.silva])).rows[0];
  assert.equal(stored.notes,'Planos atualizados');assert.equal(stored.dietary_restrictions,'Pedro: sem lactose');
  assert.equal((await db.query("select attendance_status from guests where name='Pedro Silva'")).rows[0].attendance_status,'declined');
  const phones=(await db.query('select name,phone from guests where invitation_group_id=$1 order by id',[ids.silva])).rows;
  assert.equal(phones[0].phone,'+55 11 99999-0001');assert.equal(phones[1].phone,'+55 11 99999-0002');assert.equal(phones[2].phone,null);
  await save(answers.map((guest,index)=>index===0?{...guest,phone:'+55 11 99999-1111'}:guest),'Telefones atualizados');
  assert.equal((await db.query("select phone from guests where name='João Silva'")).rows[0].phone,'+55 11 99999-1111');
  const other=(await db.query('select id from guests where invitation_group_id=$1',[ids.oliveira])).rows[0].id;
  await assert.rejects(save([{id:other,status:'declined',phone:'+55 11 98888-2222'},...answers.slice(1)]));
  await assert.rejects(save(answers.map(guest=>guest.type==='child'?{...guest,phone:'+55 11 97777-3333'}:guest)));
  await assert.rejects(save([answers[0],answers[0],answers[2]]));
  await assert.rejects(save(answers.slice(1)));
  await assert.rejects(save(answers.map(g=>({...g,status:'pending'}))));
  assert.equal((await db.query('select notes from rsvps')).rows[0].notes,'Telefones atualizados');
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
