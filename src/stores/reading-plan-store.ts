import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type {
  ReadingPlan,
  ReadingPlanItem,
  ReadingPlanProgress,
  ReadingPlanWithItems,
} from "@/types/reading-plan";

/** Data needed to compute progress for plan items whose book has been
 *  read at least once. Key is the book id (uploaded or catalog). */
export type BookProgressMap = Map<string, number>;

interface PlanItemDraft {
  book_id?: string | null;
  catalog_book_id?: string | null;
  start_page?: number | null;
  end_page?: number | null;
  ordering?: number;
}

interface CreatePlanInput {
  title: string;
  description?: string | null;
  color?: string | null;
  start_date: string;
  end_date: string;
  ignore_weekends: boolean;
  /** May be empty, a plan can be created without books and have
   *  them attached later from the detail page. */
  items: PlanItemDraft[];
}

interface UpdatePlanPatch {
  title?: string;
  description?: string | null;
  color?: string | null;
  start_date?: string;
  end_date?: string;
  ignore_weekends?: boolean;
}

interface PlanState {
  plans: ReadingPlanWithItems[];
  isLoading: boolean;
  /** Set when the last fetchMine call failed; cleared on the next attempt. */
  error: string | null;

  fetchMine: () => Promise<void>;
  /** Returns the plan with its items, or null. Used by the detail
   *  page when navigated directly without a prior list load. */
  getPlan: (planId: string) => Promise<ReadingPlanWithItems | null>;
  createPlan: (input: CreatePlanInput) => Promise<string | null>;
  /** Patch the plan row, and if `items` is provided, replace the
   *  item set wholesale (delete + re-insert). Replace-all is fine
   *  for the small per-plan dataset and avoids per-row diffing. */
  updatePlan: (
    planId: string,
    patch: UpdatePlanPatch,
    items?: PlanItemDraft[],
  ) => Promise<void>;
  deletePlan: (planId: string) => Promise<void>;
  setStatus: (
    planId: string,
    status: "active" | "completed" | "abandoned",
  ) => Promise<void>;
}

export const useReadingPlanStore = create<PlanState>((set, get) => ({
  plans: [],
  isLoading: false,
  error: null,

  async fetchMine() {
    set({ isLoading: true, error: null });
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        set({ plans: [] });
        return;
      }

      const { data: plans, error: plansErr } = await supabase
        .from("reading_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("end_date", { ascending: true });
      if (plansErr) throw plansErr;

      const ids = (plans ?? []).map((p) => p.id);
      if (ids.length === 0) {
        set({ plans: [] });
        return;
      }

      const { data: items, error: itemsErr } = await supabase
        .from("reading_plan_items")
        .select("*")
        .in("plan_id", ids)
        .order("ordering", { ascending: true });
      if (itemsErr) throw itemsErr;

      const byPlan = new Map<string, ReadingPlanItem[]>();
      for (const it of items ?? []) {
        const arr = byPlan.get(it.plan_id) ?? [];
        arr.push(it as ReadingPlanItem);
        byPlan.set(it.plan_id, arr);
      }

      set({
        plans: (plans ?? []).map((p) => ({
          plan: p as ReadingPlan,
          items: byPlan.get(p.id) ?? [],
        })),
      });
    } catch (err) {
      logError("reading-plan:fetchMine", err);
      set({ error: "fetchFailed" });
    } finally {
      set({ isLoading: false });
    }
  },

  async getPlan(planId) {
    const [planRes, itemsRes] = await Promise.all([
      supabase
        .from("reading_plans")
        .select("*")
        .eq("id", planId)
        .maybeSingle(),
      supabase
        .from("reading_plan_items")
        .select("*")
        .eq("plan_id", planId)
        .order("ordering", { ascending: true }),
    ]);
    if (planRes.error || !planRes.data) {
      if (planRes.error) logError("reading-plan:getPlan", planRes.error);
      return null;
    }
    if (itemsRes.error) {
      logError("reading-plan:getPlan:items", itemsRes.error);
      return null;
    }
    return {
      plan: planRes.data as ReadingPlan,
      items: (itemsRes.data ?? []) as ReadingPlanItem[],
    };
  },

  async createPlan(input) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to create a plan.");

    const { data: plan, error: planErr } = await supabase
      .from("reading_plans")
      .insert({
        user_id: user.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        color: input.color ?? null,
        start_date: input.start_date,
        end_date: input.end_date,
        ignore_weekends: input.ignore_weekends,
      })
      .select()
      .single();
    if (planErr || !plan) {
      logError("reading-plan:createPlan", planErr);
      throw planErr ?? new Error("Could not create plan.");
    }

    if (input.items.length > 0) {
      const rows = input.items.map((it, i) => ({
        plan_id: plan.id as string,
        book_id: it.book_id ?? null,
        catalog_book_id: it.catalog_book_id ?? null,
        start_page: it.start_page ?? null,
        end_page: it.end_page ?? null,
        ordering: it.ordering ?? i,
      }));
      const { error: itemsErr } = await supabase
        .from("reading_plan_items")
        .insert(rows);
      if (itemsErr) {
        logError("reading-plan:createPlan:items", itemsErr);
        // Plan row is orphaned; cascade delete to keep things clean.
        await supabase.from("reading_plans").delete().eq("id", plan.id);
        throw itemsErr;
      }
    }

    await get().fetchMine();
    return plan.id as string;
  },

  async updatePlan(planId, patch, items) {
    const planPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) planPatch.title = patch.title.trim();
    if (patch.description !== undefined)
      planPatch.description = patch.description?.trim() || null;
    if (patch.color !== undefined) planPatch.color = patch.color ?? null;
    if (patch.start_date !== undefined) planPatch.start_date = patch.start_date;
    if (patch.end_date !== undefined) planPatch.end_date = patch.end_date;
    if (patch.ignore_weekends !== undefined)
      planPatch.ignore_weekends = patch.ignore_weekends;

    if (Object.keys(planPatch).length > 0) {
      const { error } = await supabase
        .from("reading_plans")
        .update(planPatch)
        .eq("id", planId);
      if (error) {
        logError("reading-plan:updatePlan", error);
        throw error;
      }
    }

    if (items) {
      // Replace-all: delete existing item rows, then insert the new
      // set. Cheap for the per-plan size and avoids per-row diffing.
      const { error: delErr } = await supabase
        .from("reading_plan_items")
        .delete()
        .eq("plan_id", planId);
      if (delErr) {
        logError("reading-plan:updatePlan:delItems", delErr);
        throw delErr;
      }
      if (items.length > 0) {
        const rows = items.map((it, i) => ({
          plan_id: planId,
          book_id: it.book_id ?? null,
          catalog_book_id: it.catalog_book_id ?? null,
          start_page: it.start_page ?? null,
          end_page: it.end_page ?? null,
          ordering: it.ordering ?? i,
        }));
        const { error: insErr } = await supabase
          .from("reading_plan_items")
          .insert(rows);
        if (insErr) {
          logError("reading-plan:updatePlan:insItems", insErr);
          throw insErr;
        }
      }
    }

    await get().fetchMine();
  },

  async deletePlan(planId) {
    const { error } = await supabase
      .from("reading_plans")
      .delete()
      .eq("id", planId);
    if (error) {
      logError("reading-plan:deletePlan", error);
      throw error;
    }
    set((s) => ({ plans: s.plans.filter((p) => p.plan.id !== planId) }));
  },

  async setStatus(planId, status) {
    const patch: { status: typeof status; completed_at?: string | null } = {
      status,
    };
    if (status === "completed") patch.completed_at = new Date().toISOString();
    const { error } = await supabase
      .from("reading_plans")
      .update(patch)
      .eq("id", planId);
    if (error) {
      logError("reading-plan:setStatus", error);
      throw error;
    }
    await get().fetchMine();
  },
}));

