import 'server-only';

export class PublicDatabaseError extends Error {
  constructor() {
    super('Public database temporarily unavailable');
  }
}

export async function publicDatabase<T>(path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) throw new PublicDatabaseError();

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new PublicDatabaseError();
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof PublicDatabaseError) throw error;
    throw new PublicDatabaseError();
  }
}
