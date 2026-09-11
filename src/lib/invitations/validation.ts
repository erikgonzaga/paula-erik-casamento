import type { Submission } from './types';
export class InvitationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validateSubmission(value: unknown): Submission {
  const fail = () => { throw new InvitationError(400, 'Confira a resposta de cada pessoa e os campos do formulário.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['guests','phone','dietary_restrictions','notes'].includes(k))) return fail();
  if (!Array.isArray(v.guests) || !v.guests.length || v.guests.length>100) return fail();
  const guests = v.guests.map(g => {
    if (!g || typeof g !== 'object' || Object.keys(g).some(k=>!['id','status'].includes(k))
      || typeof g.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g.id)
      || !['confirmed','declined'].includes(g.status)) return fail();
    return {id:g.id as string,status:g.status as 'confirmed'|'declined'};
  });
  if (new Set(guests.map(g=>g.id)).size !== guests.length) return fail();
  if (typeof v.phone!=='string' || v.phone.length>32 || !/^[+\d\s().-]+$/.test(v.phone)
    || v.phone.replace(/\D/g,'').length<8 || v.phone.replace(/\D/g,'').length>15) return fail();
  if (typeof v.dietary_restrictions!=='string' || v.dietary_restrictions.length>2000 || typeof v.notes!=='string' || v.notes.length>2000) return fail();
  return {guests,phone:v.phone.trim(),dietary_restrictions:v.dietary_restrictions.trim(),notes:v.notes.trim()};
}

