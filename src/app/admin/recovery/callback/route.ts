import { NextResponse } from 'next/server';
import { completeRecoveryCallback, recoveryOrigin, setRecoveryCookies, clearRecoveryCookies } from '@/lib/admin/recovery';
import { privateHeaders } from '@/lib/invitations/http';

export async function GET(request: Request) {
  let origin: string;
  try { origin = recoveryOrigin(); }
  catch { return new Response('Recovery unavailable', { status: 503, headers: privateHeaders }); }
  const invalid = () => {
    const response = NextResponse.redirect(`${origin}/admin/recovery/invalid`, { headers: privateHeaders });
    clearRecoveryCookies(response);
    return response;
  };
  // Next may normalize request.url to localhost behind a proxy; match the actual Host.
  if (request.headers.get('host') !== new URL(origin).host) return invalid();
  const code = new URL(request.url).searchParams.get('code');
  if (!code) return invalid();
  try {
    const result = await completeRecoveryCallback(code);
    const response = NextResponse.redirect(`${origin}/admin/recovery/password`, { headers: privateHeaders });
    setRecoveryCookies(response, result);
    return response;
  } catch { return invalid(); }
}
