import 'server-only';
import { database } from '@/lib/supabase/server';
import { InvitationError } from '@/lib/invitations/validation';
import type { Invitation, Guest, Rsvp } from '@/lib/invitations/types';
type Group = Pick<Invitation,'id'|'name'|'active'|'is_demo'> & {slug:string};
const selection = 'id,name,slug,active,is_demo';
function validateGroup(group:Group|undefined) {
  if (!group) throw new InvitationError(404, 'Não encontramos este convite. Confira o código e tente novamente.');
  if (!group.active) throw new InvitationError(403, 'Este convite está inativo. Fale com Paula e Erik para receber ajuda.');
  return group;
}
async function find(field: 'code'|'slug'|'id', value: string): Promise<Group> {
  const rows = await database<Group[]>(`invitation_groups?select=${selection}&${field}=eq.${encodeURIComponent(value)}&limit=1`);
  return validateGroup(rows[0]);
}
export function findInvitationByCode(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{20,64}$/.test(normalizedCode)) throw new InvitationError(404,'Não encontramos este convite. Confira o código e tente novamente.');
  return database<Group[]>(`invitation_groups?select=${selection}&code=eq.${encodeURIComponent(normalizedCode)}&limit=1`).then(rows=>validateGroup(rows[0]));
}
export function findInvitationBySlug(slug: string) {
  if (!/^[a-z0-9-]{20,150}$/.test(slug)) throw new InvitationError(404,'Não encontramos este convite. Confira o link e tente novamente.');
  return find('slug',slug);
}
export async function getInvitation(id: string): Promise<Invitation> {
  const group = await find('id',id);
  const filter = `invitation_group_id=eq.${encodeURIComponent(id)}`;
  const [guests,rsvps,events] = await Promise.all([
    database<Guest[]>(`guests?select=id,name,type,phone,attendance_status&${filter}&active=eq.true&order=created_at.asc,id.asc`),
    database<Rsvp[]>(`rsvps?select=dietary_restrictions,notes,submitted_at,updated_at&${filter}&limit=1`),
    database<NonNullable<Invitation['event']>[]>('event_private_details?select=venue,address,reception_time,ceremony_time,parking,valet&id=eq.true&limit=1'),
  ]);
  return {id:group.id,name:group.name,active:group.active,is_demo:group.is_demo,guests,rsvp:rsvps[0]??null,event:events[0]??null};
}
