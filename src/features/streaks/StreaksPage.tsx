import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Flame, Trophy, Target, Calendar, Brain, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { GOAL_SECONDS, useStreakStore } from "@/stores/streak-store";
import { cn } from "@/lib/cn";
import { ReadingPlansSection } from "./ReadingPlansSection";
import { StreakHeatmap } from "./StreakHeatmap";
import { LogReadingTimeModal } from "./LogReadingTimeModal";

// 12-week heatmap (84 days). 30 was nice but the GitHub-style grid
// works best when there's enough columns to feel like a "year"
// rather than a wall of dots.
const HISTORY_DAYS = 84;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildHistory(records: Record<string, { seconds: number; goalCompleted: boolean }>) {
  const out: Array<{
    key: string;
    date: Date;
    seconds: number;
    goalCompleted: boolean;
  }> = [];
  const now = new Date();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const rec = records[key];
    out.push({
      key,
      date: d,
      seconds: rec?.seconds ?? 0,
      goalCompleted: rec?.goalCompleted ?? false,
    });
  }
  return out;
}

export function StreaksPage() {
  const { t } = useTranslation();
  const getCurrentStreak = useStreakStore((s) => s.getCurrentStreak);
  const longestStreak = useStreakStore((s) => s.longestStreak);
  const longestAttentionSeconds = useStreakStore((s) => s.longestAttentionSeconds);
  const getTodayRecord = useStreakStore((s) => s.getTodayRecord);
  const dailyRecords = useStreakStore((s) => s.dailyRecords);

  const [logOpen, setLogOpen] = useState(false);

  const currentStreak = getCurrentStreak();
  const today = getTodayRecord();
  const todayMinutes = Math.floor(today.seconds / 60);
  const todayProgress = Math.min(today.seconds / GOAL_SECONDS, 1);

  const history = useMemo(() => buildHistory(dailyRecords), [dailyRecords]);
  const completedDays = history.filter((d) => d.goalCompleted).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
            <Flame size={20} className="text-orange-400" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("streaks.title")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => setLogOpen(true)}
            className="px-3 py-1.5 text-xs"
          >
            <Plus size={14} />
            {t("streaks.log.button")}
          </Button>
          <Link
            to="/leaderboards"
            className="inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
          >
            <Trophy size={14} className="text-warning" />
            {t("streaks.viewLeaderboards")}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Flame size={20} className={currentStreak > 0 ? "text-orange-400" : "text-text-muted"} />}
          label={t("streaks.currentStreak")}
          value={currentStreak}
          suffix={t("streaks.day", { count: currentStreak })}
        />
        <StatTile
          icon={<Trophy size={20} className="text-warning" />}
          label={t("streaks.longestStreak")}
          value={longestStreak}
          suffix={t("streaks.day", { count: longestStreak })}
        />
        <StatTile
          icon={<Brain size={20} className="text-sky-400" />}
          label={t("streaks.longestAttention")}
          value={Math.floor(longestAttentionSeconds / 60)}
          suffix={t("streaks.minute", {
            count: Math.floor(longestAttentionSeconds / 60),
          })}
        />
        <StatTile
          icon={<Target size={20} className="text-accent" />}
          label={t("streaks.lastNDays", { days: HISTORY_DAYS })}
          value={completedDays}
          suffix={t("streaks.completedOf", { total: HISTORY_DAYS })}
        />
      </div>

      <section className="space-y-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("streaks.today")}
          </h2>
          <span
            className={cn(
              "text-xs font-medium",
              today.goalCompleted ? "text-success" : "text-text-muted",
            )}
          >
            {today.goalCompleted
              ? t("streaks.goalComplete")
              : t("streaks.inProgress")}
          </span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-text-muted">
            <span>{t("streaks.minRead", { minutes: todayMinutes })}</span>
            <span>{t("streaks.minGoal", { minutes: 5 })}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-glass-bg">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                today.goalCompleted ? "bg-success" : "bg-accent",
              )}
              style={{ width: `${todayProgress * 100}%` }}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">
            {t("streaks.lastNDays", { days: HISTORY_DAYS })}
          </h2>
        </div>
        <StreakHeatmap records={dailyRecords} />
        <p className="text-xs text-text-muted">{t("streaks.historyHint")}</p>
      </section>

      <ReadingPlansSection />

      <LogReadingTimeModal open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-glass-bg">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-xl font-bold text-text-primary">
          {value}{" "}
          <span className="text-sm font-normal text-text-muted">{suffix}</span>
        </p>
      </div>
    </div>
  );
}

// DayCell removed, replaced by the GitHub-style StreakHeatmap.
