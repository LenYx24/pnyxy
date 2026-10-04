import { create } from "zustand";

/**
 * Proactive tutor ("aktív mód") v1: rule-based nudges in the reader. The
 * rules live in useTutorNudges; this store only holds the nudge on screen
 * and the per-day budget. No LLM call happens until the user accepts.
 */

export type ProactiveLevel = "off" | "low" | "high";

export type TutorNudge =
  | { kind: "stuck"; docId: string; page: number }
  | { kind: "resume"; docId: string; page: number };

interface LevelRules {
  /** Visible time on one page before the "stuck?" nudge, in ms. */
  stuckAfterMs: number;
  /** Days since the last read that make the "where was I?" offer worth it. */
  resumeAfterDays: number;
  maxPerDay: number;
  /** "Not now" in a row that silences the tutor for the rest of the day. */
  declinesToMute: number;
}

export const PROACTIVE_RULES: Record<Exclude<ProactiveLevel, "off">, LevelRules> = {
  low: { stuckAfterMs: 8 * 60_000, resumeAfterDays: 4, maxPerDay: 3, declinesToMute: 2 },
  high: { stuckAfterMs: 4 * 60_000, resumeAfterDays: 1, maxPerDay: 8, declinesToMute: 3 },
};

export function normalizeProactiveLevel(v: unknown): ProactiveLevel {
  return v === "off" || v === "high" ? v : "low";
}

const BUDGET_KEY = "pnyxy-tutor-nudge-budget";

interface DayBudget {
  day: string;
  shown: number;
  declinesInRow: number;
}

const today = () => new Date().toISOString().slice(0, 10);

function readBudget(): DayBudget {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    const parsed = raw ? (JSON.parse(raw) as DayBudget) : null;
    if (parsed && parsed.day === today()) return parsed;
  } catch {
    // storage blocked: fall through to a fresh in-memory budget
  }
  return { day: today(), shown: 0, declinesInRow: 0 };
}

function writeBudget(b: DayBudget): void {
  try {
    localStorage.setItem(BUDGET_KEY, JSON.stringify(b));
  } catch {
    // best effort, the budget is a per-device convenience
  }
}

interface TutorNudgeState {
  nudge: TutorNudge | null;
  /** True when today's budget still allows a nudge at this level. */
  canNudge: (rules: LevelRules) => boolean;
  show: (nudge: TutorNudge) => void;
  /** The user acted on it: clears the decline streak. */
  accept: () => void;
  /** "Not now": counts towards muting the tutor for the day. */
  decline: () => void;
  /** Silent removal (doc switch, setting turned off). */
  clear: () => void;
}

export const useTutorNudgeStore = create<TutorNudgeState>((set) => ({
  nudge: null,
  canNudge: (rules) => {
    const b = readBudget();
    return b.shown < rules.maxPerDay && b.declinesInRow < rules.declinesToMute;
  },
  show: (nudge) => {
    const b = readBudget();
    writeBudget({ ...b, shown: b.shown + 1 });
    set({ nudge });
  },
  accept: () => {
    writeBudget({ ...readBudget(), declinesInRow: 0 });
    set({ nudge: null });
  },
  decline: () => {
    const b = readBudget();
    writeBudget({ ...b, declinesInRow: b.declinesInRow + 1 });
    set({ nudge: null });
  },
  clear: () => set({ nudge: null }),
}));
