import { Flame, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStreakStore } from "@/stores/streak-store";
import { cn } from "@/lib/cn";

/**
 * Compact streak pill, just a flame icon with the current streak number.
 * Used on mobile where the full card would dominate the library header.
 */
export function StreakPill({ className }: { className?: string }) {
  const { t } = useTranslation();
  const getCurrentStreak = useStreakStore((s) => s.getCurrentStreak);
  const currentStreak = getCurrentStreak();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-bg/60 px-2 py-0.5",
        className,
      )}
      title={t("library.streak.dayStreak", { count: currentStreak })}
      aria-label={t("library.streak.dayStreak", { count: currentStreak })}
    >
      <Flame
        size={14}
        className={currentStreak > 0 ? "text-orange-400" : "text-text-muted"}
      />
      <span className="text-xs font-semibold text-text-primary">
        {currentStreak}
      </span>
    </div>
  );
}

export function StreakCard() {
  const { t } = useTranslation();
  const getCurrentStreak = useStreakStore((s) => s.getCurrentStreak);
  const longestStreak = useStreakStore((s) => s.longestStreak);
  const getTodayRecord = useStreakStore((s) => s.getTodayRecord);

  const currentStreak = getCurrentStreak();
  const today = getTodayRecord();
  const todayMinutes = Math.floor(today.seconds / 60);
  const goalMinutes = 5;
  const progress = Math.min(today.seconds / 300, 1);

  return (
    <div className="rounded-xl border border-glass-border bg-glass-bg/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Flame
              size={20}
              className={currentStreak > 0 ? "text-orange-400" : "text-text-muted"}
            />
            <span className="text-lg font-bold text-text-primary">
              {currentStreak}
            </span>
            <span className="text-xs text-text-muted">
              {t("library.streak.dayStreak", { count: currentStreak })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Trophy size={16} className="text-warning" />
            <span className="text-sm font-medium text-text-secondary">
              {longestStreak}
            </span>
            <span className="text-xs text-text-muted">
              {t("library.streak.best")}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-text-muted">
          <span>
            {t("library.streak.todayMinutes", { minutes: todayMinutes })}
          </span>
          <span>
            {t("library.streak.goalMinutes", { minutes: goalMinutes })}
          </span>
        </div>
        <div className="h-2 rounded-full bg-glass-bg overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              today.goalCompleted
                ? "bg-success"
                : "bg-accent"
            }`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
