import { create } from "zustand";
import { useStreakStore } from "./streak-store";
import { useReaderStore } from "./reader-store";

const STORAGE_KEY = "pnyxy-focus-session";

interface PersistedSession {
  startedAt: number;
  endsAt: number;
  pagesGoal?: number | null;
  pagesAtStart?: number | null;
  pagesDocId?: string | null;
}

export interface StartOptions {
  /** Optional page goal, session completes early when reached. */
  pagesGoal?: number;
  /** progressPage of the document at session start; pages read = current - this. */
  pagesAtStart?: number;
  /** Document id the page goal applies to (so flipping books doesn't cheat). */
  pagesDocId?: string;
}

interface FocusState {
  active: boolean;
  /** Epoch ms when the current session started. */
  startedAt: number | null;
  /** Epoch ms when the current session should end (always set; time is the safety bound). */
  endsAt: number | null;
  /** Milliseconds remaining. Updated every tick while active. */
  remainingMs: number;
  /** Pages target for this session, or null if time-only. */
  pagesGoal: number | null;
  /** progressPage at session start, snapshot once and never moved. */
  pagesAtStart: number | null;
  /** Doc id the page goal is bound to. */
  pagesDocId: string | null;
  /** Epoch ms when the current uninterrupted foreground span began.
   *  null while the tab is hidden or no session is active. */
  currentSpanStartedAt: number | null;
  /** Longest uninterrupted foreground span so far in this session, ms. */
  longestSpanMs: number;

  start: (minutes: number, opts?: StartOptions) => void;
  cancel: () => void;
  /** Extend the current session by `minutes`. No-op if inactive. */
  extend: (minutes: number) => void;

  /** Internal: called by the tick loop. Don't call directly from UI. */
  _tick: () => void;
  /** Internal: called on visibility change. */
  _setVisible: (visible: boolean) => void;
}

function loadPersisted(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (
      typeof parsed.startedAt === "number" &&
      typeof parsed.endsAt === "number" &&
      parsed.endsAt > Date.now()
    ) {
      return {
        startedAt: parsed.startedAt,
        endsAt: parsed.endsAt,
        pagesGoal:
          typeof parsed.pagesGoal === "number" ? parsed.pagesGoal : null,
        pagesAtStart:
          typeof parsed.pagesAtStart === "number" ? parsed.pagesAtStart : null,
        pagesDocId:
          typeof parsed.pagesDocId === "string" ? parsed.pagesDocId : null,
      };
    }
  } catch {
    // corrupted or missing; ignore
  }
  return null;
}

/** Compute pages read in the active session against the snapshot doc. Null if
 *  no page goal set or doc unavailable. */
function pagesReadInSession(): number | null {
  const focus = useFocusStore.getState();
  if (focus.pagesGoal == null || focus.pagesAtStart == null || !focus.pagesDocId) {
    return null;
  }
  const reader = useReaderStore.getState();
  const doc = reader.documents.get(focus.pagesDocId);
  if (!doc) return null;
  return Math.max(0, doc.progressPage - focus.pagesAtStart);
}

function persist(session: PersistedSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // quota / privacy mode; fine to skip
  }
}

/**
 * Play a short "ding" via WebAudio, no asset file needed, no
 * dependency on user-gesture for playback once the session has been
 * started by a user gesture earlier in the tab.
 */
function playDing() {
  try {
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
    osc.onended = () => ctx.close();
  } catch {
    // no audio permission or unsupported, non-fatal
  }
}

// Restore any in-flight session synchronously on module load so a page
// refresh mid-session resumes cleanly.
const restored = loadPersisted();

function commitSpan(
  longestSpanMs: number,
  currentSpanStartedAt: number | null,
): number {
  if (currentSpanStartedAt == null) return longestSpanMs;
  const spanMs = Date.now() - currentSpanStartedAt;
  return Math.max(longestSpanMs, spanMs);
}

