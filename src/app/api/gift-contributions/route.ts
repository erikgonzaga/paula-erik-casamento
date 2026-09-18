import { GiftContributionError } from '@/lib/gifts/contribution';
import { assertSameOrigin, limit, readBody } from '@/lib/invitations/http';
import { InvitationError } from '@/lib/invitations/validation';
import { createPendingGiftContribution } from '@/services/gift-contributions';

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
    return json(await createPendingGiftContribution(body), 201);
  } catch (error) {
    if (error instanceof GiftContributionError || error instanceof InvitationError) {
      return json({ message: error.message }, error.status);
    }
    return json({ message: 'Não foi possível registrar a contribuição agora. Tente novamente em alguns instantes.' }, 503);
  }
}
