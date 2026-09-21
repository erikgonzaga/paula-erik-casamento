import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';

export async function createDatabase(){
 const db=new PGlite();
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
 // Supabase supplies auth.users remotely; this minimal table is test-only.
 await db.exec('create schema auth; create table auth.users(id uuid primary key);');
 // Exercise explicit revocation even when the host supplies broad default grants.
 await db.exec('alter default privileges in schema public grant all on tables to service_role;');
 const migrationsDir=new URL('../supabase/migrations/',import.meta.url);
 for(const migration of (await readdir(migrationsDir)).filter(file=>file.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(migration,migrationsDir),'utf8'));
 await db.exec(await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
 return db;
}
export const ids={silva:'10000000-0000-4000-8000-000000000001',oliveira:'10000000-0000-4000-8000-000000000002'};
export const codes={silva:'6D88EECF1CDEA14190ABA9B50B63DBA3',oliveira:'A93E7062C84F15B9D620',inactive:'B41F893A620D75E9C038'};
export async function fixtureServer(db,port=54329){
 // TEST ADAPTER ONLY. The production app always connects to Supabase REST.
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers.apikey!=='test-service-role'){res.writeHead(401);res.end('{}');return;}
  try{
   const url=new URL(req.url,'http://localhost');
   let data;
   if(url.pathname.endsWith('/rpc/consume_invitation_limit')){
    let body='';for await(const chunk of req)body+=chunk;const p=JSON.parse(body);
    data=(await db.query('select public.consume_invitation_limit($1,$2,$3) as value',[p.p_bucket,p.p_limit,p.p_seconds])).rows[0].value;
   }else if(url.pathname.endsWith('/rpc/save_invitation_rsvp')){
    let body='';for await(const chunk of req)body+=chunk;const p=JSON.parse(body);
    data=(await db.query('select public.save_invitation_rsvp($1,$2::jsonb,$3,$4,$5) as value',[p.p_group_id,JSON.stringify(p.p_guests),p.p_phone,p.p_dietary,p.p_notes])).rows[0].value;
   }else{
    const table=url.pathname.split('/').pop();
    const fields={
     invitation_groups:'id,name,slug,active,is_demo',guests:'id,name,type,phone,attendance_status',
     rsvps:'dietary_restrictions,notes,submitted_at,updated_at',event_private_details:'venue,address,reception_time,ceremony_time,parking,valet',
    };
    if(!fields[table]||url.searchParams.get('select')!==fields[table])throw Error('invalid query');
    const params=[];const where=[];
    for(const [key,value] of url.searchParams){
     if(['select','limit','order'].includes(key))continue;
     if(!['id','code','slug','invitation_group_id','active'].includes(key)||!value.startsWith('eq.'))throw Error('invalid filter');
     params.push(value.slice(3));where.push(key+'=$'+params.length);
    }
    data=(await db.query('select '+fields[table]+' from public.'+table+(where.length?' where '+where.join(' and '):'')+(table==='guests'?' order by created_at,id':''),params)).rows;
   }
   res.end(JSON.stringify(data));
  }catch{res.writeHead(400);res.end(JSON.stringify({message:'fixture database rejected query'}));}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return server;
}
