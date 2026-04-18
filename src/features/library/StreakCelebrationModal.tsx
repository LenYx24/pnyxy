import { useEffect, useMemo } from "react";
import { Flame } from "lucide-react";
import { useStreakStore } from "@/stores/streak-store";

const CONFETTI_COLORS = [
  "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#f472b6", "#fb923c", "#facc15",
  "#4ade80", "#60a5fa", "#34d399",
  "#e879f9", "#f87171", "#fbbf24",
];

const CONFETTI_COUNT = 24;

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
    animationDelay: `${Math.random() * 1.5}s`,
    width: `${6 + Math.random() * 6}px`,
    height: `${6 + Math.random() * 6}px`,
    backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    borderRadius: Math.random() > 0.5 ? "50%" : "2px",
    transform: `rotate(${Math.random() * 360}deg)`,
  }));
}

function Confetti() {
  // Randomise once per mount so positions stay stable across renders.
  const pieces = useMemo(() => buildConfetti(), []);
  return (
    <div className="pointer-events-none fixed inset-0 z-[101] overflow-hidden">
      {pieces.map((style, i) => (
        <div
          key={i}
          className="absolute top-0 animate-[confetti-fall_3s_ease-in_forwards]"
          style={style}
        />
      ))}
    </div>
  );
}

export function StreakCelebrationModal() {
  const shouldShow = useStreakStore((s) => s.shouldShowCelebration());
  const markCelebrationShown = useStreakStore((s) => s.markCelebrationShown);
  const getCurrentStreak = useStreakStore((s) => s.getCurrentStreak);

  // Auto-dismiss after 4s; the store flag controls visibility directly.
  useEffect(() => {
    if (!shouldShow) return;
    const timer = setTimeout(markCelebrationShown, 4000);
    return () => clearTimeout(timer);
  }, [shouldShow, markCelebrationShown]);

  if (!shouldShow) return null;

  const streak = getCurrentStreak();

  return (
    <>
      <Confetti />
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={markCelebrationShown}
      >
        <div className="animate-[celebration-pop_0.4s_ease-out] rounded-2xl border border-glass-border bg-bg-secondary p-8 text-center shadow-2xl max-w-sm mx-4">
          <div className="mb-4 flex justify-center">
            <Flame
              size={48}
              className="text-orange-400 animate-[celebration-fire-pulse_1s_ease-in-out_infinite]"
            />
          </div>
          <h2 className="text-2xl font-bold text-text-primary mb-2">
            Reading Goal Complete!
          </h2>
          <p className="text-text-secondary mb-1">
            You read for 5 minutes today.
          </p>
          {streak > 1 && (
            <p className="text-accent-purple font-medium">
              {streak} day streak!
            </p>
          )}
        </div>
      </div>
    </>
  );
}
