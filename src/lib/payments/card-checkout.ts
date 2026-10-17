import { parseContributionPayment, type CreditCardInput } from './contracts';

// Explicit application rejections are not transport failures. Project only
// known codes/messages; never render arbitrary provider/database error bodies.
const submissionMessages: Record<string, string> = {
  goal_reached: 'Esse presente acabou de atingir a meta ❤️',
  gift_unavailable: 'Este presente não está mais disponível.',
  credit_card_unavailable: 'Pagamento por cartão ainda não está disponível.',
  invalid_form: 'Confira os dados da contribuição.',
  invalid_phone: 'Informe um WhatsApp válido com DDD.',
  invalid_amount: 'Informe um valor válido para a contribuição.',
  invalid_name: 'Informe seu nome.',
  invalid_email: 'Informe um e-mail válido.',
  invalid_payment: 'Confira os dados do pagamento.',
  vest_name_required: 'Informe o nome do colete para este Presente Insano.',
  idempotency_conflict: 'Esta tentativa já foi utilizada com outros dados. Consulte a tentativa existente antes de qualquer novo envio.',
  payment_environment_mismatch: 'Esta tentativa não está disponível neste ambiente.',
  payment_expired: 'Esta tentativa expirou. Consulte o pagamento antes de iniciar outra contribuição.',
};
export function parseCardSubmissionRejection(status: number, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { code, message } = value as Record<string, unknown>;
  if (typeof code !== 'string' || typeof message !== 'string' || !Object.hasOwn(submissionMessages, code)) return null;
  const validation = ['invalid_form', 'invalid_phone', 'invalid_amount', 'invalid_name', 'invalid_email', 'invalid_payment', 'vest_name_required'].includes(code);
  if (!(validation ? status === 400 : status === 409 || (status === 404 && code === 'gift_unavailable'))) return null;
  return { code, message: submissionMessages[code], validation,
    // Only the availability 409s follow an absent existing-key lookup.
    // The gift 404/400s run before that lookup and cannot clear an old key.
    absentContribution: status === 409 && ['goal_reached', 'gift_unavailable'].includes(code) };
}

export type CheckoutResult = {
  payment_status: 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired';
  payment: null | {
    status: 'creating' | 'investigating' | 'waiting' | 'action_required' | 'confirmed' | 'expired' | 'failed' | 'cancelled';
    qr_code: string | null;
    qr_code_base64: string | null;
    ticket_url: string | null;
    expires_at: string;
    challenge?: { url: string };
  };
};

export function brickPaymentInput(data: unknown, additional: unknown, deviceId?: unknown): CreditCardInput {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !additional || typeof additional !== 'object' ||
      (additional as { paymentTypeId?: unknown }).paymentTypeId !== 'credit_card') throw new Error('invalid_card_data');
  const input = data as Record<string, unknown>;
  // Project only tokenized fields. Never spread the Brick payload into our request.
  const payer = input.payer as { identification?: unknown } | undefined;
  const payment = parseContributionPayment({ payment_method: 'credit_card', card_token: input.token,
    payment_method_id: input.payment_method_id, installments: input.installments,
    ...(payer?.identification ? { payer: { identification: payer.identification } } : {}),
    ...(deviceId ? { device_id: deviceId } : {}),
  });
  if (payment.payment_method !== 'credit_card') throw new Error('invalid_card_data');
  return payment;
}

export function cardCheckoutAmount(value: unknown): number {
  let decimal = String(value ?? '').trim().replace(/^R\$\s*/i, '');
  if (decimal.includes(',')) {
    if (!/^\d+(?:,\d{1,2})?$/.test(decimal) && !/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(decimal)) throw new Error('invalid_amount');
    decimal = decimal.replace(/\./g, '').replace(',', '.');
  }
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(decimal)) throw new Error('invalid_amount');
  const [whole, fraction = ''] = decimal.split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  if (cents <= BigInt(0) || cents > BigInt('9999999999')) throw new Error('invalid_amount');
  return Number(cents) / 100;
}

// The provider does not publish a fixed host allowlist. Trust only the HTTPS
// URL returned by our authenticated backend, then pin message origin + source.
export function safeChallengeUrl(value: unknown, parentOrigin?: string): string | null {
  if (typeof value !== 'string' || !value || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.origin !== parentOrigin ? url.href : null;
  } catch { return null; }
}

export function completedChallenge(event: MessageEvent, frame: Window | null, url: string) {
  return frame !== null && event.source === frame && event.origin === new URL(url).origin &&
    event.data !== null && typeof event.data === 'object' && event.data.status === 'COMPLETE';
}

export function parseCardCheckoutResult(value: unknown): CheckoutResult {
  if (!value || typeof value !== 'object') throw new Error('invalid_payment_response');
  const input = value as CheckoutResult;
  if (!['pending', 'confirmed', 'cancelled', 'failed', 'expired'].includes(input.payment_status)) throw new Error('invalid_payment_response');
  if (input.payment === null) return { payment_status: input.payment_status, payment: null };
  if (!input.payment || !['creating', 'investigating', 'waiting', 'action_required', 'confirmed', 'expired', 'failed', 'cancelled'].includes(input.payment.status)) throw new Error('invalid_payment_response');
  const challenge = safeChallengeUrl(input.payment.challenge?.url);
  return { payment_status: input.payment_status, payment: { status: input.payment.status,
    expires_at: typeof input.payment.expires_at === 'string' ? input.payment.expires_at : '',
    qr_code: null, qr_code_base64: null, ticket_url: null,
    ...(input.payment_status === 'pending' && challenge ? { challenge: { url: challenge } } : {}),
  } };
}

// In-memory UI cache only; durable opaque references live in card-operation-storage.
// No token/document/device ID/challenge URL belongs in this registry.
export type CardContributionDetails = {
  gift_id: string; amount?: string; contributor_name: string; contributor_phone: string;
  contributor_email: string; message: string; vest_name?: string; regional_division?: string;
};
export type CardOperation = { key: string; result: CheckoutResult; uncertain: boolean; details?: CardContributionDetails };
const operations = new Map<string, CardOperation>();
export function rememberCardOperation(giftId: string, key: string, result: CheckoutResult, uncertain = false, details?: CardContributionDetails) {
  if (result.payment_status === 'confirmed') { operations.delete(giftId); return; }
  const payment = result.payment ? { ...result.payment, challenge: undefined } : null;
  const safe = { payment_status: result.payment_status,
    payment };
  const original = operations.get(giftId)?.details;
  operations.set(giftId, { key, result: safe, uncertain, details: details ?? original });
}
export function recalledCardOperation(giftId: string) { return operations.get(giftId); }
export function forgetCardOperation(giftId: string) { operations.delete(giftId); }
