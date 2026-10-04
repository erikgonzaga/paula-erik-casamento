import 'server-only';
import { requireAdmin } from '@/lib/admin/auth';
import { database } from '@/lib/supabase/server';
import type { AdminRsvpDetails } from '@/lib/admin/types';

export async function getAdminRsvpDetails(): Promise<AdminRsvpDetails> {
  const userId = await requireAdmin();
  return database<AdminRsvpDetails>(`rpc/get_admin_rsvp_details?p_user_id=${encodeURIComponent(userId)}`);
}
