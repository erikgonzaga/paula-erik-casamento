import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { adminFixture, adminId, nonadminId } from './admin-fixture.mjs';

test('Built app: admin boundaries, logout replay, public regression, no dashboard writes or client secret', {timeout:120000},async()=>{
  const marker=await readFile('.next/admin-test-build.json','utf8').then(JSON.parse).catch(()=>null);
  assert.equal(marker?.buildId,(await readFile('.next/BUILD_ID','utf8')).trim(),'Execute node tests/build-test-app.mjs first; only isolated builds may run this test');
  const fixture=await adminFixture(54331);
  const dbUrl=`http://127.0.0.1:${fixture.server.address().port}`;
  const base='http://127.0.0.1:3113';
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3113'],{
    windowsHide:true,stdio:'pipe',env:{...process.env,SUPABASE_URL:dbUrl,NEXT_PUBLIC_SUPABASE_URL:dbUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-anon-key',SUPABASE_SERVICE_ROLE_KEY:'test-service-role',
      INVITATION_SESSION_SECRET:'local-tests-only-session-secret-123456789',APP_ORIGIN:base,VERCEL:'0'},
  });
  let logs='';child.stdout.on('data',x=>{logs+=x});child.stderr.on('data',x=>{logs+=x});
  const get=(path,cookie)=>fetch(base+path,{redirect:'manual',headers:cookie?{Cookie:cookie}:{}});
  const post=(body,cookie,origin=base)=>fetch(base+'/admin/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try {
    let ready=false;
    for(let i=0;i<100;i++){try {if((await get('/admin/login')).ok){ready=true;break;}}catch{}await delay(100);}
    assert.ok(ready,'local app started');
    const anonymous=await get('/admin');const anonymousHtml=await anonymous.text();
    assert.ok(anonymous.headers.get('location')?.includes('/admin/login')||anonymousHtml.includes('/admin/login?session=expired'));
    assert.ok(!anonymousHtml.includes('Pessoa de teste'));assert.match(anonymous.headers.get('cache-control'),/no-store/);
    const foreign=await post({action:'login',email:'admin@example.test',password:'local-test-password'},undefined,'https://outside.example');assert.equal(foreign.status,403);
    assert.equal((await post({action:'login',email:'admin@example.test',password:'wrong'})).status,401);
    assert.equal((await post({action:'login',email:'other@example.test',password:'local-test-password'})).status,403);
    const nonadmin=await fixture.sessionFor(nonadminId);
    const denied=await (await get('/admin',nonadmin)).text();assert.match(denied,/Acesso não autorizado/);assert.ok(!denied.includes('Pessoa de teste'));
    const signedIn=await post({action:'login',email:'admin@example.test',password:'local-test-password'});
    assert.equal(signedIn.status,200);
    const cookieHeader=signedIn.headers.get('set-cookie');
    assert.match(cookieHeader,/HttpOnly/i);assert.match(cookieHeader,/Secure/i);assert.match(cookieHeader,/SameSite=strict/i);assert.match(cookieHeader,/Path=\/admin/i);
    const cookie=cookieHeader.split(';')[0];
    const before=fixture.calls.length;
    const allowed=await get('/admin',cookie);const html=await allowed.text();
    assert.match(html,/Pessoa de teste/);assert.match(html,/Visão geral/);assert.ok(!html.includes('test-service-role'));assert.ok(!html.includes(cookie.split('=')[1]));
    assert.ok(fixture.calls.slice(before).every(x=>x.method==='GET'));
    await fixture.db.query('update admin_users set active=false where user_id=$1',[adminId]);
    const inactive=await (await get('/admin',cookie)).text();assert.match(inactive,/Acesso não autorizado/);assert.ok(!inactive.includes('Pessoa de teste'));
    await fixture.db.query('update admin_users set active=true where user_id=$1',[adminId]);
    fixture.setFailure(true);const unavailable=await (await get('/admin',cookie)).text();assert.match(unavailable,/Painel indisponível/);assert.ok(!unavailable.includes('fixture failure'));fixture.setFailure(false);
    const logout=await post({action:'logout'},cookie);assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    // Simulate a still-valid Supabase JWT after sign-out: local digest must deny replay.
    fixture.tokens.set(cookie.split('=')[1],adminId);
    assert.ok(!(await (await get('/admin',cookie)).text()).includes('Pessoa de teste'));
    const expiring=await fixture.sessionFor(adminId);
    await fixture.db.query("update admin_sessions set expires_at=now()-interval '1 second'");
    assert.ok(!(await (await get('/admin',expiring)).text()).includes('Pessoa de teste'));
    assert.ok(!(await (await get('/admin','wedding_admin=forged')).text()).includes('Pessoa de teste'));
    for(const method of ['PUT','PATCH','DELETE']) assert.equal((await fetch(base+'/admin/session',{method})).status,405);
    const writesBefore=fixture.calls.filter(x=>x.method!=='GET').length;
    await fetch(base+'/admin',{method:'POST'});
    assert.equal(fixture.calls.filter(x=>x.method!=='GET').length,writesBefore);
    for(const path of ['/','/rsvp','/convite/invalid-local-invitation','/presentes']) {
      const response=await get(path);assert.equal(response.status,200,path);const text=await response.text();assert.ok(!text.includes('Pessoa de teste'));assert.ok(!text.includes('test-service-role'));
    }
    // Existing full RSVP HTTP suite, against the same isolated app/fixture.
    const regression=spawn(process.execPath,['--test','tests/http.test.mjs'],{windowsHide:true,stdio:'pipe',env:{...process.env,TEST_APP_URL:base,TEST_REQUEST_ORIGIN:base}});
    regression.stdout.resume();regression.stderr.resume();
    const result=await new Promise(r=>regression.on('exit',r));assert.equal(result,0,'existing RSVP HTTP suite passes');
    async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())await scan(path);else if(entry.name.endsWith('.js')){const text=await readFile(path,'utf8');assert.ok(!text.includes('test-service-role'));assert.ok(!text.includes('SUPABASE_SERVICE_ROLE_KEY'));}}}
    await scan('.next/static');assert.ok(!logs.includes('test-service-role'));
  } finally {child.kill();await new Promise(r=>child.once('exit',r));await fixture.close();}
});
