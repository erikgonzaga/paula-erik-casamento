import 'server-only';
import { logDevelopmentDiagnostic, safeDiagnosticCode, safeDiagnosticText } from '@/lib/server-diagnostics';

export class DatabaseError extends Error {
  constructor(public diagnostic?: Record<string, string | number | undefined>) {
    super('Database temporarily unavailable');
  }
}
function debugDatabase(stage:string,details:Record<string,string|number>={}) {
  if(process.env.INVITATION_ACCESS_DEBUG==='1') console.info('[invitation-database]',{stage,...details});
}
async function databaseResponseError(response: Response, method: 'GET' | 'POST' | 'PATCH', path: string) {
  const body: unknown = await response.json().catch(() => null);
  const error = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const diagnostic = {
    operation: `${method} ${path.split('?')[0]}`,
    httpStatus: response.status,
    code: safeDiagnosticCode(error.code),
    message: safeDiagnosticText(error.message),
    details: safeDiagnosticText(error.details),
    hint: safeDiagnosticText(error.hint),
  };
  logDevelopmentDiagnostic('supabase', diagnostic);
  return new DatabaseError(diagnostic);
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
      throw await databaseResponseError(response, body === undefined ? 'GET' : 'POST', path);
    }
    return await response.json() as T;
  } catch(error) {
    if (error instanceof DatabaseError) throw error;
    debugDatabase('request_failed',{endpoint:path.split('?')[0],status:0});
    logDevelopmentDiagnostic('supabase', { operation: `${body === undefined ? 'GET' : 'POST'} ${path.split('?')[0]}`, code: 'network_or_parse_failure' });
    throw new DatabaseError();
  }
}

export async function databaseCommand(path: string, body: unknown): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    debugDatabase('configuration_missing');
    throw new DatabaseError();
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      debugDatabase('request_failed', { endpoint: path.split('?')[0], status: response.status });
      throw await databaseResponseError(response, 'POST', path);
    }
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    debugDatabase('request_failed', { endpoint: path.split('?')[0], status: 0 });
    logDevelopmentDiagnostic('supabase', { operation: `POST ${path.split('?')[0]}`, code: 'network_or_parse_failure' });
    throw new DatabaseError();
  }
}

export async function databaseInsert<T>(path: string, body: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    debugDatabase('configuration_missing');
    throw new DatabaseError();
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      debugDatabase('request_failed', { endpoint: path.split('?')[0], status: response.status });
      throw await databaseResponseError(response, 'POST', path);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    debugDatabase('request_failed', { endpoint: path.split('?')[0], status: 0 });
    logDevelopmentDiagnostic('supabase', { operation: `POST ${path.split('?')[0]}`, code: 'network_or_parse_failure' });
    throw new DatabaseError();
  }
}

export async function databaseUpdate<T>(path: string, body: unknown): Promise<T> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    debugDatabase('configuration_missing');
    throw new DatabaseError();
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      debugDatabase('request_failed', { endpoint: path.split('?')[0], status: response.status });
      throw await databaseResponseError(response, 'PATCH', path);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    debugDatabase('request_failed', { endpoint: path.split('?')[0], status: 0 });
    logDevelopmentDiagnostic('supabase', { operation: `PATCH ${path.split('?')[0]}`, code: 'network_or_parse_failure' });
    throw new DatabaseError();
  }
}
