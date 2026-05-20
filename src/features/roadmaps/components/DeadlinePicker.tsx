import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, AlertTriangle } from "lucide-react";
import type { Enrollment, Roadmap } from "@/types/roadmap";
import {
  deriveHoursForDeadline,
  formatMinutes,
  parseYmd,
  remainingEstimatedMinutes,
  ymd,
} from "../lib/scheduler";

interface DeadlinePickerProps {
  roadmap: Roadmap;
  enrollment: Enrollment;
  /** Bound to the store's setDeadline action. */
  onChange: (date: string | null, weekendMultiplier: number) => void;
}

/**
 * Sidebar control on the roadmap detail page: lets the user pick a
 * target finish date, optionally weight weekend days more heavily,
 * and see the derived per-day study load. Saving any input writes
 * the deadline + multiplier through to the store, which in turn
 * derives `schedulePrefs.weekdayHours`/`weekendHours` so the
 * scheduler's per-node due dates reflow automatically.
 */
export function DeadlinePicker({
  roadmap,
  enrollment,
  onChange,
}: DeadlinePickerProps) {
  const { t } = useTranslation();

  const remainingMinutes = useMemo(
    () => remainingEstimatedMinutes(roadmap, enrollment),
    [roadmap, enrollment],
  );

  // Current values. `weekendMultiplier === undefined` means "manual
  // mode" — show 1 as the default the user can tweak; we only persist
  // a real multiplier once they actually pick a date.
  const targetEndDate = enrollment.targetEndDate ?? "";
  const multiplier = enrollment.schedulePrefs.weekendMultiplier ?? 1;
  const todayYmd = ymd(new Date());

  const derived = useMemo(() => {
    if (!targetEndDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deriveHoursForDeadline({
      totalMinutes: remainingMinutes,
      today,
      endDate: parseYmd(targetEndDate),
      weekendMultiplier: multiplier,
    });
  }, [targetEndDate, remainingMinutes, multiplier]);

  const handleDateChange = (next: string) => {
    onChange(next || null, multiplier);
  };

  const handleMultiplierChange = (next: number) => {
    // Multiplier only takes effect once a date is set — but updating it
    // beforehand would silently lose the user's tweak. Persist it under
    // a date if one exists; otherwise just no-op until they pick a date.
    if (!targetEndDate) return;
    onChange(targetEndDate, Math.max(0, next));
  };

  const handleClear = () => onChange(null, multiplier);

  return (
    <div className="mt-4 space-y-3 rounded-md border border-glass-border bg-bg-secondary/40 p-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
          <CalendarClock size={12} />
          {t("roadmaps.deadline.heading")}
        </label>
        {targetEndDate && (
          <button
            onClick={handleClear}
            className="text-[11px] text-accent-purple hover:underline"
          >
            {t("roadmaps.deadline.clear")}
          </button>
        )}
      </div>

      <input
        type="date"
        value={targetEndDate}
        min={todayYmd}
        onChange={(e) => handleDateChange(e.target.value)}
        className="w-full rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent-purple"
      />

      <div>
        <label className="flex items-center justify-between text-[11px] text-text-secondary">
          <span>{t("roadmaps.deadline.weekendMultiplier")}</span>
          <span className="font-mono text-text-primary">
            {multiplier.toFixed(1)}×
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={multiplier}
          onChange={(e) => handleMultiplierChange(Number(e.target.value))}
          disabled={!targetEndDate}
          className="mt-1 w-full accent-accent-purple disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("roadmaps.deadline.weekendMultiplier")}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          {multiplier === 0
            ? t("roadmaps.deadline.weekendMultiplierZeroHint")
            : t("roadmaps.deadline.weekendMultiplierHint", {
                multiplier: multiplier.toFixed(1),
              })}
        </p>
      </div>

      {derived && (
        <div className="rounded-md bg-glass-bg/60 p-2.5 text-[11px]">
          {derived.feasible ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">
                  {t("roadmaps.deadline.perWeekday")}
                </span>
                <span className="font-medium text-text-primary">
                  {formatMinutes(derived.weekdayHours * 60)}
                </span>
              </div>
              {derived.workOnWeekends && (
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">
                    {t("roadmaps.deadline.perWeekend")}
                  </span>
                  <span className="font-medium text-text-primary">
                    {formatMinutes(derived.weekendHours * 60)}
                  </span>
                </div>
              )}
              <div className="mt-1.5 border-t border-glass-border/50 pt-1.5 text-text-muted">
                {t("roadmaps.deadline.coverage", {
                  total: formatMinutes(remainingMinutes),
                  weekdays: derived.daysAvailable.weekdays,
                  weekends: derived.daysAvailable.weekends,
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-1.5 text-yellow-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{t("roadmaps.deadline.infeasible")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
