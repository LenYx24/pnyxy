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
    const totalSeconds = Object.values(state.dailyRecords).reduce(
      (sum, r) => sum + (r.seconds ?? 0),
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

interface DailyRecord {
  seconds: number;
  goalCompleted: boolean;
  celebrationShown: boolean;
}

const GOAL_SECONDS = 300; // 5 minutes

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface StreakState {
  dailyRecords: Record<string, DailyRecord>;
  longestStreak: number;
  /** Longest continuous foreground focus stretch ever recorded, in seconds. */
  longestAttentionSeconds: number;

  addReadingTime: (seconds: number) => void;
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
