import { Flame, Trophy } from "lucide-react";
import { useStreakStore } from "@/stores/streak-store";

export function StreakCard() {
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
            <span className="text-xs text-text-muted">day streak</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Trophy size={16} className="text-yellow-400" />
            <span className="text-sm font-medium text-text-secondary">
              {longestStreak}
            </span>
            <span className="text-xs text-text-muted">best</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-text-muted">
          <span>Today: {todayMinutes} min</span>
          <span>{goalMinutes} min goal</span>
        </div>
        <div className="h-2 rounded-full bg-glass-bg overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              today.goalCompleted
                ? "bg-green-500"
                : "bg-accent-purple"
            }`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
