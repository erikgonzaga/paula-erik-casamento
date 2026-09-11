import 'server-only';
import { createHmac } from 'node:crypto';
import { database } from '@/lib/supabase/server';
import { InvitationError } from './validation';
export const privateHeaders = {'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Vary':'Cookie'};
export function json(value:unknown,status=200) { return Response.json(value,{status,headers:privateHeaders}); }
export function failure(error:unknown) {
  if(error instanceof InvitationError) return json({message:error.message},error.status);
  // Do not send database errors, credentials or request payloads to the visitor or logs.
  return json({message:'Não conseguimos abrir ou salvar seu convite agora. Tente novamente em alguns instantes.'},503);
}
export function assertSameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  const allowed=process.env.APP_ORIGIN || new URL(request.url).origin;
  const local=process.env.NODE_ENV!=='production' && origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  if (!origin || (origin!==allowed && !local)) throw new InvitationError(403,'Reabra esta página para continuar.');
}
export async function readBody(request:Request):Promise<unknown> {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new InvitationError(400,'Não foi possível ler o formulário.');
  const reader=request.body?.getReader();
  if(!reader) throw new InvitationError(400,'Confira o formulário.');
  let size=0; const chunks:Uint8Array[]=[];
  while(true) {
    const result=await reader.read(); if(result.done) break;
    size+=result.value.byteLength;
    if(size>16384) {await reader.cancel();throw new InvitationError(413,'O formulário está muito longo. Reduza suas observações.');}
    chunks.push(result.value);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InvitationError(400,'Confira o formulário.');}
}
export async function limit(request:Request,scope:string,maximum=12) {
  const key=process.env.INVITATION_SESSION_SECRET;
  if(!key || key.length<32) throw new Error('Rate limit not configured');
  // Vercel overwrites this header. Never trust arbitrary x-forwarded-for supplied by a client.
  const ip=process.env.VERCEL==='1' ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown' : 'local-shared';
  const bucket=createHmac('sha256',key).update(scope+':'+ip).digest('hex');
  const allowed=await database<boolean>('rpc/consume_invitation_limit',{p_bucket:bucket,p_limit:maximum,p_seconds:600});
  if(!allowed) throw new InvitationError(429,'Muitas tentativas em pouco tempo. Aguarde dez minutos e tente novamente.');
}

