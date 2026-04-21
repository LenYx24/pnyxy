import { Timer, Plus, X } from "lucide-react";
import { useFocusStore } from "@/stores/focus-store";

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Pill badge shown while a focus session is active. Sticks to the
 * bottom-center of the reader viewport. Hides itself when no session
 * is running.
 */
export function FocusSessionBadge() {
  const active = useFocusStore((s) => s.active);
  const remainingMs = useFocusStore((s) => s.remainingMs);
  const extend = useFocusStore((s) => s.extend);
  const cancel = useFocusStore((s) => s.cancel);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent-purple/40 bg-bg-secondary/95 px-3 py-1.5 text-sm shadow-lg backdrop-blur-md"
    >
      <Timer size={14} className="text-accent-purple" />
      <span className="font-mono tabular-nums text-text-primary">
        {formatTime(remainingMs)}
      </span>
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
        className="flex items-center rounded-md p-1 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
        title="End focus session"
        aria-label="End focus session"
      >
        <X size={14} />
      </button>
    </div>
  );
}
