import { getInvitationSession } from '@/lib/invitations/session';
import { assertSameOrigin, failure, json, limit, readBody } from '@/lib/invitations/http';
import { getInvitation } from '@/services/invitations';
import { submitRsvp } from '@/services/rsvp';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {const id=await getInvitationSession();await limit(request,'read',120);return json(await getInvitation(id));}catch(error){return failure(error);}
}
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const id=await getInvitationSession();
    await limit(request,'save',30);
    const result=await submitRsvp(id,await readBody(request));
    return json(result);
  }catch(error){return failure(error);}
}

