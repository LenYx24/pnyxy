import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";

// ── Remote sync (leaderboards) ──────────────────────────────
// Local is source of truth; this is a cached rollup in Postgres
// for fast leaderboard queries. Debounced so we're not writing
// on every reading-timer tick.

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
    // Leaderboard total excludes manually-logged time. The user
    // could otherwise rank themselves up by typing in big numbers
    // — manual logging is a personal habit signal, not a public
    // claim of in-app reading.
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
  /** Total reading time for the day, auto-tracked + manually
   *  logged combined. Used for the goal check + intensity tier. */
  seconds: number;
  /** Portion of `seconds` that came from manual logging (the
   *  "I read on my physical book today" button). Excluded from
   *  leaderboard totals so logging doesn't game the rankings.
   *  Optional — pre-existing records have it undefined, treated
   *  as 0. */
  manualSeconds?: number;
  goalCompleted: boolean;
  celebrationShown: boolean;
}

export const GOAL_SECONDS = 300; // 5 minutes
/** Limit how far back the user can backfill manual time. A week
 *  matches the "I forgot to log yesterday" use case without
 *  letting people invent months of fake history. */
export const MANUAL_BACKFILL_DAYS = 7;
/** Cap a single day's manual log so a typo can't crown someone
 *  king of the leaderboard (excluded from leaderboard anyway, but
 *  the streak heatmap also looks weird at 24h). */
export const MAX_MANUAL_MINUTES_PER_DAY = 600; // 10 hours

/**
 * GitHub-style activity intensity levels. 0 = nothing, 4 = great
 * day. Shared by the heatmap and any other surface that wants to
 * render an at-a-glance sense of how much was read on a given day.
 */
export type IntensityLevel = 0 | 1 | 2 | 3 | 4;
export function getDailyIntensity(seconds: number): IntensityLevel {
  if (seconds <= 0) return 0;
  if (seconds < 5 * 60) return 1; // <5 min — short session
  if (seconds < 15 * 60) return 2; // 5–15 min — solid
  if (seconds < 30 * 60) return 3; // 15–30 min — strong
  return 4; // 30+ min — great day
}

/** UTC ISO date (YYYY-MM-DD), matching the existing todayKey()
 *  convention so manual entries land in the same record map as
 *  auto-tracked time without timezone-skew mismatches. */
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
  /** Manually log time the user spent reading away from the app
   *  (physical book, ePub on another device, …). `dateIso` is a
   *  YYYY-MM-DD string within the last MANUAL_BACKFILL_DAYS;
   *  `seconds` is bounded by MAX_MANUAL_MINUTES_PER_DAY. Returns
   *  true on success, false if rejected by validation. */
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

        // Recalculate longest streak if today just completed
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
        // Validate: shape, range, retroactive window. Reject silently
        // (return false) so the caller can surface a localized error
        // rather than the store itself owning the user-facing copy.
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

        // Manual entries can flip a past day into "completed" — that
        // can extend the current streak retroactively. Re-derive
        // longest from the updated map instead of just comparing
        // against today, to capture this case.
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

  // Start from today and walk backwards
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const record = records[key];

    if (record?.goalCompleted) {
      streak++;
    } else if (i === 0) {
      // Today not yet completed is OK, continue checking from yesterday
      continue;
    } else {
      break;
    }
  }

  return streak;
}
