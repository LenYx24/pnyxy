import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  getDailyIntensity,
  type DailyRecord,
  type IntensityLevel,
} from "@/stores/streak-store";

const WEEKS = 12;
const DAYS = WEEKS * 7;

interface HeatmapCell {
  key: string;
  date: Date;
  seconds: number;
  manualSeconds: number;
  intensity: IntensityLevel;
  goalCompleted: boolean;
  /** True when this slot is in the future (the trailing week may
   *  reach past today depending on the day-of-week alignment). */
  future: boolean;
}

/** Tailwind classes per intensity level. Five steps mirror GitHub's
 *  contributions chart: empty → faint → light → medium → strong. */
const INTENSITY_CLASSES: Record<IntensityLevel, string> = {
  0: "bg-glass-bg/40 border-glass-border",
  1: "bg-success/20 border-success/30",
  2: "bg-success/40 border-success/50",
  3: "bg-success/65 border-success/70",
  4: "bg-success border-success",
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GitHub-style activity heatmap. 7 rows (one per weekday) × 12
 * columns (one per week). Newest week on the right, oldest on the
 * left — eyes naturally drift toward the active end. Empty days
 * stay visible so the user can see the gaps, not just the fills.
 */
export function StreakHeatmap({
  records,
}: {
  records: Record<string, DailyRecord>;
}) {
  const { t } = useTranslation();

  const cells = useMemo<HeatmapCell[]>(() => {
    const out: HeatmapCell[] = [];
    const now = new Date();
    // Walk DAYS-1 days back from today, then forward through today.
    // Result is oldest-first, which is the natural fill order for
    // a left-to-right weekly grid.
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const rec = records[key];
      const seconds = rec?.seconds ?? 0;
      out.push({
        key,
        date: d,
        seconds,
        manualSeconds: rec?.manualSeconds ?? 0,
        intensity: getDailyIntensity(seconds),
        goalCompleted: rec?.goalCompleted ?? false,
        future: false,
      });
    }
    return out;
  }, [records]);

  // Re-shape into [weekday][week] for grid rendering. We start each
  // column on Monday and let the last (most recent) column carry
  // empty slots for days after today within this week.
  const grid: Array<HeatmapCell | null>[] = Array.from({ length: 7 }, () =>
    Array<HeatmapCell | null>(WEEKS).fill(null),
  );
  // Find the Monday of the first column (week containing the oldest
  // cell). JS getDay(): 0=Sun, 1=Mon, …, 6=Sat. We treat Mon as the
  // top row, so map to 0..6 with Mon=0.
  const monIdx = (jsDay: number) => (jsDay + 6) % 7;
  cells.forEach((cell) => {
    const row = monIdx(cell.date.getDay());
    // Compute the column by counting weeks between this cell's
    // Monday and today's Monday (inclusive).
    const weeksFromOldest = Math.floor(
      (cell.date.getTime() -
        new Date(cells[0].date).setHours(0, 0, 0, 0)) /
        (1000 * 60 * 60 * 24 * 7),
    );
    const col = weeksFromOldest;
    if (col >= 0 && col < WEEKS) {
      grid[row][col] = cell;
    }
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {/* 7 rows × WEEKS cols. Each column is one week, oldest left. */}
        <div className="grid grid-rows-7 gap-1">
          {grid.map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-1">
              {row.map((cell, colIdx) => {
                if (!cell) {
                  return (
                    <div
                      key={`empty-${rowIdx}-${colIdx}`}
                      aria-hidden
                      className="h-3 w-3 rounded-sm border border-transparent"
                    />
                  );
                }
                const minutes = Math.floor(cell.seconds / 60);
                const manualMin = Math.floor(cell.manualSeconds / 60);
                const dateLabel = cell.date.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });
                const tooltip =
                  manualMin > 0
                    ? t("streaks.heatmap.tooltipMixed", {
                        date: dateLabel,
                        minutes,
                        manualMinutes: manualMin,
                      })
                    : t("streaks.heatmap.tooltip", {
                        date: dateLabel,
                        minutes,
                      });
                return (
                  <div
                    key={cell.key}
                    title={tooltip}
                    className={cn(
                      "h-3 w-3 rounded-sm border transition-colors",
                      INTENSITY_CLASSES[cell.intensity],
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-2xs text-text-muted">
        <span>{t("streaks.heatmap.less")}</span>
        {([0, 1, 2, 3, 4] as IntensityLevel[]).map((lvl) => (
          <span
            key={lvl}
            className={cn(
              "h-3 w-3 rounded-sm border",
              INTENSITY_CLASSES[lvl],
            )}
            aria-hidden
          />
        ))}
        <span>{t("streaks.heatmap.more")}</span>
      </div>
    </div>
  );
}
