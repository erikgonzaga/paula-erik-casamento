import { MercadoPagoWebhookError, validateMercadoPagoWebhook } from '@/lib/payments/mercado-pago/webhook';
import { processMercadoPagoOrder } from '@/services/gift-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' };

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > 65536) return new Response(null, { status: 413, headers });
    const notification = validateMercadoPagoWebhook(request);
    await processMercadoPagoOrder(notification.dataId, notification.eventKey);
    return new Response(null, { status: 200, headers });
  } catch (error) {
    if (error instanceof MercadoPagoWebhookError) return new Response(null, { status: 401, headers });
    return new Response(null, { status: 503, headers });
  }
}
