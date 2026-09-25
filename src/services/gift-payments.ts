import 'server-only';

import { randomUUID } from 'node:crypto';
import { GiftContributionError } from '@/lib/gifts/contribution';
import {
  assertExpectedOrder,
  createPixOrder,
  getOrder,
  type MercadoPagoOrder,
} from '@/lib/payments/mercado-pago/client';
import { database, databaseInsert, databaseUpdate } from '@/lib/supabase/server';
import { createPendingGiftContribution } from '@/services/gift-contributions';

type ContributionStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired';

type PaymentAttempt = {
  id: string;
  contribution_id: string;
  provider_idempotency_key: string;
  external_reference: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  provider_status: string;
  provider_status_detail: string | null;
  amount: string | number;
  expires_at: string;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  ticket_url: string | null;
  provider_checked_at: string | null;
  can_create?: boolean;
};

type StoredContribution = {
  id: string;
  gift_id: string;
  payment_status: ContributionStatus;
  contributor_name: string;
  contributor_email: string;
};

export type GiftPaymentResult = {
  ok: true;
  payment_status: ContributionStatus;
  payment: null | {
    status: 'creating' | 'waiting' | 'confirmed' | 'expired' | 'failed' | 'cancelled';
    qr_code: string | null;
    qr_code_base64: string | null;
    ticket_url: string | null;
    expires_at: string;
  };
};

const attemptSelection = [
  'id','contribution_id','provider_idempotency_key','external_reference','provider_order_id',
  'provider_payment_id','provider_status','provider_status_detail','amount','expires_at',
  'pix_qr_code','pix_qr_code_base64','ticket_url','provider_checked_at',
].join(',');

function publicResult(status: ContributionStatus, attempt: PaymentAttempt | null): GiftPaymentResult {
  if (status === 'confirmed') {
    return { ok: true, payment_status: status, payment: attempt ? {
      status: 'confirmed', qr_code: null, qr_code_base64: null, ticket_url: null, expires_at: attempt.expires_at,
    } : null };
  }
  if (!attempt) return { ok: true, payment_status: status, payment: null };
  const paymentStatus = status === 'expired' ? 'expired'
    : status === 'failed' ? 'failed'
      : status === 'cancelled' ? 'cancelled'
        : attempt.provider_status === 'creating' || attempt.provider_status === 'processing' ? 'creating'
          : 'waiting';
  return {
    ok: true,
    payment_status: status,
    payment: {
      status: paymentStatus,
      qr_code: attempt.pix_qr_code,
      qr_code_base64: attempt.pix_qr_code_base64,
      ticket_url: attempt.ticket_url,
      expires_at: attempt.expires_at,
    },
  };
}

async function claimAttempt(contributionId: string) {
  const rows = await database<PaymentAttempt[]>('rpc/claim_gift_payment_attempt', {
    p_contribution_id: contributionId,
    p_provider_idempotency_key: randomUUID(),
    p_lease_seconds: 30,
  });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('payment_attempt_unavailable');
  return rows[0];
}

