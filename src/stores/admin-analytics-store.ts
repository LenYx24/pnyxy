// Admin analytics store, drives the AdminPage "Analytics" tab.
//
// Each field maps 1:1 to a SECURITY DEFINER RPC from migration
// 00047 (all gated behind is_admin()). The RPCs return only
// aggregates, counts, sums, percentiles, histogram buckets, so
// nothing here exposes prompt/response content; the heavy-user
// leaderboard is the only per-user row and is admin-only by design.
//
// Numeric coercion note: PostgREST serializes Postgres `numeric`
// (the percentile/avg columns) as JSON *strings* to preserve
// precision, and `bigint` as numbers when small. We funnel every
// count/stat through `num()` so the charts always get real numbers.

import { create } from "zustand";
import { supabase } from "@/lib/supabase";

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export interface AdminOverview {
  total_users: number;
  premium_users: number;
  new_users_7d: number;
  new_users_30d: number;
  active_users_7d: number;
  total_books: number;
  total_notes: number;
  total_whiteboards: number;
  total_quizzes: number;
  total_conversations: number;
  tokens_7d: number;
  tokens_30d: number;
}

export interface SignupPoint {
  day: string;
  signups: number;
}

export interface TokenDayPoint {
  day: string;
  model: string;
  tokens: number;
  requests: number;
}

export interface TokenDistribution {
  users_active: number;
  avg_tokens: number;
  median_tokens: number;
  p90_tokens: number;
  p95_tokens: number;
  p99_tokens: number;
  max_tokens: number;
}

export interface TopTokenUser {
  user_id: string;
  display_name: string | null;
  tier: string;
  tokens: number;
  requests: number;
}

export interface BooksHistogramBucket {
  bucket: string;
  sort_order: number;
  users: number;
}

export interface FeatureUsageRow {
  feature: string;
  users_with: number;
  total_items: number;
}

interface AdminAnalyticsState {
  rangeDays: number;
  loading: boolean;
  error: string | null;

  overview: AdminOverview | null;
  signups: SignupPoint[];
  tokensDaily: TokenDayPoint[];
  distribution: TokenDistribution | null;
  topUsers: TopTokenUser[];
  booksHistogram: BooksHistogramBucket[];
  featureUsage: FeatureUsageRow[];

  setRangeDays: (days: number) => void;
  fetchAll: (days?: number) => Promise<void>;
}

export const useAdminAnalyticsStore = create<AdminAnalyticsState>((set, get) => ({
  rangeDays: 30,
  loading: false,
  error: null,

  overview: null,
  signups: [],
  tokensDaily: [],
  distribution: null,
  topUsers: [],
  booksHistogram: [],
  featureUsage: [],

  setRangeDays: (days) => set({ rangeDays: days }),

  fetchAll: async (days) => {
    const window = days ?? get().rangeDays;
    set({ loading: true, error: null, rangeDays: window });
    try {
      const [
        overviewRes,
        signupsRes,
        tokensRes,
        distRes,
        topRes,
        booksRes,
        featRes,
      ] = await Promise.all([
        supabase.rpc("admin_overview"),
        supabase.rpc("admin_signups_daily", { p_days: window }),
        supabase.rpc("admin_tokens_daily", { p_days: window }),
        supabase.rpc("admin_token_distribution", { p_days: window }),
        supabase.rpc("admin_top_token_users", { p_days: window, p_limit: 10 }),
        supabase.rpc("admin_books_per_user_histogram"),
        supabase.rpc("admin_feature_usage"),
      ]);

      const firstError =
        overviewRes.error ??
        signupsRes.error ??
        tokensRes.error ??
        distRes.error ??
        topRes.error ??
        booksRes.error ??
        featRes.error;
      if (firstError) throw firstError;

      const ov = (overviewRes.data?.[0] ?? null) as Record<string, unknown> | null;
      const dist = (distRes.data?.[0] ?? null) as Record<string, unknown> | null;

      set({
        overview: ov
          ? {
              total_users: num(ov.total_users),
              premium_users: num(ov.premium_users),
              new_users_7d: num(ov.new_users_7d),
              new_users_30d: num(ov.new_users_30d),
              active_users_7d: num(ov.active_users_7d),
              total_books: num(ov.total_books),
              total_notes: num(ov.total_notes),
              total_whiteboards: num(ov.total_whiteboards),
              total_quizzes: num(ov.total_quizzes),
              total_conversations: num(ov.total_conversations),
              tokens_7d: num(ov.tokens_7d),
              tokens_30d: num(ov.tokens_30d),
            }
          : null,
        signups: ((signupsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          day: String(r.day),
          signups: num(r.signups),
        })),
        tokensDaily: ((tokensRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          day: String(r.day),
          model: String(r.model),
          tokens: num(r.tokens),
          requests: num(r.requests),
        })),
        distribution: dist
          ? {
              users_active: num(dist.users_active),
              avg_tokens: num(dist.avg_tokens),
              median_tokens: num(dist.median_tokens),
              p90_tokens: num(dist.p90_tokens),
              p95_tokens: num(dist.p95_tokens),
              p99_tokens: num(dist.p99_tokens),
              max_tokens: num(dist.max_tokens),
            }
          : null,
        topUsers: ((topRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          user_id: String(r.user_id),
          display_name: r.display_name ? String(r.display_name) : null,
          tier: String(r.tier),
          tokens: num(r.tokens),
          requests: num(r.requests),
        })),
        booksHistogram: ((booksRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          bucket: String(r.bucket),
          sort_order: num(r.sort_order),
          users: num(r.users),
        })),
        featureUsage: ((featRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          feature: String(r.feature),
          users_with: num(r.users_with),
          total_items: num(r.total_items),
        })),
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load analytics" });
    } finally {
      set({ loading: false });
    }
  },
}));
