import 'server-only';

import { createHash } from 'node:crypto';
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago';
import { logDevelopmentDiagnostic, safeDiagnosticCode } from '@/lib/server-diagnostics';

export class MercadoPagoWebhookError extends Error {}

export function validateMercadoPagoWebhook(request: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id');
  const type = url.searchParams.get('type');
  const requestId = request.headers.get('x-request-id');
  const signature = request.headers.get('x-signature');
  const signatureParts = signature?.split(',').map(part => part.trim().split('=', 1)[0]?.toLowerCase()) ?? [];
  const timestamp = signature?.match(/(?:^|,)\s*ts=(\d+)/i)?.[1];
  const diagnostic = (failureReason: string) => {
    const fields = {
      operation: 'webhook-signature-validation',
      hasXSignature: signature ? 'true' : 'false',
      hasXRequestId: requestId ? 'true' : 'false',
      hasWebhookSecret: secret ? 'true' : 'false',
      dataId: dataId && /^[A-Za-z0-9_-]{1,255}$/.test(dataId) ? dataId : undefined,
      requestIdLength: requestId?.length,
      requestIdTrimChanged: requestId ? (requestId !== requestId.trim() ? 'true' : 'false') : undefined,
      type: safeDiagnosticCode(type),
      hasExternalReference: url.searchParams.has('data.external_reference') ? 'true' : 'false',
      hasTimestampPart: signatureParts.includes('ts') ? 'true' : 'false',
      timestampDigits: timestamp?.length,
      hasV1Part: signatureParts.includes('v1') ? 'true' : 'false',
      validationResult: 'false',
      sdkValidationResult: 'false',
      failureReason,
    };
    if (process.env.NODE_ENV === 'development') logDevelopmentDiagnostic('mercado-pago', fields);
    else if (process.env.PAYMENTS_ENVIRONMENT === 'test') {
      console.error('[payment-diagnostic:mercado-pago]', fields);
    }
  };
  if (!secret) {
    diagnostic('configuration');
    throw new MercadoPagoWebhookError('configuration');
  }
  if (type !== 'order' || !dataId || !/^[A-Za-z0-9_-]{1,255}$/.test(dataId)) {
    diagnostic('invalid_notification');
    throw new MercadoPagoWebhookError('invalid_notification');
  }
  if (!requestId?.trim()) {
    diagnostic('invalid_notification');
    throw new MercadoPagoWebhookError('invalid_notification');
  }
  try {
    WebhookSignatureValidator.validate({
      xSignature: signature,
      xRequestId: requestId,
      dataId,
      secret,
      toleranceSeconds: 300,
    });
  } catch (error) {
    const reason = error instanceof InvalidWebhookSignatureError ? error.reason : 'validation_error';
    diagnostic(reason);
    throw new MercadoPagoWebhookError('invalid_signature');
  }
  const eventKey = createHash('sha256')
    .update(`${requestId ?? ''}\n${dataId}\n${signature ?? ''}`, 'utf8')
    .digest('hex');
  return { dataId, eventKey };
}
