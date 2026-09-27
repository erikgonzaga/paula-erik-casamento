import { reconcilePendingGiftPaymentsBatch } from '@/services/gift-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store, max-age=0' };

export async function POST(request: Request) {
  const secret = process.env.PAYMENT_RECONCILIATION_SECRET;
  if (!secret || secret.length < 32 || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 401, headers });
  }
  try {
    return Response.json(await reconcilePendingGiftPaymentsBatch(), { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
