import 'server-only';
import { database } from '@/lib/supabase/server';
import { InvitationError } from '@/lib/invitations/validation';
import type { Invitation, Guest, Rsvp } from '@/lib/invitations/types';
type Group = Pick<Invitation,'id'|'name'|'active'|'is_demo'>;
const selection = 'id,name,active,is_demo';
async function find(field: 'code'|'slug'|'id', value: string): Promise<Group> {
  const rows = await database<Group[]>(`invitation_groups?select=${selection}&${field}=eq.${encodeURIComponent(value)}&limit=1`);
  if (!rows[0]) throw new InvitationError(404, 'Não encontramos este convite. Confira o código e tente novamente.');
  if (!rows[0].active) throw new InvitationError(403, 'Este convite está inativo. Fale com Paula e Erik para receber ajuda.');
  return rows[0];
}
export function findInvitationByCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{20,64}$/.test(normalized)) throw new InvitationError(404,'Não encontramos este convite. Confira o código e tente novamente.');
  return find('code',normalized);
}
export function findInvitationBySlug(slug: string) {
  if (!/^[a-z0-9-]{20,150}$/.test(slug)) throw new InvitationError(404,'Não encontramos este convite. Confira o link e tente novamente.');
  return find('slug',slug);
}
export async function getInvitation(id: string): Promise<Invitation> {
  const group = await find('id',id);
  const filter = `invitation_group_id=eq.${encodeURIComponent(id)}`;
  const [guests,rsvps,events] = await Promise.all([
    database<Guest[]>(`guests?select=id,name,type,attendance_status&${filter}&active=eq.true&order=created_at.asc,id.asc`),
    database<Rsvp[]>(`rsvps?select=phone,dietary_restrictions,notes,submitted_at,updated_at&${filter}&limit=1`),
    database<NonNullable<Invitation['event']>[]>('event_private_details?select=venue,address,parking,valet&id=eq.true&limit=1'),
  ]);
  return {...group,guests,rsvp:rsvps[0]??null,event:events[0]??null};
}

