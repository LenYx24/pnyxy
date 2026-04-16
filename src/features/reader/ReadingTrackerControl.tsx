import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, BookCheck } from "lucide-react";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  TRACKERS,
  getTracker,
  type ToggleTrackerSettings,
} from "@/lib/reading-trackers";
import { Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Toolbar button + popover for reading-progress tracking.
 *
 * Currently only the "toggle" tracker exists, so the popover renders
 * its specific controls (an on/off switch and a manual override).
 * When more trackers ship, switch on `activeTrackerId` here or
 * extract a per-tracker controls registry.
 */
export function ReadingTrackerControl({ compact = false }: { compact?: boolean }) {
  const activeDoc = useActiveDocument();
  const manualSetProgress = useReaderStore((s) => s.manualSetProgress);
  const activeTrackerId = useSettingsStore((s) => s.activeTrackerId);
  const trackerSettings = useSettingsStore((s) => s.trackerSettings);
  const updateTrackerSettings = useSettingsStore((s) => s.updateTrackerSettings);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const tracker = useMemo(() => getTracker(activeTrackerId), [activeTrackerId]);
  const settings = trackerSettings[activeTrackerId] ?? tracker.defaultSettings;

  // Toggle-tracker convenience — only valid when that tracker is active.
  const isToggleTracker = activeTrackerId === "toggle";
  const toggleEnabled = isToggleTracker
    ? (settings as unknown as ToggleTrackerSettings).enabled
    : true;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!activeDoc) return null;

  const Icon = toggleEnabled ? Eye : EyeOff;
  const buttonTitle = isToggleTracker
    ? toggleEnabled
      ? "Reading tracking is on"
      : "Reading tracking is off — browsing freely"
    : `Active tracker: ${tracker.name}`;

  const progressPct = activeDoc.totalPages
    ? Math.round((activeDoc.progressPage / activeDoc.totalPages) * 100)
    : 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "rounded-md p-1.5 transition-colors cursor-pointer flex items-center gap-1",
          toggleEnabled
            ? "text-text-secondary hover:bg-glass-hover hover:text-text-primary"
            : "text-amber-400 hover:bg-glass-hover",
        )}
        title={buttonTitle}
      >
        <Icon size={16} />
        {!compact && (
          <span className="text-[10px] font-medium tabular-nums">
            {progressPct}%
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl p-3">
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-text-muted">
                  Reading progress
                </span>
                <span className="text-[10px] text-text-muted">
                  {tracker.name}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-lg font-semibold text-text-primary tabular-nums">
                  {activeDoc.progressPage}
                </span>
                <span className="text-xs text-text-muted">
                  / {activeDoc.totalPages} pages ({progressPct}%)
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-glass-bg overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent-purple transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Tracker-specific controls (toggle tracker for v1) */}
            {isToggleTracker && (
              <div className="flex items-center justify-between gap-3 py-2 border-t border-glass-border">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-primary">
                    Track reading
                  </div>
                  <div className="text-[11px] text-text-muted leading-snug">
                    {toggleEnabled
                      ? "Pages you visit count as read."
                      : "Browse without affecting your progress."}
                  </div>
                </div>
                <Toggle
                  checked={toggleEnabled}
                  onChange={(checked) =>
                    updateTrackerSettings("toggle", { enabled: checked })
                  }
                  label="Track reading"
                />
              </div>
            )}

            <button
              onClick={() => {
                manualSetProgress(activeDoc.currentPage);
                setOpen(false);
              }}
              className="mt-2 w-full flex items-center justify-center gap-2 rounded-md border border-glass-border bg-glass-bg px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <BookCheck size={14} />
              Set progress to page {activeDoc.currentPage}
            </button>

            {Object.keys(TRACKERS).length > 1 && (
              <div className="mt-3 pt-2 border-t border-glass-border text-[11px] text-text-muted">
                Change tracker in Settings.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