async function getAttemptByContribution(contributionId: string) {
  const rows = await database<PaymentAttempt[]>(
    `payment_attempts?select=${attemptSelection}&contribution_id=eq.${encodeURIComponent(contributionId)}&limit=1`,
  );
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

async function reconcile(attempt: PaymentAttempt, order: MercadoPagoOrder): Promise<ContributionStatus> {
  assertExpectedOrder(order, { amount: attempt.amount, externalReference: attempt.external_reference });
  const rows = await database<string>('rpc/reconcile_gift_payment_attempt', {
    p_attempt_id: attempt.id,
    p_provider_order_id: order.id,
    p_provider_payment_id: order.payment?.id ?? null,
    p_provider_status: order.status,
    p_provider_status_detail: order.status_detail,
    p_amount: order.total_amount,
    p_external_reference: order.external_reference,
    p_expires_at: attempt.expires_at,
    p_pix_qr_code: order.payment?.payment_method.qr_code ?? null,
    p_pix_qr_code_base64: order.payment?.payment_method.qr_code_base64 ?? null,
    p_ticket_url: order.payment?.payment_method.ticket_url ?? null,
  });
  if (!['pending','confirmed','cancelled','failed','expired'].includes(rows)) throw new Error('payment_reconciliation_failed');
  return rows as ContributionStatus;
}

async function refreshAttempt(attempt: PaymentAttempt) {
  if (!attempt.provider_order_id) return { attempt, status: null as ContributionStatus | null };
  const order = await getOrder(attempt.provider_order_id);
  const status = await reconcile(attempt, order);
  return { attempt: await getAttemptByContribution(attempt.contribution_id) ?? attempt, status };
}

async function createAndReconcile(attempt: PaymentAttempt, contribution: StoredContribution) {
  const gifts = await database<Array<{ id: string; name: string }>>(
    `gifts?select=id,name&id=eq.${encodeURIComponent(contribution.gift_id)}&limit=1`,
  );
  const gift = gifts[0];
  if (!gift || gift.id !== contribution.gift_id || !gift.name?.trim()) {
    throw new Error('payment_gift_unavailable');
  }
  const order = await createPixOrder({
    amount: attempt.amount,
    giftId: gift.id,
    giftName: gift.name,
    externalReference: attempt.external_reference,
    idempotencyKey: attempt.provider_idempotency_key,
    payerEmail: contribution.contributor_email,
    payerName: contribution.contributor_name,
  });
  const status = await reconcile(attempt, order);
  return {
    attempt: await getAttemptByContribution(contribution.id) ?? attempt,
    status,
  };
}

export async function createGiftPayment(value: unknown): Promise<GiftPaymentResult> {
  const result = await createPendingGiftContribution(value);
  const contribution = result.contribution;
  if (result.payment_status !== 'pending') return publicResult(result.payment_status, null);
  const attempt = await claimAttempt(contribution.id);
  if (attempt.provider_order_id) {
    const refreshed = await refreshAttempt(attempt);
    return publicResult(refreshed.status ?? 'pending', refreshed.attempt);
  }
  if (!attempt.can_create) return publicResult('pending', attempt);

  const created = await createAndReconcile(attempt, contribution);
  return publicResult(created.status, created.attempt);
}

function validateStatusRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GiftContributionError(400, 'invalid_status', 'Consulta inválida.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || typeof input.idempotency_key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotency_key)) {
    throw new GiftContributionError(400, 'invalid_status', 'Consulta inválida.');
  }
  return input.idempotency_key;
}

export async function getGiftPaymentStatus(value: unknown): Promise<GiftPaymentResult> {
  const key = validateStatusRequest(value);
  const contributions = await database<StoredContribution[]>(
    `gift_contributions?select=id,gift_id,payment_status,contributor_name,contributor_email&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  if (!Array.isArray(contributions) || contributions.length !== 1) {
    throw new GiftContributionError(404, 'payment_not_found', 'Não encontramos esta tentativa de pagamento.');
  }
  const contribution = contributions[0];
  let attempt = await getAttemptByContribution(contribution.id);
  let status = contribution.payment_status;
  if (status === 'pending' && !attempt?.provider_order_id) {
    const claimed = await claimAttempt(contribution.id);
    attempt = claimed;
    if (claimed.can_create) {
      const created = await createAndReconcile(claimed, contribution);
      return publicResult(created.status, created.attempt);
    }
  }
  const checkedAt = attempt?.provider_checked_at ? Date.parse(attempt.provider_checked_at) : 0;
  if (attempt?.provider_order_id && status === 'pending' && Date.now() - checkedAt >= 5000) {
    const refreshed = await refreshAttempt(attempt);
    attempt = refreshed.attempt;
    status = refreshed.status ?? status;
  }
  return publicResult(status, attempt);
}

async function getAttemptByOrder(orderId: string) {
  const rows = await database<PaymentAttempt[]>(
    `payment_attempts?select=${attemptSelection}&provider_order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
  );
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

export async function processMercadoPagoOrder(orderId: string, eventKey: string) {
  const existing = await database<Array<{ id: string; processed_at: string | null }>>(
    `payment_webhook_events?select=id,processed_at&provider=eq.mercado_pago&event_key=eq.${eventKey}&limit=1`,
  );
  if (existing[0]?.processed_at) return;
  let eventId = existing[0]?.id;
  if (!eventId) {
    try {
      const inserted = await databaseInsert<Array<{ id: string }>>(
        'payment_webhook_events?select=id',
        { provider: 'mercado_pago', event_key: eventKey, resource_id: orderId },
      );
      eventId = inserted[0]?.id;
    } catch {
      const raced = await database<Array<{ id: string; processed_at: string | null }>>(
        `payment_webhook_events?select=id,processed_at&provider=eq.mercado_pago&event_key=eq.${eventKey}&limit=1`,
      );
      if (raced[0]?.processed_at) return;
      eventId = raced[0]?.id;
    }
  }
  if (!eventId) throw new Error('webhook_event_unavailable');

  const attempt = await getAttemptByOrder(orderId);
  if (!attempt) throw new Error('payment_attempt_not_found');
  const order = await getOrder(orderId);
  await reconcile(attempt, order);
  await databaseUpdate(`payment_webhook_events?id=eq.${encodeURIComponent(eventId)}`, {
    processed_at: new Date().toISOString(),
    outcome: 'reconciled',
  });
}
