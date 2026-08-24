import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, Clock } from "lucide-react";
import { Button, NumberInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useRoadmapStore } from "@/stores/roadmap-store";
import type { Roadmap, SchedulePrefs } from "@/types/roadmap";
import { DEFAULT_SCHEDULE_PREFS } from "@/types/roadmap";
import {
  computeSchedule,
  deriveHoursForDeadline,
  formatMinutes,
  parseYmd,
  totalEstimatedMinutes,
  ymd,
} from "./lib/scheduler";

interface EnrollDialogProps {
  roadmap: Roadmap;
  onClose: () => void;
}

type ScheduleMode = "hours" | "deadline";

export function EnrollDialog({ roadmap, onClose }: EnrollDialogProps) {
  const { t } = useTranslation();
  const enroll = useRoadmapStore((s) => s.enroll);
  const setDeadline = useRoadmapStore((s) => s.setDeadline);

  // Two parallel input modes. "hours" is the original UX: pick your
  // weekday + weekend hours, finish date is shown as a preview. The
  // new "deadline" mode flips the dependency, pick a finish date
  // and a weekend-vs-weekday multiplier, and the system derives the
  // hours required to land on that date. The two modes share the
  // same total-minutes anchor so the math stays consistent across
  // the toggle.
  const [mode, setMode] = useState<ScheduleMode>("hours");
  const [prefs, setPrefs] = useState<SchedulePrefs>(DEFAULT_SCHEDULE_PREFS);

  // Deadline mode state. Default: 4 weeks out, 1× multiplier (treat
  // weekends like weekdays). Picked as a sane starting point, the
  // exact date barely matters because the user will adjust it before
  // confirming.
  const [targetEndDate, setTargetEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 28);
    return ymd(d);
  });
  const [weekendMultiplier, setWeekendMultiplier] = useState<number>(1);

  const totalMinutes = totalEstimatedMinutes(roadmap);
  const todayYmd = ymd(new Date());

  // Hours-mode preview: derived finish date
  const hoursModeFinish = useMemo(() => {
    if (mode !== "hours") return null;
    if (roadmap.nodes.length === 0) return null;
    const now = new Date();
    const startDate = ymd(now);
    const fakeEnrollment = {
      id: "preview",
      roadmapId: roadmap.id,
      userId: null,
      startDate,
      nodeProgress: {},
      schedulePrefs: prefs,
      createdAt: 0,
      updatedAt: 0,
    };
    const sched = computeSchedule(roadmap, fakeEnrollment);
    let last: string | undefined;
    for (const v of sched.values()) {
      if (!last || v.dueDate > last) last = v.dueDate;
    }
    return last;
  }, [mode, roadmap, prefs]);

  // Deadline-mode preview: derived per-day hours
  const deadlineDerivation = useMemo(() => {
    if (mode !== "deadline") return null;
    if (!targetEndDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return deriveHoursForDeadline({
      totalMinutes,
      today,
      endDate: parseYmd(targetEndDate),
      weekendMultiplier,
    });
  }, [mode, totalMinutes, targetEndDate, weekendMultiplier]);

  const handleEnroll = () => {
    if (mode === "hours") {
      enroll(roadmap.id, prefs);
    } else {
      // Deadline mode: enroll with the defaults first so the
      // enrollment exists, then call setDeadline which (a) pins
      // targetEndDate + weekendMultiplier on the enrollment and
      // (b) derives the required weekday/weekend hours via the
      // same scheduler helper the preview just used. Two writes,
      // but they hit the in-memory store so the user sees a single
      // settled state in one render.
      const enrollment = enroll(roadmap.id);
      if (targetEndDate) {
        setDeadline(enrollment.id, targetEndDate, weekendMultiplier);
      }
    }
    onClose();
  };

  const deadlineFeasible =
    deadlineDerivation === null || deadlineDerivation.feasible;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-glass-border bg-bg-secondary p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text-primary">
          {t("roadmaps.enroll.title")}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {t("roadmaps.enroll.subtitle")}
        </p>

        {/* Mode toggle: segmented control. Visual style matches the
            paired-button patterns used elsewhere in the app
            (highlight color picker, list/grid toggle). */}
        <div
          role="tablist"
          aria-label={t("roadmaps.enroll.modeAria", {
            defaultValue: "Scheduling mode",
          })}
          className="mt-4 grid grid-cols-2 gap-1 rounded-md border border-glass-border bg-bg-primary/40 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "hours"}
            onClick={() => setMode("hours")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              mode === "hours"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <Clock size={12} />
            {t("roadmaps.enroll.modeHours", { defaultValue: "Hours/day" })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "deadline"}
            onClick={() => setMode("deadline")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              mode === "deadline"
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <CalendarClock size={12} />
            {t("roadmaps.enroll.modeDeadline", { defaultValue: "Target date" })}
          </button>
        </div>

        {mode === "hours" && (
          <div className="mt-4 space-y-3">
            <NumberInput
              label={t("roadmaps.enroll.weekdayHours")}
              value={prefs.weekdayHours}
              min={0}
              step={0.25}
              suffix="h"
              onChange={(v) =>
                setPrefs((p) => ({
                  ...p,
                  weekdayHours: Number.isNaN(v) ? 0 : v,
                }))
              }
            />

            <label className="flex items-center justify-between gap-3 rounded-lg border border-glass-border px-3 py-2 text-sm">
              <span className="text-text-primary">
                {t("roadmaps.enroll.workOnWeekends")}
              </span>
              <input
                type="checkbox"
                checked={prefs.workOnWeekends}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, workOnWeekends: e.target.checked }))
                }
                className="h-4 w-4 accent-accent"
              />
            </label>

            {prefs.workOnWeekends && (
              <NumberInput
                label={t("roadmaps.enroll.weekendHours")}
                value={prefs.weekendHours}
                min={0}
                step={0.25}
                suffix="h"
                onChange={(v) =>
                  setPrefs((p) => ({
                    ...p,
                    weekendHours: Number.isNaN(v) ? 0 : v,
                  }))
                }
              />
            )}

            <div className="rounded-lg bg-glass-bg/50 p-3 text-xs text-text-secondary">
              <p>
                {t("roadmaps.enroll.totalEstimate", {
                  total: formatMinutes(totalMinutes),
                })}
              </p>
              {hoursModeFinish && (
                <p className="mt-1">
                  {t("roadmaps.enroll.finishBy", { date: hoursModeFinish })}
                </p>
              )}
            </div>
          </div>
        )}

        {mode === "deadline" && (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                {t("roadmaps.enroll.deadlineDate", {
                  defaultValue: "Finish by",
                })}
              </span>
              <input
                type="date"
                value={targetEndDate}
                min={todayYmd}
                onChange={(e) => setTargetEndDate(e.target.value)}
                className="w-full rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
              />
            </label>

            <div>
              <label className="flex items-center justify-between text-2xs text-text-secondary">
                <span>
                  {t("roadmaps.enroll.weekendMultiplier", {
                    defaultValue: "Weekend vs weekday pace",
                  })}
                </span>
                <span className="font-mono text-text-primary">
                  {weekendMultiplier.toFixed(1)}×
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={weekendMultiplier}
                onChange={(e) => setWeekendMultiplier(Number(e.target.value))}
                className="mt-1 w-full accent-accent"
                aria-label={t("roadmaps.enroll.weekendMultiplier", {
                  defaultValue: "Weekend vs weekday pace",
                })}
              />
              <p className="mt-1 text-2xs text-text-muted">
                {weekendMultiplier === 0
                  ? t("roadmaps.enroll.weekendMultiplierZeroHint", {
                      defaultValue:
                        "Weekends off, all work happens on weekdays.",
                    })
                  : t("roadmaps.enroll.weekendMultiplierHint", {
                      defaultValue:
                        "Weekends carry {{multiplier}}× a weekday's load.",
                      multiplier: weekendMultiplier.toFixed(1),
                    })}
              </p>
            </div>

            {deadlineDerivation && (
              <div className="rounded-lg bg-glass-bg/50 p-3 text-2xs">
                {deadlineDerivation.feasible ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-text-muted">
                        {t("roadmaps.deadline.perWeekday", {
                          defaultValue: "Per weekday",
                        })}
                      </span>
                      <span className="font-medium text-text-primary">
                        {formatMinutes(
                          deadlineDerivation.weekdayHours * 60,
                        )}
                      </span>
                    </div>
                    {deadlineDerivation.workOnWeekends && (
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">
                          {t("roadmaps.deadline.perWeekend", {
                            defaultValue: "Per weekend day",
                          })}
                        </span>
                        <span className="font-medium text-text-primary">
                          {formatMinutes(
                            deadlineDerivation.weekendHours * 60,
                          )}
                        </span>
                      </div>
                    )}
                    <div className="mt-1.5 border-t border-glass-border/50 pt-1.5 text-text-muted">
                      {t("roadmaps.deadline.coverage", {
                        total: formatMinutes(totalMinutes),
                        weekdays:
                          deadlineDerivation.daysAvailable.weekdays,
                        weekends:
                          deadlineDerivation.daysAvailable.weekends,
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5 text-warning">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>
                      {t("roadmaps.deadline.infeasible", {
                        defaultValue:
                          "Not feasible, the date is in the past or there's no time available.",
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleEnroll} disabled={!deadlineFeasible}>
            {t("roadmaps.enroll.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
