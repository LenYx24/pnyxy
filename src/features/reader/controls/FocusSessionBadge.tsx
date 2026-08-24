import { Plus, Sprout, TreeDeciduous, X } from "lucide-react";
import { useFocusStore } from "@/stores/focus-store";
import { useReaderStore } from "@/stores/reader-store";
import { cn } from "@/lib/cn";

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

const RING_RADIUS = 22;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Pill badge shown while a focus session is active. Sticks to the
 * bottom-center of the reader viewport. Hides itself when no
 * session is running.
 *
 * Visual design:
 *   - SVG ring around the countdown text fills as time elapses,
 *     so progress is readable at a glance without doing the mental
 *     math from "27:14 of how long?".
 *   - In pages-goal mode the ring tracks pages-progress instead -
 *     the time bound is just a 4h safety cap and would barely move.
 *   - A sprout icon sits at the centre; past 60% completion it
 *     swaps for a deciduous tree, a soft "your effort is growing
 *     into something" cue without being preachy about it.
 *   - The whole badge has a slow accent glow that breathes
 *     in and out (custom CSS keyframes, `animate-pulse` is too
 *     aggressive for a calm focus mode).
 */
export function FocusSessionBadge() {
  const active = useFocusStore((s) => s.active);
  const startedAt = useFocusStore((s) => s.startedAt);
  const endsAt = useFocusStore((s) => s.endsAt);
  const remainingMs = useFocusStore((s) => s.remainingMs);
  const pagesGoal = useFocusStore((s) => s.pagesGoal);
  const pagesAtStart = useFocusStore((s) => s.pagesAtStart);
  const pagesDocId = useFocusStore((s) => s.pagesDocId);
  const extend = useFocusStore((s) => s.extend);
  const cancel = useFocusStore((s) => s.cancel);

  // Live page progress for the bound document. Subscribing here means the
  // badge re-renders the moment the user turns a page.
  const pagesRead = useReaderStore((s) => {
    if (pagesGoal == null || pagesAtStart == null || !pagesDocId) return null;
    const doc = s.documents.get(pagesDocId);
    if (!doc) return null;
    return Math.max(0, doc.progressPage - pagesAtStart);
  });

  if (!active || !startedAt || !endsAt) return null;

  const totalMs = Math.max(1, endsAt - startedAt);
  const timeProgress = Math.min(1, Math.max(0, 1 - remainingMs / totalMs));
  const pagesMode = pagesGoal != null;
  const pagesProgress =
    pagesMode && pagesGoal! > 0
      ? Math.min(1, Math.max(0, (pagesRead ?? 0) / pagesGoal!))
      : 0;
  // Pages mode: ring tracks pages. Time mode: ring tracks time (default).
  const ringProgress = pagesMode ? pagesProgress : timeProgress;
  const dashOffset = RING_CIRCUMFERENCE * (1 - ringProgress);
  // The growing-plant cue follows whichever progress the user is steering.
  const Grown = ringProgress >= 0.6;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent/40 bg-bg-secondary/95 px-3 py-1.5 text-sm shadow-lg backdrop-blur-md",
        // Slow ambient glow, a 4s pulse on the box-shadow rather
        // than the pre-baked Tailwind animate-pulse, which is way
        // too snappy for a focus mode meant to feel calm.
        "animate-[pnyxy-focus-glow_4s_ease-in-out_infinite]",
      )}
    >
      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
        {/* Progress ring. Rotated -90° so 0% starts at the top
            (12 o'clock), increasing clockwise, the universal
            countdown convention. */}
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            className="fill-none stroke-glass-border"
            strokeWidth="3"
          />
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            className="fill-none stroke-accent transition-[stroke-dashoffset] duration-1000 ease-linear"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        {Grown ? (
          <TreeDeciduous
            size={18}
            className={cn(
              "absolute text-success transition-all duration-700",
              ringProgress >= 0.95 && "scale-110",
            )}
          />
        ) : (
          <Sprout
            size={16}
            className="absolute text-success/80 transition-all duration-700"
            // Scale grows from 0.7 → 1.0 as we approach the 60% swap
            // so the sprout looks like it's actually maturing.
            style={{ transform: `scale(${0.7 + ringProgress * 0.5})` }}
          />
        )}
      </div>
      {pagesMode ? (
        <div className="flex flex-col leading-tight">
          <span className="font-mono tabular-nums text-text-primary">
            {pagesRead ?? 0} / {pagesGoal} oldal
          </span>
          <span className="font-mono tabular-nums text-2xs text-text-muted">
            {formatTime(remainingMs)}
          </span>
        </div>
      ) : (
        <span className="min-w-[3.25rem] font-mono tabular-nums text-text-primary">
          {formatTime(remainingMs)}
        </span>
      )}
      <div className="mx-1 h-4 w-px bg-glass-border" />
      <button
        onClick={() => extend(5)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        title="Extend by 5 minutes"
      >
        <Plus size={12} /> 5 min
      </button>
      <button
        onClick={cancel}
        className="flex items-center rounded-md p-1 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
        title="End focus session"
        aria-label="End focus session"
      >
        <X size={14} />
      </button>
    </div>
  );
}
