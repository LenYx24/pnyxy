import { useEffect, useRef, useState } from "react";
import { Timer, X, Clock, BookOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusStore } from "@/stores/focus-store";
import { useActiveDocument } from "@/stores/reader-store";

const MINUTE_PRESETS = [15, 30, 45, 60];
const PAGE_PRESETS = [10, 20, 30, 50];
/** When the user picks pages-only, the time bound becomes a generous safety
 *  cap — long enough for a slow reader, short enough that a forgotten session
 *  doesn't run forever. */
const PAGES_MODE_TIME_CAP_MIN = 240;

type Mode = "time" | "pages";

/**
 * Reader-toolbar button that opens a small popover for picking a focus
 * session goal. The user picks either a time goal (minutes) or a page
 * goal (pages); whichever resolves first ends the session.
 */
export function FocusSessionControl({ compact = false }: { compact?: boolean }) {
  const active = useFocusStore((s) => s.active);
  const start = useFocusStore((s) => s.start);
  const activeDoc = useActiveDocument();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("time");
  const [custom, setCustom] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Pages mode requires an open document — without one there's nothing to
  // measure progress against. Keep the option visible but disabled so users
  // see it exists.
  const pagesAvailable = !!activeDoc && (activeDoc.totalPages ?? 0) > 0;

  // Dismiss on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // If pages mode was previously selected but the user navigated away from
  // the reader, fall back to time mode silently.
  useEffect(() => {
    if (mode === "pages" && !pagesAvailable) setMode("time");
  }, [mode, pagesAvailable]);

  if (active) return null; // badge takes over once a session is running

  const handleStartTime = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    start(minutes);
    setOpen(false);
    setCustom("");
  };

  const handleStartPages = (pages: number) => {
    if (!Number.isFinite(pages) || pages <= 0 || !activeDoc) return;
    start(PAGES_MODE_TIME_CAP_MIN, {
      pagesGoal: pages,
      pagesAtStart: activeDoc.progressPage,
      pagesDocId: activeDoc.meta.id,
    });
    setOpen(false);
    setCustom("");
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(custom, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    if (mode === "time") handleStartTime(n);
    else handleStartPages(n);
  };

  const presets = mode === "time" ? MINUTE_PRESETS : PAGE_PRESETS;
  const presetSuffix = mode === "time" ? "min" : "oldal";
  const customPlaceholder = mode === "time" ? "Custom min" : "Custom oldal";

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Start a focus session"
        className={cn(
          "rounded-md p-1.5 transition-colors cursor-pointer",
          open
            ? "bg-accent/15 text-accent"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )}
      >
        <Timer size={compact ? 18 : 16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl">
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

          <div className="grid grid-cols-2 gap-1 border-b border-glass-border p-1.5">
            <button
              onClick={() => setMode("time")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                mode === "time"
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              <Clock size={12} /> Idő
            </button>
            <button
              onClick={() => pagesAvailable && setMode("pages")}
              disabled={!pagesAvailable}
              title={
                pagesAvailable
                  ? "Set a pages goal"
                  : "Open a document to set a pages goal"
              }
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                mode === "pages" && pagesAvailable
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
                !pagesAvailable && "opacity-40 cursor-not-allowed",
              )}
            >
              <BookOpen size={12} /> Oldal
            </button>
          </div>

          <div className="p-2">
            <p className="mb-2 px-1 text-xs text-text-muted">
              {mode === "time"
                ? "Read uninterrupted. Navigation gets hidden until the timer ends."
                : "Session ends once you've read this many pages forward in the current document."}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {presets.map((n) => (
                <button
                  key={n}
                  onClick={() =>
                    mode === "time" ? handleStartTime(n) : handleStartPages(n)
                  }
                  className="rounded-md border border-glass-border px-2 py-2 text-sm text-text-primary transition-colors hover:bg-glass-hover hover:border-accent/50 cursor-pointer"
                >
                  {n} {presetSuffix}
                </button>
              ))}
            </div>
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={handleCustomSubmit}
            >
              <input
                type="number"
                min={1}
                max={mode === "time" ? 240 : 9999}
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
                placeholder={customPlaceholder}
                className="w-full rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
              />
              <button
                type="submit"
                disabled={!custom}
                className="shrink-0 rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
