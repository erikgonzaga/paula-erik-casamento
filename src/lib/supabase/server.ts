import 'server-only';

export class DatabaseError extends Error {
  constructor() { super('Database temporarily unavailable'); }
}
function debugDatabase(stage:string,details:Record<string,string|number>={}) {
  if(process.env.INVITATION_ACCESS_DEBUG==='1') console.info('[invitation-database]',{stage,...details});
}
export async function database<T>(path: string, body?: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    debugDatabase('configuration_missing');
    throw new DatabaseError();
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      debugDatabase('request_failed',{endpoint:path.split('?')[0],status:response.status});
      throw new DatabaseError();
    }
    return await response.json() as T;
  } catch(error) {
    if(!(error instanceof DatabaseError)) debugDatabase('request_failed',{endpoint:path.split('?')[0],status:0});
    throw new DatabaseError();
  }
}
