import { loginAdmin, logoutAdmin, AdminError } from '@/lib/admin/auth';
import { assertSameOrigin, limit, readBody, privateHeaders } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readBody(request) as Record<string, unknown> | null;
    if (body?.action === 'logout') {
      await logoutAdmin();
    } else {
      await limit(request, 'admin-login', 10);
      if (body?.action !== 'login' || typeof body.email !== 'string' || typeof body.password !== 'string'
        || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
        || body.password.length < 1 || body.password.length > 1024) throw new AdminError(400);
      await loginAdmin(body.email.trim(), body.password);
    }
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    const status = error instanceof AdminError || error instanceof InvitationError ? error.status : 503;
    const message = status === 429 ? 'Muitas tentativas. Aguarde dez minutos e tente novamente.'
      : status === 503 ? 'Não foi possível acessar o painel agora. Tente novamente.'
      : 'Não foi possível entrar. Confira suas credenciais e sua autorização de administrador.';
    return Response.json({ message }, { status, headers: privateHeaders });
  }
}