export const useFocusStore = create<FocusState>((set, get) => ({
  active: !!restored,
  startedAt: restored?.startedAt ?? null,
  endsAt: restored?.endsAt ?? null,
  remainingMs: restored ? Math.max(0, restored.endsAt - Date.now()) : 0,
  pagesGoal: restored?.pagesGoal ?? null,
  pagesAtStart: restored?.pagesAtStart ?? null,
  pagesDocId: restored?.pagesDocId ?? null,
  currentSpanStartedAt:
    restored && typeof document !== "undefined" && !document.hidden
      ? Date.now()
      : null,
  longestSpanMs: 0,

  start(minutes, opts) {
    const now = Date.now();
    const durationMs = Math.max(1, minutes) * 60 * 1000;
    const endsAt = now + durationMs;
    const pagesGoal =
      opts?.pagesGoal != null && opts.pagesGoal > 0 ? opts.pagesGoal : null;
    const pagesAtStart =
      pagesGoal != null && opts?.pagesAtStart != null
        ? Math.max(0, opts.pagesAtStart)
        : null;
    const pagesDocId = pagesGoal != null ? opts?.pagesDocId ?? null : null;
    persist({
      startedAt: now,
      endsAt,
      pagesGoal,
      pagesAtStart,
      pagesDocId,
    });
    set({
      active: true,
      startedAt: now,
      endsAt,
      remainingMs: durationMs,
      pagesGoal,
      pagesAtStart,
      pagesDocId,
      currentSpanStartedAt:
        typeof document === "undefined" || !document.hidden ? now : null,
      longestSpanMs: 0,
    });
  },

  cancel() {
    const { startedAt, longestSpanMs, currentSpanStartedAt } = get();
    if (startedAt) {
      const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      if (seconds >= 60) {
        // Credit partial sessions toward the streak so an accidental
        // cancel near the end doesn't feel punitive.
        useStreakStore.getState().addReadingTime(seconds);
      }
      const finalSpanMs = commitSpan(longestSpanMs, currentSpanStartedAt);
      if (finalSpanMs > 0) {
        useStreakStore.getState().recordAttentionSpan(Math.round(finalSpanMs / 1000));
      }
    }
    persist(null);
    set({
      active: false,
      startedAt: null,
      endsAt: null,
      remainingMs: 0,
      pagesGoal: null,
      pagesAtStart: null,
      pagesDocId: null,
      currentSpanStartedAt: null,
      longestSpanMs: 0,
    });
  },

  extend(minutes) {
    const {
      active,
      endsAt,
      startedAt,
      pagesGoal,
      pagesAtStart,
      pagesDocId,
    } = get();
    if (!active || !endsAt || !startedAt) return;
    const newEnd = endsAt + Math.max(1, minutes) * 60 * 1000;
    persist({
      startedAt,
      endsAt: newEnd,
      pagesGoal,
      pagesAtStart,
      pagesDocId,
    });
    set({
      endsAt: newEnd,
      remainingMs: Math.max(0, newEnd - Date.now()),
    });
  },

  _tick() {
    const {
      active,
      endsAt,
      startedAt,
      longestSpanMs,
      currentSpanStartedAt,
      pagesGoal,
    } = get();
    if (!active || !endsAt || !startedAt) return;
    const remainingMs = Math.max(0, endsAt - Date.now());
    set({ remainingMs });

    // Page goal: complete early if reached, even if time remains.
    let pageGoalReached = false;
    if (pagesGoal != null) {
      const read = pagesReadInSession();
      if (read != null && read >= pagesGoal) pageGoalReached = true;
    }

    if (remainingMs === 0 || pageGoalReached) {
      // Session complete → log elapsed time + attention span, then stop.
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      useStreakStore.getState().addReadingTime(seconds);
      const finalSpanMs = commitSpan(longestSpanMs, currentSpanStartedAt);
      if (finalSpanMs > 0) {
        useStreakStore.getState().recordAttentionSpan(Math.round(finalSpanMs / 1000));
      }
      persist(null);
      set({
        active: false,
        startedAt: null,
        endsAt: null,
        pagesGoal: null,
        pagesAtStart: null,
        pagesDocId: null,
        currentSpanStartedAt: null,
        longestSpanMs: 0,
      });
      playDing();
    }
  },

  _setVisible(visible) {
    const { active, currentSpanStartedAt, longestSpanMs } = get();
    if (!active) return;
    if (!visible && currentSpanStartedAt != null) {
      // Span closed, record longest and clear the start.
      set({
        longestSpanMs: commitSpan(longestSpanMs, currentSpanStartedAt),
        currentSpanStartedAt: null,
      });
    } else if (visible && currentSpanStartedAt == null) {
      set({ currentSpanStartedAt: Date.now() });
    }
  },
}));

// One shared tick loop, driven by setInterval, self-regulating. The
// store keeps .active accurate; the interval fires even while idle but
// is cheap and keeps resume-after-refresh working without any mount.
let tickHandle: ReturnType<typeof setInterval> | null = null;
if (typeof window !== "undefined") {
  tickHandle = setInterval(() => {
    if (useFocusStore.getState().active) {
      useFocusStore.getState()._tick();
    }
  }, 1000);

  // If the tab is hidden for a long time the interval may be throttled;
  // force a catch-up tick when visibility returns. Also keeps the
  // attention-span tracker honest by closing/reopening the current span.
  document.addEventListener("visibilitychange", () => {
    useFocusStore.getState()._setVisible(!document.hidden);
    if (!document.hidden) useFocusStore.getState()._tick();
  });

  // Cleanup on HMR disposal so tests / dev don't stack timers.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      if (tickHandle) clearInterval(tickHandle);
    });
  }
}
