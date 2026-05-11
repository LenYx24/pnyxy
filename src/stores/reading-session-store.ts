import { create } from "zustand";
import {
  fetchActiveSession,
  startSession,
  stopSession,
  stopSessionBeacon,
  STALE_SESSION_THRESHOLD_MS,
} from "@/lib/reading-sessions";
import type { ReadingSession } from "@/types/database";

/**
 * Per-book reading session timer — runtime state.
 *
 * The DB is the source of truth (one row per session, partial
 * unique index gates one active per user). This store mirrors
 * the active row locally so the UI can render a live elapsed
 * timer without hitting the network every tick.
 *
 * Hydration: on first read the store calls `hydrate()` which
 * looks for an active row. If one is found within the stale
 * threshold, the timer resumes; if older than that, the row is
 * abandoned (auto-closed with whatever duration we can compute).
 */

interface ReadingSessionState {
  active: ReadingSession | null;
  /** Seconds elapsed since active.started_at. Updated by `tick()` */
  elapsedSeconds: number;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  start: (docId: string, startPage: number | null) => Promise<ReadingSession | null>;
  stop: (endPage: number | null) => Promise<void>;
  /** Tick called from a single global rAF/interval. Recomputes
   *  elapsed from started_at + Date.now() — drift-free. */
  tick: () => void;
}

export const useReadingSessionStore = create<ReadingSessionState>((set, get) => ({
  active: null,
  elapsedSeconds: 0,
  hydrated: false,

  hydrate: async () => {
    const row = await fetchActiveSession();
    if (!row) {
      set({ active: null, elapsedSeconds: 0, hydrated: true });
      return;
    }
    const startedAt = new Date(row.started_at).getTime();
    const ageMs = Date.now() - startedAt;
    if (ageMs > STALE_SESSION_THRESHOLD_MS) {
      // Crashed-tab cleanup: write the row as ended at the
      // started_at + threshold (so we don't credit hours the
      // user wasn't actually reading) and clear local state.
      const endedAt = new Date(startedAt + STALE_SESSION_THRESHOLD_MS);
      await stopSession(row.id, row.started_at, row.end_page, endedAt);
      set({ active: null, elapsedSeconds: 0, hydrated: true });
      return;
    }
    set({
      active: row,
      elapsedSeconds: Math.floor(ageMs / 1000),
      hydrated: true,
    });
  },

  start: async (docId, startPage) => {
    if (get().active) return get().active;
    const row = await startSession(docId, startPage);
    if (!row) return null;
    set({ active: row, elapsedSeconds: 0 });
    return row;
  },

  stop: async (endPage) => {
    const row = get().active;
    if (!row) return;
    // Clear local state first so the UI snaps to idle even if
    // the network call is slow — the DB write is best-effort.
    set({ active: null, elapsedSeconds: 0 });
    await stopSession(row.id, row.started_at, endPage);
  },

  tick: () => {
    const row = get().active;
    if (!row) return;
    const startedAt = new Date(row.started_at).getTime();
    set({ elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
  },
}));

// ── One-time module-level wiring ───────────────────────────────
// Tick the active session every second from a single shared
// interval — cheaper than every consumer running its own setInterval.
if (typeof window !== "undefined") {
  setInterval(() => {
    if (useReadingSessionStore.getState().active) {
      useReadingSessionStore.getState().tick();
    }
  }, 1000);

  // Best-effort: close the active session if the user navigates
  // away or backgrounds the tab beyond recovery. `pagehide` is
  // more reliable than `beforeunload` on mobile.
  window.addEventListener("pagehide", () => {
    const row = useReadingSessionStore.getState().active;
    if (!row) return;
    stopSessionBeacon(row.id, row.started_at, row.end_page);
  });
}

/** Format seconds as "1h 23m" / "23m" / "45s" — UI helper. */
export function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}
