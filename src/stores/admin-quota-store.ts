// Admin AI-quota store, drives the AdminPage "AI Quota" tab.
//
// Backed by the three SECURITY DEFINER + is_admin()-gated RPCs from
// migration 00050. Aggregates only. Same numeric-coercion caveat as the
// analytics store: PostgREST serializes `numeric` as JSON strings, so we
// funnel every stat through num().

import { create } from "zustand";
import { supabase } from "@/lib/supabase";

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export interface QuotaDayPoint {
  day: string;
  active_users: number;
  capped_users: number;
  avg_tokens: number;
  avg_requests: number;
}

export interface QuotaCapSummary {
  active_users: number;
  capped_users: number;
  power_users: number;
  power_capped_users: number;
  free_active: number;
  free_capped: number;
  premium_active: number;
  premium_capped: number;
}

export interface QuotaHistogramBucket {
  bucket: string;
  sort_order: number;
  users: number;
}

interface AdminQuotaState {
  rangeDays: number;
  activeMin: number;
  loading: boolean;
  error: string | null;

  daily: QuotaDayPoint[];
  summary: QuotaCapSummary | null;
  histogram: QuotaHistogramBucket[];

  setRangeDays: (days: number) => void;
  setActiveMin: (n: number) => void;
  fetchQuota: (opts?: { days?: number; activeMin?: number }) => Promise<void>;
}

export const useAdminQuotaStore = create<AdminQuotaState>((set, get) => ({
  rangeDays: 30,
  activeMin: 5,
  loading: false,
  error: null,

  daily: [],
  summary: null,
  histogram: [],

  setRangeDays: (days) => set({ rangeDays: days }),
  setActiveMin: (n) => set({ activeMin: n }),

  fetchQuota: async (opts) => {
    const window = opts?.days ?? get().rangeDays;
    const activeMin = opts?.activeMin ?? get().activeMin;
    set({ loading: true, error: null, rangeDays: window, activeMin });
    try {
      const [dailyRes, summaryRes, histRes] = await Promise.all([
        supabase.rpc("admin_quota_daily", { p_days: window }),
        supabase.rpc("admin_quota_cap_summary", {
          p_days: window,
          p_active_min: activeMin,
        }),
        supabase.rpc("admin_quota_utilization_histogram", { p_days: window }),
      ]);

      const firstError = dailyRes.error ?? summaryRes.error ?? histRes.error;
      if (firstError) throw firstError;

      const s = (summaryRes.data?.[0] ?? null) as Record<string, unknown> | null;

      set({
        daily: ((dailyRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
          day: String(r.day),
          active_users: num(r.active_users),
          capped_users: num(r.capped_users),
          avg_tokens: num(r.avg_tokens),
          avg_requests: num(r.avg_requests),
        })),
        summary: s
          ? {
              active_users: num(s.active_users),
              capped_users: num(s.capped_users),
              power_users: num(s.power_users),
              power_capped_users: num(s.power_capped_users),
              free_active: num(s.free_active),
              free_capped: num(s.free_capped),
              premium_active: num(s.premium_active),
              premium_capped: num(s.premium_capped),
            }
          : null,
        histogram: ((histRes.data ?? []) as Record<string, unknown>[]).map(
          (r) => ({
            bucket: String(r.bucket),
            sort_order: num(r.sort_order),
            users: num(r.users),
          }),
        ),
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load quota stats",
      });
    } finally {
      set({ loading: false });
    }
  },
}));
