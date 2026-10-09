import { GiftContributionError } from '@/lib/gifts/contribution';
import { assertSameOrigin, limit, readBody } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';
import { createGiftPayment } from '@/services/gift-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readBody(request);
    await limit(request, 'gift-contribution', 10);
    // Backend stage 2 only: card checkout is not enabled for public guests yet.
    if (body && typeof body === 'object' && 'payment_method' in body && body.payment_method === 'credit_card') {
      throw new GiftContributionError(409, 'credit_card_unavailable', 'Pagamento por cartão ainda não está disponível.');
    }
    return json(await createGiftPayment(body), 201);
  } catch (error) {
    if (error instanceof GiftContributionError || error instanceof InvitationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: 'Não foi possível registrar a contribuição agora. Tente novamente em alguns instantes.' }, 503);
  }
}
