import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { database, databaseCommand } from '@/lib/supabase/server';

export class AdminError extends Error {
  constructor(public status: number) { super('Administrative access unavailable'); }
}
const cookieName = 'wedding_admin';
const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/admin' };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

async function authRequest(path: string, token?: string, body?: unknown) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AdminError(503);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new AdminError([400,401,403,422].includes(response.status) ? 401 : response.status === 429 ? 429 : 503);
    return response.status === 204 ? null : await response.json();
  } catch (error) {
    throw error instanceof AdminError ? error : new AdminError(503);
  }
}

async function activeAdmin(userId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new AdminError(401);
  const rows = await database<{ active: boolean }[]>(`admin_users?select=active&user_id=eq.${userId}&limit=1`);
  if (rows[0]?.active !== true) throw new AdminError(403);
}

export async function requireAdmin(): Promise<string> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || token.length > 3800) throw new AdminError(401);
  const user = await authRequest('user', token);
  if (typeof user?.id !== 'string') throw new AdminError(401);
  await activeAdmin(user.id);
  const sessions = await database<{ user_id: string; expires_at: string }[]>(`admin_sessions?select=user_id,expires_at&token_hash=eq.${hash(token)}&limit=1`);
  if (sessions[0]?.user_id !== user.id || !(Date.parse(sessions[0].expires_at) > Date.now())) throw new AdminError(401);
  return user.id;
}

export async function loginAdmin(email: string, password: string) {
  const session = await authRequest('token?grant_type=password', undefined, { email, password });
  const token = session?.access_token;
  if (typeof token !== 'string' || token.length > 3800 || !Number.isFinite(session.expires_in) || session.expires_in <= 0) throw new AdminError(503);
  // Validate with Auth, never trust a client-provided user or decoded JWT claims.
  const user = await authRequest('user', token);
  await activeAdmin(user?.id ?? '');
  const maxAge = Math.min(Math.floor(session.expires_in), 3600);
  await databaseCommand('admin_sessions', { token_hash: hash(token), user_id: user.id, expires_at: new Date(Date.now() + maxAge * 1000).toISOString() });
  (await cookies()).set(cookieName, token, { ...options, maxAge });
  // Refresh token is deliberately not persisted: re-login after at most one hour.
}

export async function logoutAdmin() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token && token.length <= 3800) {
    // Revoke local access first. Failure keeps the cookie so the user can retry.
    await databaseCommand('rpc/revoke_admin_session', { p_token_hash: hash(token) });
    try { await authRequest('logout?scope=local', token, {}); } catch { /* Local session is already revoked. */ }
  }
  jar.set(cookieName, '', { ...options, maxAge: 0 });
}
