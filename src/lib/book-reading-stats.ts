import type { ReadingSession } from "@/types/database";

export interface BookReadingStats {
  totalSeconds: number;
  sessionsCount: number;
  lastSessionEndedAt: Date | null;
  /** Consecutive days (in local time, tolerant of "haven't read
   *  today yet") ending today/yesterday. 0 if no recent activity. */
  currentStreak: number;
  longestStreak: number;
  /** Average pages per active day over the recent window. Null when
   *  there aren't enough sessions with start/end pages to compute. */
  pagesPerDay: number | null;
  /** ISO date (YYYY-MM-DD) the user is projected to finish on, or
   *  null when pace can't be computed or page_count is missing. */
  estimatedFinishDate: string | null;
  /** 0..100, or null when either current page or page_count is missing. */
  percentComplete: number | null;
}

/** Window for pace calculation — recent enough to reflect current
 *  habits, long enough to absorb a skipped day or two. */
const PACE_WINDOW_DAYS = 14;

/** YYYY-MM-DD key in the user's local time zone — streaks read the
 *  way humans do ("did I read today?"), not in UTC. */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayKey(now: Date = new Date()): string {
  return localDateKey(now);
}

function yesterdayKey(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return localDateKey(d);
}

function dateKeyMinusDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - n);
  return localDateKey(date);
}

function computeStreaks(activeDayKeys: Set<string>, now: Date = new Date()): {
  current: number;
  longest: number;
} {
  if (activeDayKeys.size === 0) return { current: 0, longest: 0 };

  // ── Current streak ───────────────────────────────────────────
  // Walk back from today; if today isn't there, allow yesterday
  // as the start (so the streak doesn't visibly break the moment
  // the clock rolls past midnight before the user reads).
  let current = 0;
  let cursor = todayKey(now);
  if (!activeDayKeys.has(cursor)) {
    cursor = yesterdayKey(now);
    if (!activeDayKeys.has(cursor)) {
      // No activity today or yesterday — current streak is zero.
      // Longest streak still computed below.
      current = 0;
    } else {
      current = 1;
      cursor = dateKeyMinusDays(cursor, 1);
      while (activeDayKeys.has(cursor)) {
        current += 1;
        cursor = dateKeyMinusDays(cursor, 1);
      }
    }
  } else {
    current = 1;
    cursor = dateKeyMinusDays(cursor, 1);
    while (activeDayKeys.has(cursor)) {
      current += 1;
      cursor = dateKeyMinusDays(cursor, 1);
    }
  }

  // ── Longest streak ───────────────────────────────────────────
  // Sort keys, walk forward, find the longest run of consecutive
  // days. Day comparison via dateKeyMinusDays so DST/month-end
  // boundaries are handled the same way as the current-streak walk.
  const sortedKeys = Array.from(activeDayKeys).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedKeys.length; i++) {
    const expectedPrev = dateKeyMinusDays(sortedKeys[i], 1);
    if (expectedPrev === sortedKeys[i - 1]) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  return { current, longest: Math.max(longest, current) };
}

/**
 * Reduce a list of closed sessions for one book + current
 * position into the derived stats the Overview tab renders. Pure
 * function — caller fetches the sessions and supplies `now` in
 * tests for deterministic streak math.
 */
export function computeBookReadingStats(
  sessions: ReadingSession[],
  currentPage: number | null,
  pageCount: number | null,
  now: Date = new Date(),
): BookReadingStats {
  const closed = sessions.filter((s) => s.ended_at !== null);

  const totalSeconds = closed.reduce(
    (acc, s) => acc + (s.duration_seconds ?? 0),
    0,
  );
  const sessionsCount = closed.length;
  const lastSessionEndedAt =
    closed.length > 0 && closed[0].ended_at
      ? new Date(closed[0].ended_at)
      : null;

  const activeDayKeys = new Set<string>();
  for (const s of closed) {
    if (s.ended_at) activeDayKeys.add(localDateKey(new Date(s.ended_at)));
  }
  const { current: currentStreak, longest: longestStreak } = computeStreaks(
    activeDayKeys,
    now,
  );

  // Pace: sessions with both pages in the last PACE_WINDOW_DAYS.
  // We aggregate by day rather than by session so a single
  // 3-session marathon doesn't inflate the daily average.
  const windowStartKey = dateKeyMinusDays(todayKey(now), PACE_WINDOW_DAYS - 1);
  const pagesByDay = new Map<string, number>();
  for (const s of closed) {
    if (s.start_page == null || s.end_page == null || !s.ended_at) continue;
    const key = localDateKey(new Date(s.ended_at));
    if (key < windowStartKey) continue;
    const delta = s.end_page - s.start_page;
    if (delta <= 0) continue;
    pagesByDay.set(key, (pagesByDay.get(key) ?? 0) + delta);
  }
  let pagesPerDay: number | null = null;
  if (pagesByDay.size > 0) {
    const total = Array.from(pagesByDay.values()).reduce((a, b) => a + b, 0);
    pagesPerDay = total / pagesByDay.size;
  }

  let estimatedFinishDate: string | null = null;
  if (
    pagesPerDay !== null &&
    pagesPerDay > 0 &&
    currentPage !== null &&
    pageCount !== null &&
    currentPage < pageCount
  ) {
    const remaining = pageCount - currentPage;
    const daysLeft = Math.ceil(remaining / pagesPerDay);
    const finish = new Date(now);
    finish.setDate(finish.getDate() + daysLeft);
    estimatedFinishDate = localDateKey(finish);
  }

  const percentComplete =
    currentPage !== null && pageCount !== null && pageCount > 0
      ? Math.min(100, Math.round((currentPage / pageCount) * 100))
      : null;

  return {
    totalSeconds,
    sessionsCount,
    lastSessionEndedAt,
    currentStreak,
    longestStreak,
    pagesPerDay,
    estimatedFinishDate,
    percentComplete,
  };
}

/** Format total time as "1h 23m" / "23m" / "2s". */
export function formatTotalTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

/** Format an ISO date (YYYY-MM-DD) in the user's locale, short form. */
export function formatFinishDate(
  isoDate: string,
  locale: string = navigator.language,
): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
