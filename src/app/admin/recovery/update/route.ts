import { NextResponse } from 'next/server';
import { assertSameOrigin, limit, privateHeaders, readBody } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';
import { clearRecoveryCookies, RecoveryError, updateRecoveryPassword, validRecoveryPassword } from '@/lib/admin/recovery';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await limit(request, 'admin-recovery-update', 8);
    const body = await readBody(request) as Record<string, unknown> | null;
    if (!validRecoveryPassword(body?.password) || body?.confirmation !== body.password)
      return NextResponse.json({ message: 'Senha inválida.' }, { status: 400, headers: privateHeaders });
    await updateRecoveryPassword(body.password);
    const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
    clearRecoveryCookies(response);
    return response;
  } catch (error) {
    const status = error instanceof RecoveryError || error instanceof InvitationError ? error.status : 503;
    const response = NextResponse.json({ message: status === 429 ? 'Muitas tentativas. Aguarde dez minutos e tente novamente.'
      : status === 401 ? 'Link inválido ou expirado.' : 'Não foi possível concluir a alteração.' },
      { status, headers: privateHeaders });
    if (status === 401) clearRecoveryCookies(response);
    return response;
  }
}
