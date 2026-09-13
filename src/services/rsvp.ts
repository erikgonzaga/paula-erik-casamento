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
  if (submission.guests.some(guest=>{
    const person=invitation.guests.find(item=>item.id===guest.id);
    return (person?.type==='adult' && !guest.phone) || (person?.type==='child' && guest.phone!==null);
  })) throw new InvitationError(400,'Informe o telefone de cada convidado adulto.');
  const legacyPhone=submission.guests.find(guest=>guest.phone)?.phone??null;
  return database<{updated:boolean;submitted_at:string;updated_at:string}>('rpc/save_invitation_rsvp', {
    p_group_id:groupId,p_guests:submission.guests,p_phone:legacyPhone,p_dietary:submission.dietary_restrictions,p_notes:submission.notes,
  });
}
export const updateRsvp = submitRsvp;
