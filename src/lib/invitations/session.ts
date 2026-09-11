import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { InvitationError } from './validation';

const cookieName = 'wedding_invitation';
const ttl = 60*60*24*7;
function secret() {
  const value=process.env.INVITATION_SESSION_SECRET;
  if (!value || value.length<32) throw new Error('Session not configured');
  return value;
}
function sign(payload:string) { return createHmac('sha256',secret()).update(payload).digest('base64url'); }
export async function setInvitationSession(groupId:string) {
  const payload=Buffer.from(JSON.stringify({groupId,expires:Date.now()+ttl*1000})).toString('base64url');
  (await cookies()).set(cookieName,`${payload}.${sign(payload)}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:ttl});
}
export async function getInvitationSession():Promise<string> {
  const value=(await cookies()).get(cookieName)?.value;
  const fail=()=>{throw new InvitationError(401,'Abra novamente seu convite ou informe seu código para continuar.');};
  if(!value || value.length>512) return fail();
  const parts=value.split('.');
  if(parts.length!==2) return fail();
  const signature=Buffer.from(sign(parts[0]));
  const candidate=Buffer.from(parts[1]);
  if(signature.length!==candidate.length || !timingSafeEqual(signature,candidate)) return fail();
  try {
    const decoded=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(typeof decoded.expires!=='number' || decoded.expires<Date.now() || typeof decoded.groupId!=='string'
      || !/^[0-9a-f-]{36}$/.test(decoded.groupId)) return fail();
    return decoded.groupId;
  } catch { return fail(); }
}
export async function clearInvitationSession() { (await cookies()).delete(cookieName); }

