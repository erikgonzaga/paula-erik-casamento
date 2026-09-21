export type Dashboard = {
  generated_at: string;
  guests: Record<'total' | 'adults' | 'children' | 'confirmed' | 'declined' | 'pending', number>;
  groups: Record<'total' | 'responded' | 'unanswered', number>;
  gifts: Record<'total' | 'house' | 'party' | 'travel' | 'insanos' | 'goal' | 'open' | 'fixed', number>;
  goal_totals: Record<'target' | 'raised' | 'percentage', number>;
  contributions: Record<'pending' | 'confirmed' | 'expired' | 'cancelled' | 'failed' | 'total' | 'goal' | 'open' | 'fixed' | 'insanos', number>;
  goals: { id: string; name: string; category: string; target_amount: number; raised: number; percentage: number; remaining: number }[];
  recent: { id: string; contributor_name: string; gift_name: string; amount: number; payment_status: string; created_at: string }[];
};
