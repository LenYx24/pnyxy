import { useEffect, useRef, useState } from "react";
import { Timer, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusStore } from "@/stores/focus-store";

const PRESETS = [15, 30, 45, 60];

/**
 * Reader-toolbar button that opens a small popover for picking a focus
 * session duration. Active sessions are rendered by FocusSessionBadge;
 * this control only handles starting one.
 */
export function FocusSessionControl({ compact = false }: { compact?: boolean }) {
  const active = useFocusStore((s) => s.active);
  const start = useFocusStore((s) => s.start);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (active) return null; // badge takes over once a session is running

  const handleStart = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    start(minutes);
    setOpen(false);
    setCustom("");
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Start a focus session"
        className={cn(
          "rounded-md p-1.5 transition-colors cursor-pointer",
          open
            ? "bg-accent-purple/15 text-accent-purple"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )}
      >
        <Timer size={compact ? 18 : 16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl">
          <div className="flex items-center justify-between border-b border-glass-border px-3 py-2">
            <span className="text-sm font-medium text-text-primary">
              Focus session
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-text-muted hover:text-text-primary cursor-pointer"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-2">
            <p className="mb-2 px-1 text-xs text-text-muted">
              Read uninterrupted. Navigation gets hidden until the timer
              ends.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((m) => (
                <button
                  key={m}
                  onClick={() => handleStart(m)}
                  className="rounded-md border border-glass-border px-2 py-2 text-sm text-text-primary transition-colors hover:bg-glass-hover hover:border-accent-purple/50 cursor-pointer"
                >
                  {m} min
                </button>
              ))}
            </div>
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(custom, 10);
                if (Number.isFinite(n) && n > 0) handleStart(n);
              }}
            >
              <input
                type="number"
                min={1}
                max={240}
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
                placeholder="Custom"
                className="w-full rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple/50"
              />
              <button
                type="submit"
                disabled={!custom}
                className="shrink-0 rounded-md bg-accent-purple/15 px-2 py-1 text-xs font-medium text-accent-purple transition-colors hover:bg-accent-purple/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Start
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
