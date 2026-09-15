import 'server-only';

import type { Gift } from '@/lib/gifts/types';
import { publicDatabase, PublicDatabaseError } from '@/lib/supabase/public-server';

const selection = [
  'id',
  'name',
  'slug',
  'description',
  'category',
  'price',
  'image_url',
  'featured',
  'display_order',
  'gift_type',
  'allow_multiple',
].join(',');

export async function getActiveGifts(): Promise<Gift[]> {
  const rows = await publicDatabase<Gift[]>(
    `gifts?select=${selection}&active=eq.true&order=display_order.asc,id.asc`,
  );

  if (!Array.isArray(rows)) throw new PublicDatabaseError();

  return rows.map((gift) => {
    const price = Number(gift.price);
    if (!Number.isFinite(price) || price <= 0) throw new PublicDatabaseError();
    return { ...gift, price };
  });
}
