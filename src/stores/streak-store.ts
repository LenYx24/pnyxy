import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";

// Cached rollup in Postgres for leaderboard queries. Local is source of truth.
// Debounced so we don't write on every timer tick.

const SYNC_DEBOUNCE_MS = 30_000;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRemoteSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(flushRemoteSync, SYNC_DEBOUNCE_MS);
}

async function flushRemoteSync() {
  syncTimer = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const state = useStreakStore.getState();
    const current = state.getCurrentStreak();
    const todayRec = state.getTodayRecord();
    // exclude manual time so people can't inflate their leaderboard rank by typing numbers
    const totalSeconds = Object.values(state.dailyRecords).reduce(
      (sum, r) =>
        sum + Math.max(0, (r.seconds ?? 0) - (r.manualSeconds ?? 0)),
      0,
    );

    await supabase.from("reading_stats").upsert(
      {
        user_id: user.id,
        current_streak: current,
        longest_streak: state.longestStreak,
        total_seconds: totalSeconds,
        longest_attention_seconds: state.longestAttentionSeconds,
        last_read_date:
          todayRec.seconds > 0 ? new Date().toISOString().slice(0, 10) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  } catch (err) {
    logError("streak-store:flushRemoteSync", err);
  }
}

export interface DailyRecord {
  /** Total reading time for the day (auto + manual). */
  seconds: number;
  /** Portion of `seconds` from manual logging. Undefined = 0. */
  manualSeconds?: number;
  goalCompleted: boolean;
  celebrationShown: boolean;
}

export const GOAL_SECONDS = 300; // 5 minutes
/** How far back manual backfill is allowed. */
export const MANUAL_BACKFILL_DAYS = 7;
/** Cap per-day manual log so a typo can't fill the heatmap. */
export const MAX_MANUAL_MINUTES_PER_DAY = 600; // 10 hours

/** GitHub-style activity intensity, 0 = none, 4 = 30min+. */
export type IntensityLevel = 0 | 1 | 2 | 3 | 4;
export function getDailyIntensity(seconds: number): IntensityLevel {
  if (seconds <= 0) return 0;
  if (seconds < 5 * 60) return 1;
  if (seconds < 15 * 60) return 2;
  if (seconds < 30 * 60) return 3;
  return 4;
}

/** UTC ISO date (YYYY-MM-DD), must match todayKey() to avoid tz skew. */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface StreakState {
  dailyRecords: Record<string, DailyRecord>;
  longestStreak: number;
  /** Longest continuous foreground focus stretch ever recorded, in seconds. */
  longestAttentionSeconds: number;

  addReadingTime: (seconds: number) => void;
  /** Log offline reading time. Returns false if validation rejects it. */
  addManualReadingTime: (dateIso: string, seconds: number) => boolean;
  recordAttentionSpan: (seconds: number) => void;
  getCurrentStreak: () => number;
  getTodayRecord: () => DailyRecord;
  shouldShowCelebration: () => boolean;
  markCelebrationShown: () => void;
}

export const useStreakStore = create<StreakState>()(
  persist(
    (set, get) => ({
      dailyRecords: {},
      longestStreak: 0,
      longestAttentionSeconds: 0,

      recordAttentionSpan(seconds: number) {
        if (seconds <= 0) return;
        const { longestAttentionSeconds } = get();
        if (seconds > longestAttentionSeconds) {
          set({ longestAttentionSeconds: seconds });
          scheduleRemoteSync();
        }
      },

      addReadingTime(seconds: number) {
        const key = todayKey();
        const { dailyRecords, longestStreak } = get();
        const existing = dailyRecords[key] ?? {
          seconds: 0,
          goalCompleted: false,
          celebrationShown: false,
        };

        const newSeconds = existing.seconds + seconds;
        const goalCompleted = newSeconds >= GOAL_SECONDS;

        const updated: DailyRecord = {
          ...existing,
          seconds: newSeconds,
          goalCompleted,
        };

        const newRecords = { ...dailyRecords, [key]: updated };

        let newLongest = longestStreak;
        if (goalCompleted && !existing.goalCompleted) {
          const current = computeStreak(newRecords);
          if (current > longestStreak) {
            newLongest = current;
          }
        }

        set({ dailyRecords: newRecords, longestStreak: newLongest });
        scheduleRemoteSync();
      },

      addManualReadingTime(dateIso: string, seconds: number): boolean {
        // caller surfaces the localized error, so just return false here
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
        if (!Number.isFinite(seconds) || seconds <= 0) return false;
        const cappedSeconds = Math.min(
          seconds,
          MAX_MANUAL_MINUTES_PER_DAY * 60,
        );

        const today = todayKey();
        const earliest = new Date();
        earliest.setUTCDate(earliest.getUTCDate() - MANUAL_BACKFILL_DAYS);
        const earliestKey = dateKey(earliest);
        if (dateIso > today || dateIso < earliestKey) return false;

        const { dailyRecords, longestStreak } = get();
        const existing = dailyRecords[dateIso] ?? {
          seconds: 0,
          manualSeconds: 0,
          goalCompleted: false,
          celebrationShown: false,
        };

        const newSeconds = existing.seconds + cappedSeconds;
        const newManualSeconds = (existing.manualSeconds ?? 0) + cappedSeconds;
        const goalCompleted = newSeconds >= GOAL_SECONDS;

        const updated: DailyRecord = {
          ...existing,
          seconds: newSeconds,
          manualSeconds: newManualSeconds,
          goalCompleted,
        };

        const newRecords = { ...dailyRecords, [dateIso]: updated };

        // a backfilled day can extend the streak retroactively, so re-derive from the full map
        let newLongest = longestStreak;
        if (goalCompleted && !existing.goalCompleted) {
          const current = computeStreak(newRecords);
          if (current > newLongest) newLongest = current;
        }

        set({ dailyRecords: newRecords, longestStreak: newLongest });
        scheduleRemoteSync();
        return true;
      },

      getCurrentStreak() {
        return computeStreak(get().dailyRecords);
      },

      getTodayRecord() {
        const key = todayKey();
        return get().dailyRecords[key] ?? {
          seconds: 0,
          goalCompleted: false,
          celebrationShown: false,
        };
      },

      shouldShowCelebration() {
        const record = get().getTodayRecord();
        return record.goalCompleted && !record.celebrationShown;
      },

      markCelebrationShown() {
        const key = todayKey();
        const { dailyRecords } = get();
        const existing = dailyRecords[key];
        if (!existing) return;
        set({
          dailyRecords: {
            ...dailyRecords,
            [key]: { ...existing, celebrationShown: true },
          },
        });
      },
    }),
    { name: "pnyxy-reader:streaks" },
  ),
);

function computeStreak(records: Record<string, DailyRecord>): number {
  let streak = 0;
  const now = new Date();

  // walk backwards from today
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const record = records[key];

    if (record?.goalCompleted) {
      streak++;
    } else if (i === 0) {
      // today not done yet is fine, keep the streak alive
      continue;
    } else {
      break;
    }
  }

  return streak;
}
