export type Guest = { id: string; name: string; type: 'adult' | 'child'; phone: string | null; attendance_status: 'pending' | 'confirmed' | 'declined' };
export type Rsvp = { dietary_restrictions: string; notes: string; submitted_at: string; updated_at: string };
export type Invitation = { id: string; name: string; active: boolean; is_demo: boolean; guests: Guest[]; rsvp: Rsvp | null; event: { venue: string; address: string; reception_time: string; ceremony_time: string; parking: string; valet: string } | null };
export type Submission = { guests: { id: string; status: 'confirmed' | 'declined'; phone: string | null }[]; dietary_restrictions: string; notes: string };
