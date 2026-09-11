export type Guest = { id: string; name: string; type: 'adult' | 'child'; attendance_status: 'pending' | 'confirmed' | 'declined' };
export type Rsvp = { phone: string; dietary_restrictions: string; notes: string; submitted_at: string; updated_at: string };
export type Invitation = { id: string; name: string; active: boolean; is_demo: boolean; guests: Guest[]; rsvp: Rsvp | null; event: { venue: string; address: string; parking: string; valet: string } | null };
export type Submission = { guests: { id: string; status: 'confirmed' | 'declined' }[]; phone: string; dietary_restrictions: string; notes: string };

