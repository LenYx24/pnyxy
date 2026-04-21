import { create } from "zustand";
import { useStreakStore } from "./streak-store";

const STORAGE_KEY = "pnyxy-focus-session";

interface PersistedSession {
  startedAt: number;
  endsAt: number;
}

interface FocusState {
  active: boolean;
  /** Epoch ms when the current session started. */
  startedAt: number | null;
  /** Epoch ms when the current session should end. */
  endsAt: number | null;
  /** Milliseconds remaining. Updated every tick while active. */
  remainingMs: number;

  start: (minutes: number) => void;
  cancel: () => void;
  /** Extend the current session by `minutes`. No-op if inactive. */
  extend: (minutes: number) => void;

  /** Internal: called by the tick loop. Don't call directly from UI. */
  _tick: () => void;
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
      return parsed as PersistedSession;
    }
  } catch {
    // corrupted or missing; ignore
  }
  return null;
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
 * Play a short "ding" via WebAudio — no asset file needed, no
 * dependency on user-gesture for playback once the session has been
 * started by a user gesture earlier in the tab.
 */
function playDing() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
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
    // no audio permission or unsupported — non-fatal
  }
}

// Restore any in-flight session synchronously on module load so a page
// refresh mid-session resumes cleanly.
const restored = loadPersisted();

export const useFocusStore = create<FocusState>((set, get) => ({
  active: !!restored,
  startedAt: restored?.startedAt ?? null,
  endsAt: restored?.endsAt ?? null,
  remainingMs: restored ? Math.max(0, restored.endsAt - Date.now()) : 0,

  start(minutes) {
    const now = Date.now();
    const durationMs = Math.max(1, minutes) * 60 * 1000;
    const endsAt = now + durationMs;
    persist({ startedAt: now, endsAt });
    set({
      active: true,
      startedAt: now,
      endsAt,
      remainingMs: durationMs,
    });
  },

  cancel() {
    const { startedAt } = get();
    if (startedAt) {
      const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      if (seconds >= 60) {
        // Credit partial sessions toward the streak so an accidental
        // cancel near the end doesn't feel punitive.
        useStreakStore.getState().addReadingTime(seconds);
      }
    }
    persist(null);
    set({ active: false, startedAt: null, endsAt: null, remainingMs: 0 });
  },

  extend(minutes) {
    const { active, endsAt, startedAt } = get();
    if (!active || !endsAt || !startedAt) return;
    const newEnd = endsAt + Math.max(1, minutes) * 60 * 1000;
    persist({ startedAt, endsAt: newEnd });
    set({
      endsAt: newEnd,
      remainingMs: Math.max(0, newEnd - Date.now()),
    });
  },

  _tick() {
    const { active, endsAt, startedAt } = get();
    if (!active || !endsAt || !startedAt) return;
    const remainingMs = Math.max(0, endsAt - Date.now());
    set({ remainingMs });
    if (remainingMs === 0) {
      // Session complete → log all elapsed minutes and stop.
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      useStreakStore.getState().addReadingTime(seconds);
      persist(null);
      set({ active: false, startedAt: null, endsAt: null });
      playDing();
    }
  },
}));

// One shared tick loop — driven by setInterval, self-regulating. The
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
  // force a catch-up tick when visibility returns.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) useFocusStore.getState()._tick();
  });

  // Cleanup on HMR disposal so tests / dev don't stack timers.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      if (tickHandle) clearInterval(tickHandle);
    });
  }
}
