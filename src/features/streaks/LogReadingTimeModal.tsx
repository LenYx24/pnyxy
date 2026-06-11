import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import {
  MANUAL_BACKFILL_DAYS,
  MAX_MANUAL_MINUTES_PER_DAY,
  useStreakStore,
} from "@/stores/streak-store";

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDateOptions(): Array<{ value: string; label: string }> {
  // Today plus the last MANUAL_BACKFILL_DAYS, newest first.
  const out: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 0; i <= MANUAL_BACKFILL_DAYS; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const value = dateKey(d);
    const label = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    out.push({ value, label });
  }
  return out;
}

/**
 * Modal that lets the user log reading minutes for today or any of
 * the previous MANUAL_BACKFILL_DAYS days. Validation lives in the
 * store; this layer just renders the picker and surfaces errors.
 */
export function LogReadingTimeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addManual = useStreakStore((s) => s.addManualReadingTime);

  const [selectedDate, setSelectedDate] = useState<string>(() => dateKey(new Date()));
  const [minutes, setMinutes] = useState<string>("15");
  const [error, setError] = useState<string | null>(null);

  // Reset on open via the in-render guard pattern (avoids
  // setState-in-effect lint warning).
  const [openSnapshot, setOpenSnapshot] = useState(open);
  if (open !== openSnapshot) {
    setOpenSnapshot(open);
    if (open) {
      setSelectedDate(dateKey(new Date()));
      setMinutes("15");
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const options = buildDateOptions();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(minutes, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("streaks.log.errors.invalidMinutes"));
      return;
    }
    if (parsed > MAX_MANUAL_MINUTES_PER_DAY) {
      setError(
        t("streaks.log.errors.tooMany", { max: MAX_MANUAL_MINUTES_PER_DAY }),
      );
      return;
    }
    const ok = addManual(selectedDate, parsed * 60);
    if (!ok) {
      setError(t("streaks.log.errors.rejected"));
      return;
    }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-time-title"
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl"
      >
        <h3
          id="log-time-title"
          className="mb-2 text-lg font-semibold text-text-primary"
        >
          {t("streaks.log.title")}
        </h3>
        <p className="mb-4 text-sm text-text-muted">
          {t("streaks.log.description", { days: MANUAL_BACKFILL_DAYS })}
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t("streaks.log.day")}
          </span>
          <select
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setError(null);
            }}
            className="w-full rounded-md border border-glass-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          >
            {options.map((o, idx) => (
              <option key={o.value} value={o.value}>
                {idx === 0 ? `${o.label} (${t("streaks.log.today")})` : o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-1 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            {t("streaks.log.minutes")}
          </span>
          <input
            type="number"
            min={1}
            max={MAX_MANUAL_MINUTES_PER_DAY}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setError(null);
            }}
            className="w-full rounded-md border border-glass-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
        </label>

        {error && (
          <p className="mb-2 text-xs text-danger" role="alert">
            {error}
          </p>
        )}

        <p className="mb-4 text-2xs text-text-muted">
          {t("streaks.log.leaderboardNote")}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/30"
          >
            {t("streaks.log.submit")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
