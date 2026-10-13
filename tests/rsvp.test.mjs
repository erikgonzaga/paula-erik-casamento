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

test('Invitation lookup accepts only definitive codes while the database authorizes access',async()=>{
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
  for(const code of ['ABCI23','ABCL23','ABCO23','ABC023','ABC123',
    'ABCDE','ABCDEFG','ABC-12','ÁBC234',...[20,32,64].map(size=>'A'.repeat(size))]) {
   assert.throws(()=>findInvitationByCode(code),error=>error.status===404);
   assert.throws(()=>findInvitationByCode('  '+code.toLowerCase()+'  '),error=>error.status===404);
  }
  assert.equal(calls.length,2,'invalid formats must be rejected before querying');
  await assert.rejects(findInvitationByCode('ZZZ999'),error=>error.status===404);
  assert.equal(calls.length,3,'valid format alone must not authorize an unknown code');
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
  await save(answers.slice(0,2).map((guest,index)=>index===0?{...guest,phone:'+55 11 99999-1111'}:guest),'Telefones atualizados');
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

// Exercise the real migration/RPC and public service together, without remote IO.
test('public refusal is final, hidden on reads, and remains active/auditable in Admin', async () => {
 const { typescriptModule } = await import('./typescript-fixture.mjs');
 const db = await createDatabase({ beforeMigration: '202610120001_rsvp_declined_public_final.sql' });
 const snapshot = async () => ({ guests: (await db.query('select * from guests order by id')).rows, rsvps: (await db.query('select * from rsvps order by id')).rows });
 const before = await snapshot();
 const sql = await readFile(new URL('../supabase/migrations/202610120001_rsvp_declined_public_final.sql', import.meta.url), 'utf8');
 const databaseModule = `data:text/javascript,export const database=(...args)=>globalThis.__finalRsvpDatabase(...args);`;
 globalThis.__finalRsvpDatabase = async (path, body) => {
  if (path === 'rpc/save_invitation_rsvp') return (await db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5) as data', [body.p_group_id, JSON.stringify(body.p_guests), body.p_phone, body.p_dietary, body.p_notes])).rows[0].data;
  const url = new URL(path, 'https://fixture.invalid');
  if (url.pathname === '/invitation_groups') return (await db.query('select * from invitation_groups where id=$1', [url.searchParams.get('id').slice(3)])).rows;
  if (url.pathname === '/event_private_details') return [];
  const group = url.searchParams.get('invitation_group_id').slice(3);
  if (url.pathname === '/rsvps') return (await db.query('select * from rsvps where invitation_group_id=$1', [group])).rows;
  assert.equal(url.searchParams.get('attendance_status'), 'neq.declined');
  return (await db.query("select id,name,type,phone,attendance_status from guests where invitation_group_id=$1 and active and attendance_status<>'declined' order by id", [group])).rows;
 };
 try {
  await db.exec(sql); assert.deepEqual(await snapshot(), before);
  await db.exec(sql); assert.deepEqual(await snapshot(), before, 'reexecution does not change data');
  const replacements = { '@/lib/supabase/server': databaseModule };
  const { getInvitation } = await import(await typescriptModule('../src/services/invitations.ts', replacements));
  const { submitRsvp } = await import(await typescriptModule('../src/services/rsvp.ts', replacements));
  const people = (await getInvitation(ids.silva)).guests;
  const answers = people.map((p,i) => ({ id:p.id, status:i===0?'declined':'confirmed', phone:p.type==='adult'?'11999990001':null }));
  const payload = guests => ({ guests, dietary_restrictions:'Restrição preservada', notes:'Observação do grupo' });
  const first = await submitRsvp(ids.silva, payload(answers));
  const declinedBefore = (await db.query('select * from guests where id=$1',[people[0].id])).rows[0];
  assert.equal(declinedBefore.attendance_status,'declined'); assert.equal(declinedBefore.active,true);
  const following = await getInvitation(ids.silva);
  assert.equal(following.guests.length,2); assert.ok(!JSON.stringify(following).includes(people[0].name));
  const remaining = answers.slice(1);
  const second = await submitRsvp(ids.silva,payload(remaining)); assert.equal(second.updated,true); assert.equal(second.submitted_at,first.submitted_at);
  assert.deepEqual((await db.query('select * from guests where id=$1',[people[0].id])).rows[0],declinedBefore,'historical phone/status/timestamps are untouched');
  const rpc = async list => db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5)',[ids.silva,JSON.stringify(list),null,'','']);
  for (const invalid of [answers.map(p=>({...p,status:'confirmed'})),[{...answers[0],status:'confirmed'},remaining[0]],[remaining[0],remaining[0]]]) {
   const checkpoint=await snapshot(); await assert.rejects(rpc(invalid)); await assert.rejects(submitRsvp(ids.silva,payload(invalid))); assert.deepEqual(await snapshot(),checkpoint);
  }
  const other=(await getInvitation(ids.oliveira)).guests[0];
  await assert.rejects(rpc([{id:other.id,status:'confirmed',phone:'11999990001'},remaining[1]]));
  await submitRsvp(ids.silva,payload(remaining.map((p,i)=>({...p,status:i===0?'declined':'confirmed'}))));
  assert.equal((await getInvitation(ids.silva)).guests.length,1);
  await submitRsvp(ids.silva,payload([{...remaining[1],status:'declined'}]));
  const empty=await getInvitation(ids.silva); assert.equal(empty.guests.length,0); assert.equal(empty.name,'Seu convite'); assert.equal(empty.rsvp,null);
  const final=await snapshot(); await assert.rejects(rpc([])); await assert.rejects(submitRsvp(ids.silva,payload([]))); assert.deepEqual(await snapshot(),final);
  assert.equal(final.guests.filter(g=>g.invitation_group_id===ids.silva&&g.active&&g.attendance_status==='declined').length,3);
  const admin='80000000-0000-4000-8000-000000000001';
  await db.query('insert into auth.users(id) values ($1)',[admin]); await db.query('insert into admin_users(user_id) values ($1)',[admin]);
  await db.query('update invitation_groups set is_demo=false where id=$1',[ids.silva]);
  await db.exec('set role service_role');
  const details=(await db.query('select get_admin_rsvp_details($1) as data',[admin])).rows[0].data;
  const visible=details.guests.filter(g=>g.group_id===ids.silva); assert.equal(visible.length,3); assert.ok(visible.every(g=>g.attendance_status==='declined'));
  assert.equal(visible.find(g=>g.id===people[0].id)?.phone,'11999990001');
  await db.exec('reset role');
  const config=(await db.query("select prosecdef,proconfig from pg_proc where oid='public.save_invitation_rsvp(uuid,jsonb,text,text,text)'::regprocedure")).rows[0];
  assert.equal(config.prosecdef,false); assert.ok(config.proconfig.includes('search_path=""'));
  for(const role of ['anon','authenticated']) { await db.exec('set role '+role); await assert.rejects(rpc([])); await db.exec('reset role'); }
 } finally { delete globalThis.__finalRsvpDatabase; await db.close(); }
});

test('public portal removes declined names after save and shows a neutral empty invitation', async () => {
 const { JSDOM } = await import('jsdom');
 const { typescriptModule } = await import('./typescript-fixture.mjs');
 const { createRequire } = await import('node:module');
 const { pathToFileURL } = await import('node:url');
 const require=createRequire(import.meta.url);
 const React=await import('react'); const { act }=React;
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'});
 const keys=['window','document','HTMLElement','HTMLInputElement','navigator','IS_REACT_ACT_ENVIRONMENT'];
 const old=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const originalFetch=globalThis.fetch;
 for(const k of keys.slice(0,-1))Object.defineProperty(globalThis,k,{configurable:true,value:dom.window[k]});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {createRoot}=await import('react-dom/client');
 const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
 const link=url(`import React from '${pathToFileURL(require.resolve('react')).href}';export default function Link({children,...props}){return React.createElement('a',props,children);}`);
 const replacements={'next/link':link,'next/navigation':url('export const useRouter=()=>({push(){}});'),
  './wedding-logo':url('export const WeddingLogo=()=>null;'),'./icons':url('export const ArrowUpRightIcon=()=>null;')};
 const {InvitationPortal}=await import(await typescriptModule('../src/components/invitation-portal.tsx',replacements));
 const guest={id:'91000000-0000-4000-8000-000000000001',name:'Fixture recusada',type:'adult',phone:'11999990001',attendance_status:'confirmed'};
 let invitation={id:ids.silva,name:'Seu convite',guests:[guest],active:true,is_demo:false,rsvp:null,event:null};
 const posts=[]; let root;
 try {
  globalThis.fetch=async(_path,init)=>{
   if(init.method==='POST'){posts.push(JSON.parse(init.body));return Response.json({updated:false,submitted_at:'2026-10-12T00:00:00Z',updated_at:'2026-10-12T00:00:00Z'});}
   return Response.json(invitation);
  };
  const container=dom.window.document.getElementById('root');root=createRoot(container);
  await act(async()=>{root.render(React.createElement(InvitationPortal));});
  assert.ok(container.textContent.includes(guest.name));
  await act(async()=>{container.querySelector('input[value="declined"]').click();});
  await act(async()=>{container.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(posts.length,1);assert.equal(posts[0].guests[0].status,'declined');
  assert.ok(!container.innerHTML.includes(guest.name));assert.equal(container.querySelector('form'),null);
  assert.ok(container.textContent.includes('As respostas deste convite já foram registradas.'));
  await act(async()=>root.unmount());root=null;
  invitation={...invitation,guests:[]};root=createRoot(container);
  await act(async()=>root.render(React.createElement(InvitationPortal)));
  assert.equal(container.querySelector('form'),null);assert.equal(posts.length,1);
  assert.ok(container.textContent.includes('As respostas deste convite já foram registradas.'));
  await act(async()=>root.unmount());root=null;posts.length=0;
  const brennda={...guest,name:'Brennda',phone:null,attendance_status:'pending'};
  const joao={...brennda,id:'91000000-0000-4000-8000-000000000002',name:'João'};
  const maria={...brennda,id:'91000000-0000-4000-8000-000000000003',name:'Maria'};
  invitation={...invitation,guests:[brennda,joao,maria],rsvp:{dietary_restrictions:'Texto alimentar atual',notes:'Observação atual',submitted_at:null,updated_at:null}};
  root=createRoot(container);await act(async()=>root.render(React.createElement(InvitationPortal)));
  const save=()=>act(async()=>container.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  await save();assert.equal(posts.length,0,'zero changes must never POST');
  assert.ok([...container.querySelectorAll('input[type="radio"]')].every(input=>!input.required));
  await act(async()=>container.querySelector(`input[name="${brennda.id}"][value="declined"]`).click());
  await save();assert.equal(posts.length,0,'a submitted adult needs a phone');
  assert.equal(container.querySelector(`#phone-${joao.id}`).required,false);
  assert.equal(container.querySelector(`#phone-${maria.id}`).required,false);
  await act(async()=>{
    const input=container.querySelector(`#phone-${brennda.id}`);
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'11999990001');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  await save();assert.equal(posts.length,1);assert.deepEqual(posts[0].guests,[{id:brennda.id,status:'declined',phone:'11999990001'}]);
  assert.equal(posts[0].dietary_restrictions,'Texto alimentar atual');assert.equal(posts[0].notes,'Observação atual');
  assert.ok(!container.textContent.includes('Brennda'));assert.ok(container.textContent.includes('João'));assert.ok(container.textContent.includes('Maria'));
  assert.equal(container.querySelectorAll('input[type="radio"]:checked').length,0,'untouched guests remain pending');
  await save();assert.equal(posts.length,1,'no auto-repeat after applying partial result');
 } finally {
  if(root)await act(async()=>root.unmount());globalThis.fetch=originalFetch;
  for(const [k,descriptor]of Object.entries(old)){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}
  dom.window.close();
 }
});

test('rollout RPC accepts complete legacy/new clients while declined history is immutable', async () => {
 const { typescriptModule }=await import('./typescript-fixture.mjs');
 const db=await createDatabase();
 const databaseModule='data:text/javascript,export const database=(...args)=>globalThis.__rolloutRsvpDatabase(...args);';
 const legacyInvitations='data:text/javascript,export const getInvitation=(id)=>globalThis.__rolloutLegacyInvitation(id);';
 globalThis.__rolloutRsvpDatabase=async (_path,body)=>(await db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5) as value',
  [body.p_group_id,JSON.stringify(body.p_guests),body.p_phone,body.p_dietary,body.p_notes])).rows[0].value;
 globalThis.__rolloutLegacyInvitation=async group=>({guests:(await db.query('select id,type from guests where invitation_group_id=$1 and active order by id',[group])).rows});
 try {
  const {submitRsvp:legacySubmit}=await import(await typescriptModule('../src/services/rsvp.ts',{
   '@/lib/supabase/server':databaseModule,'./invitations':legacyInvitations}));
  const people=(await globalThis.__rolloutLegacyInvitation(ids.silva)).guests;
  const all=people.map((p,i)=>({id:p.id,status:i===0?'declined':'confirmed',phone:p.type==='adult'?`1199999000${i+1}`:null}));
  const payload=guests=>({guests,dietary_restrictions:'Grupo: sem lactose',notes:'Resposta revisada'});
  await legacySubmit(ids.silva,payload(all));
  const frozen=(await db.query('select * from guests where id=$1',[all[0].id])).rows[0];
  const checkpoint=async()=>({guests:(await db.query('select * from guests order by id')).rows,rsvps:(await db.query('select * from rsvps order by id')).rows});
  const oldPayload=all.map((p,i)=>i===0?{...p,phone:'11911112222'}:p);
  await legacySubmit(ids.silva,payload(oldPayload));
  assert.deepEqual((await db.query('select * from guests where id=$1',[all[0].id])).rows[0],frozen);
  const groupResponse=(await db.query('select * from rsvps where invitation_group_id=$1',[ids.silva])).rows[0];
  assert.equal(groupResponse.phone,all[1].phone,'redundant declined phone must not become group phone');
  assert.equal(groupResponse.dietary_restrictions,'Grupo: sem lactose');assert.equal(groupResponse.notes,'Resposta revisada');
  const rpc=list=>db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5)',[ids.silva,JSON.stringify(list),'11911112222','Outro texto','Outro texto']);
  const other=(await db.query('select id from guests where invitation_group_id=$1',[ids.oliveira])).rows[0].id;
  for(const invalid of [oldPayload.map((p,i)=>i===0?{...p,status:'confirmed'}:p),[oldPayload[0],oldPayload[1]],
    [oldPayload[1],oldPayload[1]],[...oldPayload.slice(0,2),{id:other,status:'confirmed',phone:'11999992222'}]]){
   const before=await checkpoint();await assert.rejects(rpc(invalid));assert.deepEqual(await checkpoint(),before);
  }
  const before=await checkpoint();await assert.rejects(legacySubmit(ids.silva,payload(oldPayload.map(p=>({...p,status:'confirmed'})))));assert.deepEqual(await checkpoint(),before);
  await rpc(all.slice(1)); // New complete payload, same RPC.
  await rpc(all.slice(1).map((p,i)=>({...p,status:i===0?'declined':'confirmed'})));
  assert.deepEqual((await db.query('select * from guests where id=$1',[all[0].id])).rows[0],frozen);
  await rpc([{...all[2],status:'declined'}]);
  const finished=await checkpoint();
  await legacySubmit(ids.silva,payload(oldPayload.map(p=>({...p,status:'declined'}))));
  assert.deepEqual(await checkpoint(),finished,'all-declined old client is acknowledged with zero writes');
  await assert.rejects(rpc([]));assert.deepEqual(await checkpoint(),finished);
  assert.ok(finished.guests.filter(g=>g.invitation_group_id===ids.silva).every(g=>g.active&&g.attendance_status==='declined'));
 } finally {delete globalThis.__rolloutRsvpDatabase;delete globalThis.__rolloutLegacyInvitation;await db.close();}
});

test('partial RSVP updates only submitted people: Brennda declines while everyone else stays pending', async () => {
 const {typescriptModule}=await import('./typescript-fixture.mjs');
 const {randomUUID}=await import('node:crypto');
 const db=await createDatabase({beforeMigration:'202610120002_partial_rsvp_updates.sql'});
 const group=randomUUID(), brennda=randomUUID(), joao=randomUUID(), maria=randomUUID();
 const rpc=(groupId,guests,diet='Sem lactose',notes='Texto preservado')=>db.query('select save_invitation_rsvp($1,$2::jsonb,$3,$4,$5) as result',[groupId,JSON.stringify(guests),null,diet,notes]);
 globalThis.__partialRsvpDatabase=async(path,body)=>{
  if(path==='rpc/save_invitation_rsvp')return(await rpc(body.p_group_id,body.p_guests,body.p_dietary,body.p_notes)).rows[0].result;
  const url=new URL(path,'https://fixture.invalid');
  if(url.pathname==='/event_private_details')return [];
  const groupId=(url.searchParams.get('invitation_group_id')??url.searchParams.get('id')).slice(3);
  if(url.pathname==='/invitation_groups')return(await db.query('select * from invitation_groups where id=$1',[groupId])).rows;
  if(url.pathname==='/rsvps')return(await db.query('select * from rsvps where invitation_group_id=$1',[groupId])).rows;
  assert.equal(url.searchParams.get('attendance_status'),'neq.declined');
  return(await db.query("select * from guests where invitation_group_id=$1 and active and attendance_status<>'declined' order by id",[groupId])).rows;
 };
 const snapshot=async()=>({guests:(await db.query('select * from guests order by id')).rows,rsvps:(await db.query('select * from rsvps order by id')).rows});
 const answer=(id,status,phone='11999990001')=>({id,status,phone});
 try {
  await db.query("insert into invitation_groups(id,name,slug,code) values ($1,'Grupo de teste',$2,'PRT234')",[group,randomUUID()]);
  await db.query("insert into guests(id,invitation_group_id,name,type) values($1,$4,'Brennda','adult'),($2,$4,'João','adult'),($3,$4,'Maria','adult')",[brennda,joao,maria,group]);
  await db.query("insert into rsvps(invitation_group_id,dietary_restrictions,notes) values($1,'Sem lactose','Texto preservado')",[group]);
  const before=await snapshot();
  const migration=await readFile(new URL('../supabase/migrations/202610120002_partial_rsvp_updates.sql',import.meta.url),'utf8');
  await db.exec(migration);assert.deepEqual(await snapshot(),before);await db.exec(migration);assert.deepEqual(await snapshot(),before);
  const adapter='data:text/javascript,export const database=(...args)=>globalThis.__partialRsvpDatabase(...args);';
  const replacements={'@/lib/supabase/server':adapter};
  const {submitRsvp}=await import(await typescriptModule('../src/services/rsvp.ts',replacements));
  const {getInvitation}=await import(await typescriptModule('../src/services/invitations.ts',replacements));
  const submit=guests=>submitRsvp(group,{guests,dietary_restrictions:'Sem lactose',notes:'Texto preservado'});
  const untouched=(await db.query('select * from guests where id in($1,$2) order by id',[joao,maria])).rows;
  await submit([answer(brennda,'declined')]);
  assert.deepEqual((await db.query('select * from guests where id in($1,$2) order by id',[joao,maria])).rows,untouched);
  assert.ok(untouched.every(g=>g.attendance_status==='pending'&&g.phone===null));
  const frozen=(await db.query('select * from guests where id=$1',[brennda])).rows[0];assert.equal(frozen.attendance_status,'declined');assert.equal(frozen.active,true);
  assert.deepEqual((await getInvitation(group)).guests.map(g=>g.name).sort(),['João','Maria']);
  const invalid=[[],[answer(brennda,'confirmed')],[answer(joao,'confirmed',null)],[answer(joao,'confirmed'),answer(joao,'confirmed')]];
  const external=(await db.query('select id from guests where invitation_group_id=$1 limit 1',[ids.oliveira])).rows[0].id;
  invalid.push([answer(external,'confirmed')]);
  for(const list of invalid){const checkpoint=await snapshot();await assert.rejects(submit(list));await assert.rejects(rpc(group,list));assert.deepEqual(await snapshot(),checkpoint);}
  await submit([answer(joao,'confirmed')]);
  assert.deepEqual((await db.query('select * from guests where id=$1',[maria])).rows[0],untouched.find(g=>g.id===maria));
  await submit([answer(joao,'declined')]);
  assert.deepEqual((await getInvitation(group)).guests.map(g=>g.name),['Maria']);
  await submit([answer(maria,'declined')]);assert.equal((await getInvitation(group)).guests.length,0);
  assert.deepEqual((await db.query('select * from guests where id=$1',[brennda])).rows[0],frozen);
  const final=await snapshot();await rpc(group,[answer(brennda,'declined','11911112222'),answer(joao,'declined'),answer(maria,'declined')]);assert.deepEqual(await snapshot(),final,'legacy all-declined is still a no-op');
  const child=(await db.query("select id from guests where invitation_group_id=$1 and type='child'",[ids.silva])).rows[0].id;
  const adult=(await db.query("select id from guests where invitation_group_id=$1 and type='adult' limit 1",[ids.silva])).rows[0].id;
  await rpc(ids.silva,[answer(adult,'confirmed')]);
  const phoneBefore=(await db.query('select phone from rsvps where invitation_group_id=$1',[ids.silva])).rows[0].phone;
  await assert.rejects(rpc(ids.silva,[answer(child,'confirmed')]));
  await assert.rejects(submitRsvp(ids.silva,{guests:[answer(child,'confirmed')],dietary_restrictions:'',notes:''}));
  await rpc(ids.silva,[answer(child,'confirmed',null)]);
  assert.equal((await db.query('select phone from rsvps where invitation_group_id=$1',[ids.silva])).rows[0].phone,phoneBefore);
  const admin=randomUUID();await db.query('insert into auth.users(id) values($1)',[admin]);await db.query('insert into admin_users(user_id) values($1)',[admin]);
  await db.exec('set role service_role');
  const data=(await db.query('select get_admin_rsvp_details($1) as data',[admin])).rows[0].data;
  assert.equal(data.guests.filter(g=>g.group_id===group&&g.attendance_status==='declined').length,3);
 } finally {delete globalThis.__partialRsvpDatabase;await db.close();}
});
