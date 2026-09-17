export type GiftCategory = 'house' | 'travel' | 'party' | 'insanos';
export type RegularGiftCategory = Exclude<GiftCategory, 'insanos'>;
export type GiftType = 'regular' | 'insanos';
export type FundingMode = 'goal' | 'open' | 'fixed';

export type Gift = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: GiftCategory;
  target_amount: number | null;
  funding_mode: FundingMode;
  image_url: string | null;
  featured: boolean;
  display_order: number;
  gift_type: GiftType;
  allow_multiple: boolean;
};

export type RegularGift = Gift & { category: RegularGiftCategory; gift_type: 'regular' };
export type InsaneGift = Gift & { category: 'insanos'; gift_type: 'insanos' };

export function isRegularGift(gift: Gift): gift is RegularGift {
  return gift.gift_type === 'regular' && gift.category !== 'insanos';
}

export function isInsaneGift(gift: Gift): gift is InsaneGift {
  return gift.gift_type === 'insanos' && gift.category === 'insanos';
}
