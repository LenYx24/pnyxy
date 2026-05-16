import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberInput } from "@/components/ui";
import { useRoadmapStore } from "@/stores/roadmap-store";
import type { Roadmap, SchedulePrefs } from "@/types/roadmap";
import { DEFAULT_SCHEDULE_PREFS } from "@/types/roadmap";
import {
  computeSchedule,
  formatMinutes,
  totalEstimatedMinutes,
} from "./lib/scheduler";

interface EnrollDialogProps {
  roadmap: Roadmap;
  onClose: () => void;
}

export function EnrollDialog({ roadmap, onClose }: EnrollDialogProps) {
  const { t } = useTranslation();
  const enroll = useRoadmapStore((s) => s.enroll);
  const [prefs, setPrefs] = useState<SchedulePrefs>(DEFAULT_SCHEDULE_PREFS);

  const totalMinutes = totalEstimatedMinutes(roadmap);

  // Live preview of finish date based on the current prefs.
  const finishDate = (() => {
    if (roadmap.nodes.length === 0) return null;
    const now = new Date();
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  })();

  const handleEnroll = () => {
    enroll(roadmap.id, prefs);
    onClose();
  };

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
              className="h-4 w-4 accent-accent-purple"
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
            {finishDate && (
              <p className="mt-1">
                {t("roadmaps.enroll.finishBy", { date: finishDate })}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:bg-glass-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleEnroll}
            className="rounded-md bg-accent-purple px-3 py-1.5 text-sm font-medium text-white"
          >
            {t("roadmaps.enroll.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

