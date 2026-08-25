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

const CONFETTI_COUNT = 48;
// fallback auto-dismiss so the toast never sits forever
const TOAST_DURATION_MS = 5 * 60 * 1000;

interface ConfettiPiece {
  left: string;
  animationDelay: string;
  animationDuration: string;
  animationTimingFunction: string;
  width: string;
  height: string;
  backgroundColor: string;
  borderRadius: string;
  transform: string;
  // read by the confetti-fall keyframe for per-piece horizontal drift
  ["--confetti-drift"]: string;
}

function buildConfetti(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    // vary duration so pieces don't fall as one horizontal stripe
    const duration = 2.5 + Math.random() * 3.5;
    const delay = Math.random() * 2.5;
    // ±25vw so the field spreads sideways
    const drift = (Math.random() - 0.5) * 50;
    return {
      left: `${Math.random() * 100}%`,
      animationDelay: `${delay}s`,
      animationDuration: `${duration}s`,
      // mix timing curves so pieces don't fall in lockstep
      animationTimingFunction:
        i % 3 === 0 ? "ease-in" : i % 3 === 1 ? "linear" : "ease-out",
      width: `${6 + Math.random() * 6}px`,
      height: `${6 + Math.random() * 6}px`,
      backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      borderRadius: Math.random() > 0.5 ? "50%" : "2px",
      transform: `rotate(${Math.random() * 360}deg)`,
      "--confetti-drift": `${drift}vw`,
    };
  });
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
            animationName: "confetti-fall",
            animationFillMode: "forwards",
          }}
        />
      ))}
    </div>
  );
}

/** Non-blocking streak celebration toast. No backdrop, screen stays interactive. */
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
        // bottom-20 on mobile clears the ~64px BottomNav
        className="fixed bottom-20 left-1/2 z-[100] -translate-x-1/2 sm:left-6 sm:bottom-6 sm:translate-x-0 animate-[celebration-pop_0.35s_ease-out] w-[calc(100vw-2rem)] max-w-sm rounded-page bg-bg-tertiary p-4 shadow-page"
      >
        <div className="flex items-start gap-3">
          <Flame
            size={28}
            strokeWidth={1.5}
            className="shrink-0 text-streak animate-[celebration-fire-pulse_1.2s_ease-in-out_infinite]"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold text-text-primary">
              {t("library.celebration.title")}
            </h2>
            <p className="text-xs text-text-secondary">
              {t("library.celebration.body")}
            </p>
            {streak > 1 && (
              <p className="mt-1 text-xs font-medium text-streak">
                {t("library.celebration.streak", { count: streak })}
              </p>
            )}
          </div>
        </div>
        {/* dismiss button on its own row for a decent mobile tap target */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={markCelebrationShown}
            className="inline-flex items-center gap-1.5 rounded-control bg-success/15 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/25 cursor-pointer"
          >
            <Check size={14} strokeWidth={2.5} />
            {t("library.celebration.acknowledge", { defaultValue: "Got it" })}
          </button>
        </div>
      </div>
    </>
  );
}
