import 'server-only';

import type { Gift } from '@/lib/gifts/types';
import { combineGiftProgress } from '@/lib/gifts/progress';
import { publicDatabase, PublicDatabaseError } from '@/lib/supabase/public-server';

const selection = [
  'id',
  'name',
  'slug',
  'description',
  'category',
  'target_amount',
  'funding_mode',
  'image_url',
  'featured',
  'display_order',
  'gift_type',
  'allow_multiple',
].join(',');

export async function getActiveGifts(): Promise<Gift[]> {
  const [rows, progress] = await Promise.all([
    publicDatabase<Gift[]>(`gifts?select=${selection}&active=eq.true&order=display_order.asc,id.asc`),
    publicDatabase<unknown>('rpc/get_gift_progress').catch(() => null),
  ]);

  if (!Array.isArray(rows)) throw new PublicDatabaseError();

  const gifts = rows.map((gift) => {
    const target_amount = gift.target_amount === null ? null : Number(gift.target_amount);
    if (!['goal', 'open', 'fixed'].includes(gift.funding_mode)) throw new PublicDatabaseError();
    if (gift.funding_mode === 'open') {
      if (target_amount !== null) throw new PublicDatabaseError();
    } else if (target_amount === null || !Number.isFinite(target_amount) || target_amount <= 0) {
      throw new PublicDatabaseError();
    }
    return { ...gift, target_amount };
  });
  return combineGiftProgress(gifts, progress);
}
