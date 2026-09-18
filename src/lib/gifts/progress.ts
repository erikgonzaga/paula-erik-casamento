import type { Gift, GiftProgress } from './types';

export function clampPercentage(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

// Missing/invalid RPC data is unavailable, never invented as zero progress.
export function combineGiftProgress(gifts: Gift[], rows: unknown): Gift[] {
  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && typeof row === 'object' && typeof row.gift_id === 'string') byId.set(row.gift_id, row);
    }
  }
  return gifts.map(gift => {
    let progress: GiftProgress | null = null;
    const row = byId.get(gift.id);
    // Do not serialize open/fixed totals into public component props.
    if (gift.funding_mode === 'goal' && row) {
      const target = numeric(row.target_amount);
      const raised = numeric(row.total_raised);
      const percentage = numeric(row.percentage);
      const remaining = numeric(row.remaining_amount);
      if (target !== null && target > 0 && target === gift.target_amount &&
          raised !== null && raised >= 0 && percentage !== null &&
          remaining !== null && remaining >= 0 && typeof row.goal_reached === 'boolean') {
        progress = {
          target_amount: target, total_raised: raised,
          percentage: row.goal_reached ? 100 : clampPercentage(percentage),
          remaining_amount: remaining, goal_reached: row.goal_reached,
        };
      }
    }
    return { ...gift, progress };
  });
}
