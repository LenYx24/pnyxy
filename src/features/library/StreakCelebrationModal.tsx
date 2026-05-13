import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Check } from "lucide-react";
import { useStreakStore } from "@/stores/streak-store";

const CONFETTI_COLORS = [
  "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#f472b6", "#fb923c", "#facc15",
  "#4ade80", "#60a5fa", "#34d399",
  "#e879f9", "#f87171", "#fbbf24",
];

// Doubled from the previous 24 pieces × 2.5s so the celebration
// actually registers. ~50 pieces is still cheap; the animation is
// pure CSS transforms on absolutely-positioned divs.
const CONFETTI_COUNT = 48;
const CONFETTI_DURATION_S = 5;
// Hard fallback dismiss — 5 minutes is long enough that an inattentive
// user almost certainly comes back, sees their streak, and clicks the
// confirm button. Without a cap the toast could sit on a forgotten
// tab forever; with one it eventually clears itself even if the user
// never returns.
const TOAST_DURATION_MS = 5 * 60 * 1000;

interface ConfettiPiece {
  left: string;
  animationDelay: string;
  width: string;
  height: string;
  backgroundColor: string;
  borderRadius: string;
  transform: string;
}

function buildConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    animationDelay: `${Math.random() * 1.2}s`,
    width: `${6 + Math.random() * 6}px`,
    height: `${6 + Math.random() * 6}px`,
    backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    borderRadius: Math.random() > 0.5 ? "50%" : "2px",
    transform: `rotate(${Math.random() * 360}deg)`,
  }));
}

function Confetti() {
  const pieces = useMemo(() => buildConfetti(), []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[101] overflow-hidden">
      {pieces.map((style, i) => (
        <div
          key={i}
          className="absolute top-0"
          style={{
            ...style,
            animation: `confetti-fall ${CONFETTI_DURATION_S}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Streak celebration — toast-style so it doesn't interrupt what
 * the user was doing.
 *
 * Pinned to bottom-left on desktop, bottom-center on mobile (with
 * a bottom offset so it clears the persistent BottomNav). No
 * backdrop, no blur — the screen behind stays interactive. Click
 * the toast or wait {@link TOAST_DURATION_MS}; either way it
 * dismisses. Confetti is still full-screen because that's the
 * whole point of confetti, just trimmed to a shorter duration than
 * the toast so the screen feels calm by the time the user reads
 * the streak number.
 */
export function StreakCelebrationModal() {
  const { t } = useTranslation();
  const shouldShow = useStreakStore((s) => s.shouldShowCelebration());
  const markCelebrationShown = useStreakStore((s) => s.markCelebrationShown);
  const getCurrentStreak = useStreakStore((s) => s.getCurrentStreak);

  useEffect(() => {
    if (!shouldShow) return;
    const timer = setTimeout(markCelebrationShown, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [shouldShow, markCelebrationShown]);

  if (!shouldShow) return null;

  const streak = getCurrentStreak();

  return (
    <>
      <Confetti />
      <div
        role="status"
        aria-live="polite"
        // bottom-20 on mobile clears the global BottomNav (which is
        // ~64px tall). bottom-6 / left-6 on sm:+ gives the toast a
        // comfortable corner anchor on desktop. max-w-sm caps it
        // from spreading too wide on tablet. The toast is no longer
        // click-anywhere-to-dismiss — that was too easy to trigger
        // by accident while scrolling. Only the "Got it" button
        // closes it now.
        className="fixed bottom-20 left-1/2 z-[100] -translate-x-1/2 sm:left-6 sm:bottom-6 sm:translate-x-0 animate-[celebration-pop_0.35s_ease-out] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-glass-border bg-bg-secondary p-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <Flame
            size={28}
            className="shrink-0 text-orange-400 animate-[celebration-fire-pulse_1.2s_ease-in-out_infinite]"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-text-primary">
              {t("library.celebration.title")}
            </h2>
            <p className="text-xs text-text-secondary">
              {t("library.celebration.body")}
            </p>
            {streak > 1 && (
              <p className="mt-1 text-xs font-medium text-accent-purple">
                {t("library.celebration.streak", { count: streak })}
              </p>
            )}
          </div>
        </div>
        {/* Positive dismiss button — green check + label so the
            interaction reads as "yes I see it, nice" rather than
            "make this go away". Sits on its own row underneath so
            it has a real target size on mobile. */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={markCelebrationShown}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 cursor-pointer"
          >
            <Check size={14} strokeWidth={2.5} />
            {t("library.celebration.acknowledge", { defaultValue: "Got it" })}
          </button>
        </div>
      </div>
    </>
  );
}
