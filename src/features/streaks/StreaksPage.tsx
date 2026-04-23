import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flame, Trophy, Target, Calendar, Brain } from "lucide-react";
import { useStreakStore } from "@/stores/streak-store";
import { cn } from "@/lib/cn";

const GOAL_SECONDS = 300; // 5 minutes; mirrors streak-store's constant.
const HISTORY_DAYS = 30;

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

  const currentStreak = getCurrentStreak();
  const today = getTodayRecord();
  const todayMinutes = Math.floor(today.seconds / 60);
  const todayProgress = Math.min(today.seconds / GOAL_SECONDS, 1);

  const history = useMemo(() => buildHistory(dailyRecords), [dailyRecords]);
  const completedDays = history.filter((d) => d.goalCompleted).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Flame size={20} className="text-orange-400" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("streaks.title")}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Flame size={20} className={currentStreak > 0 ? "text-orange-400" : "text-text-muted"} />}
          label={t("streaks.currentStreak")}
          value={currentStreak}
          suffix={t("streaks.day", { count: currentStreak })}
        />
        <StatTile
          icon={<Trophy size={20} className="text-yellow-400" />}
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
          icon={<Target size={20} className="text-accent-purple" />}
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
              today.goalCompleted ? "text-green-400" : "text-text-muted",
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
                today.goalCompleted ? "bg-green-500" : "bg-accent-purple",
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
        <div className="flex flex-wrap gap-1.5">
          {history.map((d) => (
            <DayCell key={d.key} day={d} />
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {t("streaks.historyHint")}
        </p>
      </section>
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

function DayCell({
  day,
}: {
  day: { key: string; date: Date; seconds: number; goalCompleted: boolean };
}) {
  const minutes = Math.floor(day.seconds / 60);
  const label = `${day.date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} — ${minutes} min`;
  return (
    <div
      title={label}
      className={cn(
        "h-6 w-6 rounded-sm border",
        day.goalCompleted
          ? "border-green-500/60 bg-green-500/70"
          : day.seconds > 0
            ? "border-accent-purple/40 bg-accent-purple/30"
            : "border-glass-border bg-glass-bg/30",
      )}
    />
  );
}
