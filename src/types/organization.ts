export interface Organization {
  id: string;
  user_id: string;
  name: string;
  /** Palette key from lib/plan-colors.ts, or null for neutral. */
  color: string | null;
  /** Exactly one per user. The default org cannot be deleted, only
   *  renamed / recolored. */
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
