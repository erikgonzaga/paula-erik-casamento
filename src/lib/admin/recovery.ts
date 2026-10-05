import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { database, databaseCommand } from '@/lib/supabase/server';

export class RecoveryError extends Error {
  constructor(public status: number) { super('Administrative recovery unavailable'); }
}

export const verifierCookie = 'wedding_admin_recovery_verifier';
export const sessionCookie = 'wedding_admin_recovery';
export const authCookie = 'wedding_admin_recovery_auth';
const cookiePath = '/admin/recovery';
const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const, path: cookiePath,
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const validToken = (value: string | undefined) => Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
const validUserId = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function recoveryOrigin() {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new RecoveryError(503);
  try {
    const url = new URL(configured);
    const localOrigin = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (configured !== url.origin || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !localOrigin))
      throw new RecoveryError(503);
    return url.origin;
  } catch { throw new RecoveryError(503); }
}

function authBase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new RecoveryError(503);
  return { url: url.replace(/\/$/, ''), key };
}

async function authRequest(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown, token?: string) {
  const { url, key } = authBase();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/${path}`, {
      method, headers: { apikey: key, 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
  } catch { throw new RecoveryError(503); }
  if (!response.ok) throw new RecoveryError([400, 401, 403, 404, 422].includes(response.status) ? 401 : 503);
  if (response.status === 204) return null;
  try { return await response.json() as Record<string, unknown>; }
  catch { throw new RecoveryError(503); }
}

async function activeAdmin(userId: string) {
  const rows = await database<{ active: boolean }[]>(
    `admin_users?select=active&user_id=eq.${userId}&limit=1`);
  if (rows[0]?.active !== true) throw new RecoveryError(401);
}

export async function requestRecovery(email: string) {
  const verifier = randomToken();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectTo = `${recoveryOrigin()}/admin/recovery/callback`;
  await authRequest(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, 'POST', {
    email, code_challenge: challenge, code_challenge_method: 's256',
  });
  return verifier;
}

export function setVerifierCookie(response: NextResponse, verifier: string) {
  response.cookies.set(verifierCookie, verifier, { ...cookieOptions, maxAge: 15 * 60 });
}

export async function completeRecoveryCallback(code: string) {
  const verifier = (await cookies()).get(verifierCookie)?.value;
  if (!validToken(verifier) || code.length < 8 || code.length > 2048) throw new RecoveryError(401);
  const session = await authRequest('token?grant_type=pkce', 'POST', {
    auth_code: code, code_verifier: verifier,
  });
  const accessToken = session?.access_token;
  const expiresIn = session?.expires_in;
  if (typeof accessToken !== 'string' || accessToken.length > 3800 ||
      typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 30)
    throw new RecoveryError(401);
  const user = await authRequest('user', 'GET', undefined, accessToken);
  if (!validUserId(user?.id) || (session?.user &&
      (typeof session.user !== 'object' || (session.user as { id?: unknown }).id !== user.id)))
    throw new RecoveryError(401);
  await activeAdmin(user.id);
  const token = randomToken();
  const maxAge = Math.min(10 * 60, Math.floor(expiresIn) - 30);
  await databaseCommand('rpc/register_admin_password_recovery_session', {
    p_token_hash: digest(token), p_user_id: user.id,
    p_expires_at: new Date(Date.now() + maxAge * 1000).toISOString(),
  });
  return { token, accessToken, maxAge };
}

export function setRecoveryCookies(response: NextResponse, result: {
  token: string; accessToken: string; maxAge: number;
}) {
  response.cookies.set(sessionCookie, result.token, { ...cookieOptions, maxAge: result.maxAge });
  response.cookies.set(authCookie, result.accessToken, { ...cookieOptions, maxAge: result.maxAge });
  response.cookies.set(verifierCookie, '', { ...cookieOptions, maxAge: 0 });
}

export function clearRecoveryCookies(response: NextResponse) {
  for (const name of [verifierCookie, sessionCookie, authCookie])
    response.cookies.set(name, '', { ...cookieOptions, maxAge: 0 });
}

export async function hasRecoverySession() {
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (!validToken(token) || !jar.get(authCookie)?.value) return false;
  const rows = await database<{ user_id: string }[]>(
    `admin_password_recovery_sessions?select=user_id&token_hash=eq.${digest(token!)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  return rows.length === 1;
}

export function validRecoveryPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128 &&
    /\p{Lu}/u.test(password) && /\p{Ll}/u.test(password) && /\p{N}/u.test(password) &&
    /[^\p{L}\p{N}\s]/u.test(password);
}

export async function updateRecoveryPassword(password: string) {
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  const accessToken = jar.get(authCookie)?.value;
  if (!validToken(token) || !accessToken || accessToken.length > 3800) throw new RecoveryError(401);
  const user = await authRequest('user', 'GET', undefined, accessToken);
  if (!validUserId(user?.id)) throw new RecoveryError(401);
  await activeAdmin(user.id);
  const consumed = await database<boolean>('rpc/consume_admin_password_recovery_session', {
    p_token_hash: digest(token!), p_user_id: user.id,
  });
  if (consumed !== true) throw new RecoveryError(401);
  await authRequest('user', 'PUT', { password }, accessToken);
  await authRequest('logout?scope=global', 'POST', {}, accessToken);
}
