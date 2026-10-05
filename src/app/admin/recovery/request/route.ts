import { NextResponse } from 'next/server';
import { assertSameOrigin, limit, privateHeaders, readBody } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';
import { requestRecovery, setVerifierCookie } from '@/lib/admin/recovery';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await limit(request, 'admin-recovery-request', 5);
    const body = await readBody(request) as Record<string, unknown> | null;
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return NextResponse.json({ message: 'Confira o e-mail informado.' }, { status: 400, headers: privateHeaders });
    let verifier: string | null = null;
    try { verifier = await requestRecovery(email); }
    catch { /* The response must not reveal whether this account exists. */ }
    const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
    if (verifier) setVerifierCookie(response, verifier);
    return response;
  } catch (error) {
    const status = error instanceof InvitationError ? error.status : 503;
    return NextResponse.json({ message: status === 429 ? 'Muitas tentativas. Aguarde dez minutos e tente novamente.' : 'Não foi possível processar a solicitação.' },
      { status, headers: privateHeaders });
  }
}