// Progress math (pure; no store access)

/** Count the weekdays (Mon-Fri) between two ISO dates inclusive. */
export function countWeekdays(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Inclusive day count between two ISO dates. */
export function countDays(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/** Today's date as ISO YYYY-MM-DD (local time). */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface BookTotalsLookup {
  /** Return the total page count for a book id (uploaded or catalog),
   *  or null if unknown. */
  getTotalPages: (bookId: string) => number | null;
}

export function computeProgress(
  plan: ReadingPlan,
  items: ReadingPlanItem[],
  bookProgress: BookProgressMap,
  lookup: BookTotalsLookup,
): ReadingPlanProgress {
  let totalPages = 0;
  let pagesRead = 0;

  for (const it of items) {
    const bookId = it.book_id ?? it.catalog_book_id;
    if (!bookId) continue;
    const total = lookup.getTotalPages(bookId) ?? 0;

    const start = it.start_page ?? 1;
    const end = it.end_page ?? total;
    if (end <= 0 || end < start) continue;

    const span = end - start + 1;
    totalPages += span;

    const current = bookProgress.get(bookId) ?? 0;
    // Count only pages within this item's range.
    const withinRange = Math.max(0, Math.min(current, end) - start + 1);
    pagesRead += Math.min(withinRange, span);
  }

  const today = todayIso();
  const totalDays = plan.ignore_weekends
    ? countWeekdays(plan.start_date, plan.end_date)
    : countDays(plan.start_date, plan.end_date);

  let daysElapsed: number;
  if (today < plan.start_date) {
    daysElapsed = 0;
  } else if (today >= plan.end_date) {
    daysElapsed = totalDays;
  } else {
    daysElapsed = plan.ignore_weekends
      ? countWeekdays(plan.start_date, today)
      : countDays(plan.start_date, today);
  }

  const perDay = totalDays > 0 ? totalPages / totalDays : 0;
  const todayTarget = Math.round(perDay * daysElapsed);
  const pagesAhead = pagesRead - todayTarget;
  const completion = totalPages > 0 ? pagesRead / totalPages : 0;

  return {
    totalPages,
    pagesRead,
    todayTarget,
    daysElapsed,
    totalDays,
    pagesAhead,
    completion,
  };
}
