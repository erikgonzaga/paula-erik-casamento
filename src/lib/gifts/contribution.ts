export type ContributionGiftSnapshot = {
  id: string;
  active: boolean;
  funding_mode: 'goal' | 'open' | 'fixed';
  target_amount: unknown;
  gift_type: 'regular' | 'insanos';
};

export type ContributionProgressSnapshot = {
  remaining_amount: unknown;
  goal_reached: boolean;
};

export type PendingContribution = {
  idempotency_key: string;
  request_fingerprint: string;
  gift_id: string;
  contributor_name: string;
  contributor_phone: string;
  amount: string;
  payment_status: 'pending';
  payment_method: 'pix';
  external_reference: null;
  message: string | null;
  vest_name: string | null;
  regional_division: string | null;
  confirmed_at: null;
};

type PendingContributionBase = Omit<PendingContribution, 'request_fingerprint'>;

export type ExistingContribution = {
  request_fingerprint: string;
  payment_status: 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired';
};

type NormalizedRequest = Omit<PendingContribution, 'request_fingerprint' | 'amount' | 'payment_status' | 'payment_method' |
  'external_reference' | 'confirmed_at' | 'vest_name' | 'regional_division'> & {
    amount: unknown;
    vest_name: string | null;
    regional_division: string | null;
  };

export class GiftContributionError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKeys = new Set([
  'idempotency_key', 'gift_id', 'amount', 'contributor_name', 'contributor_phone', 'message', 'vest_name', 'regional_division',
]);
const zeroCents = BigInt(0);
const hundredCents = BigInt(100);
const maximumCents = BigInt('9999999999'); // PostgreSQL numeric(10,2).

function optionalText(value: unknown, maximum: number, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new GiftContributionError(400, 'invalid_form', `Confira o campo ${field}.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new GiftContributionError(400, 'invalid_form', `O campo ${field} está muito longo.`);
  return normalized;
}

export function normalizeBrazilianPhone(value: unknown): string {
  if (typeof value !== 'string') throw new GiftContributionError(400, 'invalid_phone', 'Informe um WhatsApp válido com DDD.');
  const input = value.trim();
  if (!input || !/^[+\d\s().-]+$/.test(input)) {
    throw new GiftContributionError(400, 'invalid_phone', 'Informe um WhatsApp válido com DDD.');
  }
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  throw new GiftContributionError(400, 'invalid_phone', 'Informe um WhatsApp válido com DDD.');
}

function decimalToCents(value: string): bigint | null {
  let input = value.trim().replace(/^R\$\s*/i, '').replace(/[\s\u00a0]/g, '');
  if (!input || input.startsWith('-') || input.startsWith('+')) return null;
  if (input.includes(',')) {
    const brazilian = /^\d+(?:,\d{1,2})?$/.test(input) || /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(input);
    if (!brazilian) return null;
    input = input.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(input)) {
    input = input.replace(/\./g, '');
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(input)) {
    return null;
  }
  const [whole, fraction = ''] = input.split('.');
  if (whole.length > 8) return null;
  const cents = BigInt(whole) * hundredCents + BigInt(fraction.padEnd(2, '0'));
  return cents <= maximumCents ? cents : null;
}

function userMoneyToCents(value: unknown): bigint {
  if (typeof value !== 'string') {
    throw new GiftContributionError(400, 'invalid_amount', 'Informe um valor válido para a contribuição.');
  }
  const cents = decimalToCents(value);
  if (cents === null || cents <= zeroCents) {
    throw new GiftContributionError(400, 'invalid_amount', 'Informe um valor maior que zero para a contribuição.');
  }
  return cents;
}

function storedMoneyToCents(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return decimalToCents(String(value));
}

function centsToDatabase(cents: bigint): string {
  return `${cents / hundredCents}.${String(cents % hundredCents).padStart(2, '0')}`;
}

export function formatContributionCents(cents: bigint): string {
  const whole = (cents / hundredCents).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${whole},${String(cents % hundredCents).padStart(2, '0')}`;
}

function validateRequest(value: unknown): NormalizedRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GiftContributionError(400, 'invalid_form', 'Confira os dados da contribuição.');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowedKeys.has(key)) ||
      typeof input.gift_id !== 'string' || !uuidPattern.test(input.gift_id) ||
      typeof input.idempotency_key !== 'string' || !uuidV4Pattern.test(input.idempotency_key)) {
    throw new GiftContributionError(400, 'invalid_form', 'Confira os dados da contribuição.');
  }
  if (typeof input.contributor_name !== 'string' || !input.contributor_name.trim() || input.contributor_name.trim().length > 150) {
    throw new GiftContributionError(400, 'invalid_name', 'Informe seu nome.');
  }
  return {
    idempotency_key: input.idempotency_key,
    gift_id: input.gift_id,
    amount: input.amount,
    contributor_name: input.contributor_name.trim(),
    contributor_phone: normalizeBrazilianPhone(input.contributor_phone),
    message: optionalText(input.message, 2000, 'mensagem'),
    vest_name: optionalText(input.vest_name, 150, 'nome de colete'),
    regional_division: optionalText(input.regional_division, 150, 'regional ou divisão'),
  };
}

