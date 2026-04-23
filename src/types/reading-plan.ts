export type ReadingPlanStatus = "active" | "completed" | "abandoned";

export interface ReadingPlan {
  id: string;
  user_id: string;
  title: string;
  /** ISO date (YYYY-MM-DD) */
  start_date: string;
  end_date: string;
  ignore_weekends: boolean;
  status: ReadingPlanStatus;
  created_at: string;
  completed_at: string | null;
}

export interface ReadingPlanItem {
  id: string;
  plan_id: string;
  /** Exactly one of book_id / catalog_book_id is non-null. */
  book_id: string | null;
  catalog_book_id: string | null;
  /** null = whole book */
  start_page: number | null;
  end_page: number | null;
  ordering: number;
}

/** Full plan plus its items, as fetched from the store. */
export interface ReadingPlanWithItems {
  plan: ReadingPlan;
  items: ReadingPlanItem[];
}

/** Derived progress snapshot — not in the DB. */
export interface ReadingPlanProgress {
  /** Total pages targeted across all items. */
  totalPages: number;
  /** Pages the user has actually read within the targeted ranges. */
  pagesRead: number;
  /** What today's cumulative target should be. */
  todayTarget: number;
  /** Days elapsed since start_date, clamped to [0, totalDays]. */
  daysElapsed: number;
  /** Total reading days in the plan (respecting ignore_weekends). */
  totalDays: number;
  /** Positive = ahead of schedule; negative = behind. */
  pagesAhead: number;
  /** Derived 0-1 completion fraction. */
  completion: number;
}
