import 'server-only';

export class DatabaseError extends Error {
  constructor() { super('Database temporarily unavailable'); }
}
export async function database<T>(path: string, body?: unknown): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DatabaseError();
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new DatabaseError();
    return await response.json() as T;
  } catch { throw new DatabaseError(); }
}

