import 'server-only';

import { randomUUID } from 'node:crypto';
import { GiftContributionError } from '@/lib/gifts/contribution';
import { parseContributionPayment, validatePaymentAttemptMethod, type ContributionPaymentInput, type CreditCardInput } from '@/lib/payments/contracts';
import {
  assertExpectedOrder,
  createPixOrder,
  createCreditCardOrder,
  getOrder,
  type MercadoPagoOrder,
} from '@/lib/payments/mercado-pago/client';
import { database, databaseInsert, databaseUpdate } from '@/lib/supabase/server';
import { createPendingGiftContribution } from '@/services/gift-contributions';

type ContributionStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired';
type PaymentEnvironment = 'test' | 'production';

function paymentEnvironment(): PaymentEnvironment {
  const value = process.env.PAYMENTS_ENVIRONMENT;
  if (value !== 'test' && value !== 'production') throw new Error('payment_environment_unavailable');
  return value;
}

function assertPaymentEnvironment(value: PaymentEnvironment | null) {
  if (value !== paymentEnvironment()) throw new Error('payment_environment_mismatch');
}

type PaymentAttempt = {
  payment_method: 'pix' | 'credit_card' | 'external';
  installments: number | string | null;
  provider_payment_method_id: string | null;
  payment_environment: PaymentEnvironment | null;
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
  order_submission_started_at: string | null;
  order_submission_state: 'legacy' | 'not_started' | 'started';
  can_create?: boolean;
};

type StoredContribution = {
  payment_method: 'pix' | 'credit_card';
  payment_environment: PaymentEnvironment | null;
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
    status: 'creating' | 'investigating' | 'waiting' | 'action_required' | 'confirmed' | 'expired' | 'failed' | 'cancelled';
    challenge?: { url: string };
    qr_code: string | null;
    qr_code_base64: string | null;
    ticket_url: string | null;
    expires_at: string;
  };
};

const attemptSelection = [
  'id','contribution_id','payment_environment','provider_idempotency_key','external_reference','provider_order_id',
  'provider_payment_id','provider_status','provider_status_detail','amount','expires_at',
  'pix_qr_code','pix_qr_code_base64','ticket_url','provider_checked_at',
  'order_submission_started_at','order_submission_state',
  'payment_method','installments','provider_payment_method_id',
].join(',');

function isPastDeadline(attempt: PaymentAttempt) {
  return Date.parse(attempt.expires_at) <= Date.now();
}

function statusWithoutOrder(attempt: PaymentAttempt): ContributionStatus {
  return isPastDeadline(attempt) && attempt.order_submission_state === 'not_started'
    ? 'expired' : 'pending';
}

function publicResult(status: ContributionStatus, attempt: PaymentAttempt | null, order?: MercadoPagoOrder): GiftPaymentResult {
  if (status === 'confirmed') {
    return { ok: true, payment_status: status, payment: attempt ? {
      status: 'confirmed', qr_code: null, qr_code_base64: null, ticket_url: null, expires_at: attempt.expires_at,
    } : null };
  }
  if (!attempt) return { ok: true, payment_status: status, payment: null };
  const card = attempt.payment_method === 'credit_card';
  const needsChallenge = card && status === 'pending' && order?.status === 'action_required' &&
    order.status_detail === 'pending_challenge';
  const paymentStatus = status === 'expired' ? 'expired'
    : status === 'failed' ? 'failed'
      : status === 'cancelled' ? 'cancelled'
        : !attempt.provider_order_id && attempt.order_submission_state !== 'not_started'
          ? 'investigating'
          : needsChallenge ? 'action_required'
          : attempt.provider_status === 'creating' || attempt.provider_status === 'processing' ? 'creating'
          : 'waiting';
  return {
    ok: true,
    payment_status: status,
    payment: {
      status: paymentStatus,
      qr_code: card ? null : attempt.pix_qr_code,
      qr_code_base64: card ? null : attempt.pix_qr_code_base64,
      ticket_url: card ? null : attempt.ticket_url,
      expires_at: attempt.expires_at,
      ...(needsChallenge && order?.payment?.payment_method.challenge_url
        ? { challenge: { url: order.payment.payment_method.challenge_url } } : {}),
    },
  };
}

