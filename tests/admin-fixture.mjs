import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createDatabase, fixtureServer } from './database-fixture.mjs';

export const adminId='90000000-0000-4000-8000-000000000001';
export const nonadminId='90000000-0000-4000-8000-000000000002';
export async function seedAdmin(db) {
  await db.query('insert into auth.users(id) values ($1),($2)',[adminId,nonadminId]);
  await db.query('insert into admin_users(user_id) values ($1)',[adminId]);
  const giftIds=(await db.query(`insert into gifts(name,slug,category,funding_mode,target_amount,gift_type,allow_multiple) values
    ('Meta local','meta-local','party','goal',100,'regular',true),
    ('Boletos locais','boletos-locais','party','open',null,'regular',true),
    ('Insano local','insano-local','insanos','fixed',25,'insanos',true),
    ('Meta histórica','meta-historica','house','goal',200,'regular',true) returning id`)).rows.map(r=>r.id);
  for (const [index,amount,status] of [[0,40,'confirmed'],[0,10,'pending'],[0,5,'expired'],[1,300,'confirmed'],[2,25,'confirmed'],[3,50,'confirmed'],[1,2,'failed'],[1,2,'cancelled']]) {
    await db.query(`insert into gift_contributions(gift_id,contributor_name,amount,payment_status,payment_method,confirmed_at,vest_name,idempotency_key,request_fingerprint)
    values ($1,'Pessoa de teste',$2,$3,'pix',case when $3='confirmed' then now() else null end,'Colete de teste',gen_random_uuid(),repeat('a',64))`,[giftIds[index],amount,status]);
  }
  await db.query('update gifts set active=false where id=$1',[giftIds[3]]);
  const group=(await db.query(`insert into invitation_groups(name,slug,code) values ('Grupo de teste',$1,$2) returning id`,[randomUUID(),randomUUID().replaceAll('-','').toUpperCase()])).rows[0].id;
  await db.query(`insert into guests(invitation_group_id,name,type,attendance_status,active) values
    ($1,'Adulto 1','adult','confirmed',true),($1,'Criança','child','pending',true),
    ($1,'Adulto 2','adult','declined',true),($1,'Inativo','adult','pending',false)`,[group]);
  await db.query('insert into rsvps(invitation_group_id) values ($1)',[group]);
  return giftIds;
}

// Loopback only. Synthetic Auth responses + real migrations/SQL in memory.
export async function adminFixture(port=54331) {
  const db=await createDatabase(); await seedAdmin(db);
  const fallback=await fixtureServer(db,0);
  const fallbackUrl=`http://127.0.0.1:${fallback.address().port}`;
  const tokens=new Map(); const calls=[]; let failDashboard=false;
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      calls.push({method:req.method,path:url.pathname});
      let raw='';for await(const chunk of req) raw+=chunk;
      const body=raw?JSON.parse(raw):{};
      let result;
      if(url.pathname.startsWith('/auth/v1/')) {
        if(req.headers.apikey!=='test-anon-key') throw Error('key');
        if(url.pathname.endsWith('/token')) {
          if(body.password!=='local-test-password') {res.writeHead(400);res.end('{}');return;}
          const access_token=`synthetic-${randomUUID()}`;
          const id=body.email==='admin@example.test'?adminId:nonadminId;
          tokens.set(access_token,id);result={access_token,expires_in:3600,user:{id}};
        } else {
          const token=req.headers.authorization?.replace('Bearer ','');
          if(!tokens.has(token)){res.writeHead(401);res.end('{}');return;}
          if(url.pathname.endsWith('/logout')) {tokens.delete(token);res.writeHead(204);res.end();return;}
          result={id:tokens.get(token)};
        }
      } else if(url.pathname.endsWith('/admin_users')) {
        if(req.headers.apikey!=='test-service-role') throw Error('key');
        result=(await db.query('select active from admin_users where user_id=$1',[url.searchParams.get('user_id').slice(3)])).rows;
      } else if(url.pathname.endsWith('/admin_sessions')) {
        if(req.headers.apikey!=='test-service-role') throw Error('key');
        if(req.method==='POST') {await db.query('insert into admin_sessions(token_hash,user_id,expires_at) values ($1,$2,$3)',[body.token_hash,body.user_id,body.expires_at]);res.writeHead(201);res.end();return;}
        result=(await db.query('select user_id,expires_at from admin_sessions where token_hash=$1',[url.searchParams.get('token_hash').slice(3)])).rows;
      } else if(url.pathname.endsWith('/rpc/revoke_admin_session')) {
        if(req.headers.apikey!=='test-service-role') throw Error('key');
        await db.query('select revoke_admin_session($1)',[body.p_token_hash]);res.writeHead(204);res.end();return;
      } else if(url.pathname.endsWith('/rpc/get_admin_dashboard')) {
        if(failDashboard || req.headers.apikey!=='test-service-role') throw Error('unavailable');
        result=(await db.query('select get_admin_dashboard($1) as data',[url.searchParams.get('p_user_id')])).rows[0].data;
      } else if(url.pathname.endsWith('/gifts') || url.pathname.endsWith('/rpc/get_gift_progress')) {
        if(!['test-anon-key','test-service-role'].includes(req.headers.apikey)) throw Error('key');
        result=(await db.query(url.pathname.endsWith('/gifts')?'select * from gifts where active order by display_order,id':'select * from get_gift_progress()')).rows;
      } else {
        const response=await fetch(fallbackUrl+req.url,{method:req.method,headers:req.headers,body:req.method==='GET'?undefined:raw});
        res.writeHead(response.status);res.end(await response.text());return;
      }
      res.end(JSON.stringify(result));
    }catch{res.writeHead(503);res.end(JSON.stringify({message:'fixture failure'}));}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {db,server,calls,tokens,setFailure(value){failDashboard=value;},async close(){await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>fallback.close(r))]);await db.close();},
    async sessionFor(id){const token=`synthetic-${randomUUID()}`;tokens.set(token,id);if(id===adminId) await db.query('insert into admin_sessions(token_hash,user_id,expires_at) values ($1,$2,now()+interval \'1 hour\')',[createHash('sha256').update(token).digest('hex'),id]);return `wedding_admin=${token}`;}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){await adminFixture();console.log('Admin fixture on loopback :54331 (synthetic data only)');}
