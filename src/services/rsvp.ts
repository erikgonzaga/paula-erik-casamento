import 'server-only';
import { database } from '@/lib/supabase/server';
import { getInvitation } from './invitations';
import { InvitationError, validateSubmission } from '@/lib/invitations/validation';
export async function submitRsvp(groupId: string, value: unknown) {
  const submission = validateSubmission(value);
  const invitation = await getInvitation(groupId);
  if (submission.guests.length !== invitation.guests.length || submission.guests.some(g=>!invitation.guests.some(i=>i.id===g.id))) {
    throw new InvitationError(400,'As pessoas deste convite mudaram. Reabra o convite antes de responder.');
  }
  return database<{updated:boolean;submitted_at:string;updated_at:string}>('rpc/save_invitation_rsvp', {
    p_group_id:groupId,p_guests:submission.guests,p_phone:submission.phone,p_dietary:submission.dietary_restrictions,p_notes:submission.notes,
  });
}
export const updateRsvp = submitRsvp;

