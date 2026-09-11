import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codes } from './database-fixture.mjs';
const base=process.env.TEST_APP_URL||'http://127.0.0.1:3101';
async function api(path,{body,cookie,origin=base,method}={}){
 return fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
test('HTTP: closed invitations, privacy, responses and cross-group attacks',async()=>{
 const anonymous=await api('/api/rsvp');assert.equal(anonymous.status,401);assert.match(anonymous.headers.get('cache-control'),/no-store/);
 const home=await (await fetch(base)).text();assert.ok(!home.includes('ENDEREÇO DEMO PRIVADO'));assert.ok(!home.includes(codes.silva));assert.ok(!home.includes('test-service-role'));
 assert.equal((await api('/api/invitations/access',{body:{code:'INVALID'}})).status,404);
 assert.equal((await api('/api/invitations/access',{body:{code:codes.inactive}})).status,403);
 assert.equal((await api('/api/invitations/access',{body:{code:codes.silva},origin:'https://outside.example'})).status,403);
 const open=await api('/api/invitations/access',{body:{code:codes.silva}});
 assert.equal(open.status,200);
 const cookie=open.headers.get('set-cookie').split(';')[0];
 assert.match(open.headers.get('set-cookie'),/HttpOnly/i);
 assert.match(open.headers.get('set-cookie'),/SameSite=strict/i);
 const read=await api('/api/rsvp',{cookie});assert.equal(read.status,200);const invitation=await read.json();
 assert.equal(invitation.guests.length,3);assert.match(invitation.event.address,/DEMO PRIVADO/);
 assert.ok(!JSON.stringify(invitation).includes(codes.oliveira));assert.ok(!JSON.stringify(invitation).includes(codes.silva));
 const response={guests:invitation.guests.map(g=>({id:g.id,status:'confirmed'})),phone:'11999999999',dietary_restrictions:'Pedro: sem lactose',notes:'Obrigado pelo convite'};
 let saved=await api('/api/rsvp',{cookie,body:response});assert.equal(saved.status,200);assert.equal((await saved.json()).updated,false);
 response.guests[2].status='declined';response.notes='Atualizado';
 saved=await api('/api/rsvp',{cookie,body:response});assert.equal(saved.status,200);assert.equal((await saved.json()).updated,true);
 const reopen=await api('/api/invitations/access',{body:{slug:'demo-familia-silva-'+codes.silva.toLowerCase()}});
 assert.equal(reopen.status,200);
 const persisted=await (await api('/api/rsvp',{cookie:reopen.headers.get('set-cookie').split(';')[0]})).json();
 assert.equal(persisted.rsvp.notes,'Atualizado');assert.equal(persisted.rsvp.dietary_restrictions,'Pedro: sem lactose');assert.equal(persisted.guests[2].attendance_status,'declined');
 const otherOpen=await api('/api/invitations/access',{body:{code:codes.oliveira}});
 const otherCookie=otherOpen.headers.get('set-cookie').split(';')[0];
 const other=await (await api('/api/rsvp',{cookie:otherCookie})).json();
 assert.equal(other.guests.length,2);
 assert.equal((await api('/api/rsvp',{cookie,body:{...response,invitation_group_id:other.id}})).status,400);
 assert.equal((await api('/api/rsvp',{cookie,body:{...response,guests:[{id:other.guests[0].id,status:'confirmed'},...response.guests.slice(1)]}})).status,400);
 assert.equal((await api('/api/rsvp',{cookie:cookie+'x'})).status,401);
 assert.equal((await api('/api/rsvp',{body:response})).status,401);
 const untouched=await (await api('/api/rsvp',{cookie:otherCookie})).json();assert.equal(untouched.rsvp,null);
 assert.equal((await api('/api/rsvp',{cookie,body:{...response,notes:'x'.repeat(2001)}})).status,400);
 assert.equal((await api('/api/rsvp',{cookie,body:{...response,notes:'x'.repeat(17000)}})).status,413);
 let throttled=false;for(let i=0;i<15;i++){if((await api('/api/invitations/access',{body:{code:'INVALID'}})).status===429){throttled=true;break;}}assert.equal(throttled,true);
});

