import 'server-only';
import { requireAdmin } from '@/lib/admin/auth';
import { database } from '@/lib/supabase/server';
import type { Dashboard } from '@/lib/admin/types';

export async function getAdminDashboard(): Promise<Dashboard> {
  const userId = await requireAdmin();
  return database<Dashboard>(`rpc/get_admin_dashboard?p_user_id=${encodeURIComponent(userId)}`);
}