function materializeContribution(
  request: NormalizedRequest,
  gift: ContributionGiftSnapshot | null,
): PendingContributionBase {
  if (!gift || gift.id !== request.gift_id) {
    throw new GiftContributionError(404, 'gift_unavailable', 'Este presente não está disponível.');
  }
  if (!['goal', 'open', 'fixed'].includes(gift.funding_mode)) {
    throw new GiftContributionError(503, 'invalid_gift', 'Não foi possível validar este presente agora.');
  }
  if (gift.gift_type === 'insanos' && !request.vest_name) {
    throw new GiftContributionError(400, 'vest_name_required', 'Informe o nome do colete para este Presente Insano.');
  }

  let amount: bigint;
  if (gift.funding_mode === 'fixed') {
    const fixed = storedMoneyToCents(gift.target_amount);
    if (fixed === null || fixed <= zeroCents) {
      throw new GiftContributionError(503, 'invalid_gift', 'Não foi possível validar o valor deste presente agora.');
    }
    amount = fixed;
  } else {
    amount = userMoneyToCents(request.amount);
  }

  return {
    idempotency_key: request.idempotency_key,
    gift_id: gift.id,
    contributor_name: request.contributor_name,
    contributor_phone: request.contributor_phone,
    amount: centsToDatabase(amount),
    payment_status: 'pending',
    payment_method: 'pix',
    external_reference: null,
    message: request.message,
    vest_name: gift.gift_type === 'insanos' ? request.vest_name : null,
    regional_division: gift.gift_type === 'insanos' ? request.regional_division : null,
    confirmed_at: null,
  };
}

function fingerprintContribution(contribution: PendingContributionBase): string {
  // Ordered JSON prevents representation differences; only the SHA-256 digest is persisted.
  const canonical = JSON.stringify([
    contribution.gift_id,
    contribution.amount,
    contribution.contributor_name,
    contribution.contributor_phone,
    contribution.message,
    contribution.vest_name,
    contribution.regional_division,
    contribution.payment_method,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function withFingerprint(contribution: PendingContributionBase): PendingContribution {
  return { ...contribution, request_fingerprint: fingerprintContribution(contribution) };
}

function validateContributionAvailability(
  contribution: PendingContribution,
  gift: ContributionGiftSnapshot,
  progress: ContributionProgressSnapshot | null,
) {
  if (!gift.active) {
    throw new GiftContributionError(409, 'gift_unavailable', 'Este presente não está mais disponível.');
  }
  if (gift.funding_mode !== 'goal') return;
  const remaining = storedMoneyToCents(progress?.remaining_amount);
  if (!progress || remaining === null) {
    throw new GiftContributionError(503, 'progress_unavailable', 'Não foi possível confirmar o valor restante agora. Tente novamente.');
  }
  if (progress.goal_reached || remaining <= zeroCents) {
    throw new GiftContributionError(409, 'goal_reached', 'Esse presente acabou de atingir a meta ❤️');
  }
  const amount = storedMoneyToCents(contribution.amount);
  if (amount === null) {
    throw new GiftContributionError(503, 'invalid_gift', 'Não foi possível validar este presente agora.');
  }
  if (amount > remaining) {
    throw new GiftContributionError(409, 'goal_remaining', `Esse presente está quase completo. Agora restam ${formatContributionCents(remaining)}.`);
  }
}

export function preparePendingContribution(
  value: unknown,
  gift: ContributionGiftSnapshot | null,
  progress: ContributionProgressSnapshot | null,
): PendingContribution {
  const request = validateRequest(value);
  const contribution = withFingerprint(materializeContribution(request, gift));
  validateContributionAvailability(contribution, gift!, progress);
  return contribution;
}

export type ContributionDependencies = {
  getGift(id: string): Promise<ContributionGiftSnapshot | null>;
  getProgress(id: string): Promise<ContributionProgressSnapshot | null>;
  expirePending(idempotencyKey: string): Promise<void>;
  getExisting(idempotencyKey: string): Promise<ExistingContribution | null>;
  insert(contribution: PendingContribution): Promise<void>;
};

function existingResult(existing: ExistingContribution, fingerprint: string) {
  if (existing.request_fingerprint !== fingerprint) {
    throw new GiftContributionError(409, 'idempotency_conflict', 'Esta tentativa já foi utilizada com outros dados. Inicie uma nova contribuição.');
  }
  return { ok: true as const, payment_status: existing.payment_status };
}

export async function createPendingContributionWith(value: unknown, dependencies: ContributionDependencies) {
  const request = validateRequest(value);
  const gift = await dependencies.getGift(request.gift_id);
  const contribution = withFingerprint(materializeContribution(request, gift));
  await dependencies.expirePending(request.idempotency_key);
  const existing = await dependencies.getExisting(request.idempotency_key);
  if (existing) return existingResult(existing, contribution.request_fingerprint);

  const progress = gift!.funding_mode === 'goal' ? await dependencies.getProgress(request.gift_id) : null;
  validateContributionAvailability(contribution, gift!, progress);
  try {
    await dependencies.insert(contribution);
  } catch {
    // A concurrent request may have inserted this same key first.
    await dependencies.expirePending(request.idempotency_key);
    const concurrent = await dependencies.getExisting(request.idempotency_key);
    if (concurrent) return existingResult(concurrent, contribution.request_fingerprint);

    // The database trigger is authoritative. Refresh once to translate a race
    // into a useful message without exposing PostgreSQL or PostgREST details.
    const currentGift = await dependencies.getGift(request.gift_id);
    const currentProgress = currentGift?.funding_mode === 'goal'
      ? await dependencies.getProgress(request.gift_id)
      : null;
    const currentContribution = withFingerprint(materializeContribution(request, currentGift));
    validateContributionAvailability(currentContribution, currentGift!, currentProgress);
    throw new GiftContributionError(503, 'write_failed', 'Não foi possível registrar a contribuição agora. Tente novamente.');
  }
  return { ok: true as const, payment_status: 'pending' as const };
}
import { createHash } from 'node:crypto';