async function claimAttempt(contributionId: string, payment?: ContributionPaymentInput) {
  const card = payment?.payment_method === 'credit_card' ? payment : null;
  const rows = await database<PaymentAttempt[]>(card ? 'rpc/claim_gift_card_payment_attempt' : 'rpc/claim_gift_payment_attempt_for_environment', {
    p_contribution_id: contributionId,
    p_environment: paymentEnvironment(),
    p_provider_idempotency_key: randomUUID(),
    p_lease_seconds: 30,
    ...(card ? { p_installments: card.installments, p_method_id: card.payment_method_id } : {}),
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new GiftContributionError(409, 'payment_expired', 'Esta tentativa expirou. Inicie uma nova contribuição.');
  }
  if (rows[0].contribution_id !== contributionId) throw new Error('payment_contribution_mismatch');
  // The unchanged Pix RPC omits method metadata; its existing inserts are
  // protected by the contribution/method trigger from stage 1.
  return card ? rows[0] : { ...rows[0], payment_method: 'pix' as const,
    installments: null, provider_payment_method_id: 'pix' };
}

async function getAttemptByContribution(contributionId: string) {
  const rows = await database<PaymentAttempt[]>(
    `payment_attempts?select=${attemptSelection}&contribution_id=eq.${encodeURIComponent(contributionId)}&limit=1`,
  );
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

function attemptMethod(attempt: PaymentAttempt) {
  return validatePaymentAttemptMethod({ payment_method: attempt.payment_method,
    installments: attempt.installments === null ? null : Number(attempt.installments),
    provider_payment_method_id: attempt.provider_payment_method_id });
}

async function reconcile(attempt: PaymentAttempt, order: MercadoPagoOrder): Promise<ContributionStatus> {
  assertPaymentEnvironment(attempt.payment_environment);
  const method = attemptMethod(attempt);
  if (method.payment_method === 'external') throw new Error('unsupported_provider_payment_method');
  assertExpectedOrder(order, { amount: attempt.amount, externalReference: attempt.external_reference,
    paymentMethod: method.payment_method, paymentMethodId: method.provider_payment_method_id,
    installments: method.installments });
  if (attempt.provider_order_id && attempt.provider_order_id !== order.id) throw new Error('payment_order_mismatch');
  const rows = await database<string>('rpc/reconcile_gift_payment_attempt_for_environment', {
    p_attempt_id: attempt.id,
    p_environment: paymentEnvironment(),
    p_provider_order_id: order.id,
    p_provider_payment_id: order.payment?.id ?? null,
    p_provider_status: order.status,
    p_provider_status_detail: order.status_detail,
    p_amount: order.total_amount,
    p_external_reference: order.external_reference,
    p_expires_at: attempt.expires_at,
    p_pix_qr_code: method.payment_method === 'pix' ? order.payment?.payment_method.qr_code ?? null : null,
    p_pix_qr_code_base64: method.payment_method === 'pix' ? order.payment?.payment_method.qr_code_base64 ?? null : null,
    p_ticket_url: method.payment_method === 'pix' ? order.payment?.payment_method.ticket_url ?? null : null,
  });
  if (!['pending','confirmed','cancelled','failed','expired'].includes(rows)) throw new Error('payment_reconciliation_failed');
  return rows as ContributionStatus;
}

async function refreshAttempt(attempt: PaymentAttempt) {
  assertPaymentEnvironment(attempt.payment_environment);
  if (!attempt.provider_order_id) return { attempt, status: null as ContributionStatus | null, order: undefined };
  const order = await getOrder(attempt.provider_order_id, undefined, attempt.payment_method === 'credit_card');
  const status = await reconcile(attempt, order);
  return { attempt: await getAttemptByContribution(attempt.contribution_id) ?? attempt, status, order };
}

async function createAndReconcile(attempt: PaymentAttempt, contribution: StoredContribution, payment?: ContributionPaymentInput) {
  assertPaymentEnvironment(attempt.payment_environment);
  assertPaymentEnvironment(contribution.payment_environment);
  const card: CreditCardInput | null = payment?.payment_method === 'credit_card' ? payment : null;
  if (attempt.payment_method === 'credit_card' && !card) throw new Error('card_token_required');
  const method = attemptMethod(attempt);
  if (method.payment_method !== contribution.payment_method ||
      (method.payment_method === 'credit_card' && (!card || method.installments !== card.installments ||
        method.provider_payment_method_id !== card.payment_method_id))) throw new Error('payment_attempt_method_mismatch');
  const gifts = await database<Array<{ id: string; name: string }>>(
    `gifts?select=id,name&id=eq.${encodeURIComponent(contribution.gift_id)}&limit=1`,
  );
  const gift = gifts[0];
  if (!gift || gift.id !== contribution.gift_id || !gift.name?.trim()) {
    throw new Error('payment_gift_unavailable');
  }
  if (Date.parse(attempt.expires_at) <= Date.now() + 5000) {
    const latest = await claimAttempt(contribution.id, payment);
    return { attempt: latest, status: statusWithoutOrder(latest), order: undefined };
  }
  // The database makes the deadline decision while holding the contribution
  // lock and records that a request may have reached the provider.
  const maySend = await database<boolean>('rpc/begin_gift_order_submission_for_environment', {
    p_attempt_id: attempt.id,
    p_environment: paymentEnvironment(),
  });
  if (!maySend || isPastDeadline(attempt)) {
    const latest = await claimAttempt(contribution.id, payment);
    return { attempt: latest, status: statusWithoutOrder(latest), order: undefined };
  }
  const input = {
    amount: attempt.amount,
    giftId: gift.id,
    giftName: gift.name,
    externalReference: attempt.external_reference,
    idempotencyKey: attempt.provider_idempotency_key,
    payerEmail: contribution.contributor_email,
    payerName: contribution.contributor_name,
  };
  const order = card ? await createCreditCardOrder({ ...input, ...card }) : await createPixOrder(input);
  const status = await reconcile(attempt, order);
  return {
    attempt: await getAttemptByContribution(contribution.id) ?? attempt,
    status,
    order,
  };
}

export async function createGiftPayment(value: unknown): Promise<GiftPaymentResult> {
  let payment: ContributionPaymentInput;
  try { payment = parseContributionPayment(value && typeof value === 'object' ? value as Record<string, unknown> : {}); }
  catch { throw new GiftContributionError(400, 'invalid_payment', 'Confira os dados do pagamento.'); }
  const result = await createPendingGiftContribution(value);
  const contribution = result.contribution;
  assertPaymentEnvironment(contribution.payment_environment);
  if (contribution.payment_method !== payment.payment_method) throw new Error('payment_attempt_method_mismatch');
  if (result.payment_status !== 'pending') return publicResult(result.payment_status, null);
  const attempt = await claimAttempt(contribution.id, payment);
  if (attempt.provider_order_id) {
    const refreshed = await refreshAttempt(attempt);
    return publicResult(refreshed.status ?? 'pending', refreshed.attempt, refreshed.order);
  }
  if (isPastDeadline(attempt)) return publicResult(statusWithoutOrder(attempt), attempt);
  if (!attempt.can_create) return publicResult('pending', attempt);

  const created = await createAndReconcile(attempt, contribution, payment);
  return publicResult(created.status, created.attempt, created.order);
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
    `gift_contributions?select=id,gift_id,payment_status,payment_environment,payment_method,contributor_name,contributor_email&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  if (!Array.isArray(contributions) || contributions.length !== 1) {
    throw new GiftContributionError(404, 'payment_not_found', 'Não encontramos esta tentativa de pagamento.');
  }
  const contribution = contributions[0];
  assertPaymentEnvironment(contribution.payment_environment);
  let attempt = await getAttemptByContribution(contribution.id);
  if (attempt) assertPaymentEnvironment(attempt.payment_environment);
  const status = contribution.payment_status;
  if (status === 'pending' && !attempt?.provider_order_id && contribution.payment_method === 'pix') {
    const claimed = await claimAttempt(contribution.id);
    attempt = claimed;
    if (isPastDeadline(claimed)) {
      return publicResult(statusWithoutOrder(claimed), claimed);
    }
    if (claimed.can_create) {
      const created = await createAndReconcile(claimed, contribution);
      return publicResult(created.status, created.attempt);
    }
  }
  const checkedAt = attempt?.provider_checked_at ? Date.parse(attempt.provider_checked_at) : 0;
  if (attempt?.provider_order_id && status === 'pending' && (Date.now() - checkedAt >= 5000 ||
      (attempt.payment_method === 'credit_card' && attempt.provider_status_detail === 'pending_challenge'))) {
    const refreshed = await refreshAttempt(attempt);
    attempt = refreshed.attempt;
    return publicResult(refreshed.status ?? status, refreshed.attempt, refreshed.order);
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
  const attempt = await getAttemptByOrder(orderId);
  if (!attempt) throw new Error('payment_attempt_not_found');
  assertPaymentEnvironment(attempt.payment_environment);
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

  const order = await getOrder(orderId, undefined, attempt.payment_method === 'credit_card');
  await reconcile(attempt, order);
  await databaseUpdate(`payment_webhook_events?id=eq.${encodeURIComponent(eventId)}`, {
    processed_at: new Date().toISOString(),
    outcome: 'reconciled',
  });
}

export async function reconcilePendingGiftPaymentsBatch() {
  const environment = paymentEnvironment();
  const expiredUnsent = await database<number>('rpc/expire_gift_contribution_pending_for_environment', {
    p_idempotency_key: null,
    p_environment: environment,
  });
  const candidates = await database<Array<{ id: string; contribution_id: string }>>(
    'rpc/claim_due_gift_payment_reconciliation_for_environment',
    { p_environment: environment, p_limit: 10, p_lease_seconds: 120 },
  );
  if (!Array.isArray(candidates) || candidates.length > 10) {
    throw new Error('invalid_reconciliation_batch');
  }
  let reconciled = 0;
  let deferred = 0;
  for (const candidate of candidates) {
    try {
      const attempt = await getAttemptByContribution(candidate.contribution_id);
      if (!attempt || attempt.id !== candidate.id || !attempt.provider_order_id) continue;
      await refreshAttempt(attempt);
      reconciled += 1;
    } catch (error) {
      deferred += 1;
      // A 429 asks the caller to slow down; the persisted lease makes a later
      // run retry without changing the financial status.
      if (error instanceof Error && 'diagnostic' in error &&
          (error as { diagnostic?: { httpStatus?: number } }).diagnostic?.httpStatus === 429) break;
    }
  }
  return { expiredUnsent, selected: candidates.length, reconciled, deferred };
}
