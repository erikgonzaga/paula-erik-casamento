import { findInvitationByCode, findInvitationBySlug } from '@/services/invitations';
import { setInvitationSession, clearInvitationSession } from '@/lib/invitations/session';
import { assertSameOrigin, failure, json, limit, readBody } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';
export const runtime='nodejs';
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const body=await readBody(request) as {code?:unknown;slug?:unknown};
    await limit(request,'access');
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1) throw new InvitationError(400,'Informe o código do seu convite.');
    const group=typeof body.code==='string' ? await findInvitationByCode(body.code)
      : typeof body.slug==='string' ? await findInvitationBySlug(body.slug) : null;
    if(!group) throw new InvitationError(400,'Informe o código do seu convite.');
    await setInvitationSession(group.id);
    return json({ok:true});
  } catch(error) {return failure(error);}
}
export async function DELETE(request:Request) {
  try {assertSameOrigin(request);await clearInvitationSession();return json({ok:true});} catch(error){return failure(error);}
}

