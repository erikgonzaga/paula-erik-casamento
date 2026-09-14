import { findInvitationByCode, findInvitationBySlug } from '@/services/invitations';
import { setInvitationSession, clearInvitationSession } from '@/lib/invitations/session';
import { assertSameOrigin, failure, json, limit, readBody } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';
export const runtime='nodejs';
function debugAccess(stage:string,details:Record<string,string|number|boolean>={}) {
  if(process.env.INVITATION_ACCESS_DEBUG==='1') console.info('[invitation-access]',{stage,...details});
}
export async function POST(request:Request) {
  let stage='request_received';
  try {
    debugAccess(stage,{has_origin:Boolean(request.headers.get('origin'))});
    assertSameOrigin(request);
    stage='origin_validated';debugAccess(stage);
    const body=await readBody(request) as {code?:unknown;slug?:unknown};
    await limit(request,'access');
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1) throw new InvitationError(400,'Informe o código do seu convite.');
    const code=typeof body.code==='string'?body.code:null;
    const normalizedCode=code?.trim().toUpperCase()??null;
    const usingCode=normalizedCode!==null;
    if(usingCode) {
      stage='code_normalized';debugAccess(stage,{length:normalizedCode.length,valid_format:/^[A-Z0-9]{20,64}$/.test(normalizedCode)});
    }
    stage='group_lookup';
    const group=usingCode ? await findInvitationByCode(normalizedCode)
      : typeof body.slug==='string' ? await findInvitationBySlug(body.slug) : null;
    if(!group) throw new InvitationError(400,'Informe o código do seu convite.');
    stage='group_found';debugAccess(stage,{access:usingCode?'code':'slug'});
    await setInvitationSession(group.id);
    stage='session_created';debugAccess(stage,{access:usingCode?'code':'slug'});
    stage='redirect_ready';debugAccess(stage,{access:usingCode?'code':'slug'});
    return json({ok:true,slug:group.slug});
  } catch(error) {
    if(stage==='group_lookup' && error instanceof InvitationError && error.status===404) debugAccess('group_not_found');
    debugAccess('failed',{stage,status:error instanceof InvitationError?error.status:503,error_type:error instanceof Error?error.constructor.name:'unknown'});
    return failure(error);
  }
}
export async function DELETE(request:Request) {
  try {assertSameOrigin(request);await clearInvitationSession();return json({ok:true});} catch(error){return failure(error);}
}
