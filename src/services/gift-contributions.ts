import 'server-only';

import {
  createPendingContributionWith,
  type ContributionGiftSnapshot,
  type ContributionProgressSnapshot,
  type ExistingContribution,
  type PendingContribution,
} from '@/lib/gifts/contribution';
import { database, databaseInsert } from '@/lib/supabase/server';

const giftSelection = 'id,active,funding_mode,target_amount,gift_type';

async function getGift(id: string): Promise<ContributionGiftSnapshot | null> {
  const rows = await database<ContributionGiftSnapshot[]>(
    `gifts?select=${giftSelection}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

async function getProgress(id: string): Promise<ContributionProgressSnapshot | null> {
  const rows = await database<Array<ContributionProgressSnapshot & { gift_id: string }>>('rpc/get_gift_progress');
  if (!Array.isArray(rows)) return null;
  const progress = rows.find(row => row.gift_id === id);
  return progress ? { remaining_amount: progress.remaining_amount, goal_reached: progress.goal_reached } : null;
}

async function insert(contribution: PendingContribution) {
  const rows = await databaseInsert<ExistingContribution[]>(
    'gift_contributions?select=id,gift_id,contributor_name,request_fingerprint,payment_status,amount,contributor_email,expires_at',
    contribution,
  );
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('contribution_insert_failed');
  return rows[0];
}

async function expirePending(idempotencyKey: string) {
  await database<number>('rpc/expire_gift_contribution_pending', { p_idempotency_key: idempotencyKey });
}

async function getExisting(idempotencyKey: string): Promise<ExistingContribution | null> {
  const rows = await database<ExistingContribution[]>(
    `gift_contributions?select=id,gift_id,contributor_name,request_fingerprint,payment_status,amount,contributor_email,expires_at&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`,
  );
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

export function createPendingGiftContribution(value: unknown) {
  return createPendingContributionWith(value, { getGift, getProgress, expirePending, getExisting, insert });
}
