import 'server-only';

import { createHash } from 'node:crypto';
import { WebhookSignatureValidator } from 'mercadopago';

export class MercadoPagoWebhookError extends Error {}

export function validateMercadoPagoWebhook(request: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id');
  const type = url.searchParams.get('type');
  const requestId = request.headers.get('x-request-id');
  const signature = request.headers.get('x-signature');
  if (!secret) {
    throw new MercadoPagoWebhookError('configuration');
  }
  if (type !== 'order' || !dataId || !/^[A-Za-z0-9_-]{1,255}$/.test(dataId)) {
    throw new MercadoPagoWebhookError('invalid_notification');
  }
  if (!requestId?.trim()) {
    throw new MercadoPagoWebhookError('invalid_notification');
  }
  const signatureDataId = dataId.toLowerCase();
  try {
    WebhookSignatureValidator.validate({
      xSignature: signature,
      xRequestId: requestId,
      dataId: signatureDataId,
      secret,
      toleranceSeconds: 300,
    });
  } catch {
    throw new MercadoPagoWebhookError('invalid_signature');
  }
  const eventKey = createHash('sha256')
    .update(`${requestId ?? ''}\n${dataId}\n${signature ?? ''}`, 'utf8')
    .digest('hex');
  return { dataId, eventKey };
}
