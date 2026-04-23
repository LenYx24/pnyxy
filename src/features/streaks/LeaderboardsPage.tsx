import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Flame, Clock, Brain, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";

type Board = "longest_streak" | "current_streak" | "total_seconds" | "longest_attention_seconds";

interface Row {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  total_seconds: number;
  longest_attention_seconds: number;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

const BOARDS: { key: Board; labelKey: string; icon: typeof Trophy; format: (row: Row) => string }[] = [
  {
    key: "longest_streak",
    labelKey: "leaderboards.tabs.longestStreak",
    icon: Trophy,
    format: (r) => `${r.longest_streak} d`,
  },
  {
    key: "current_streak",
    labelKey: "leaderboards.tabs.currentStreak",
    icon: Flame,
    format: (r) => `${r.current_streak} d`,
  },
  {
    key: "total_seconds",
    labelKey: "leaderboards.tabs.totalTime",
    icon: Clock,
    format: (r) => `${Math.floor(r.total_seconds / 3600)} h`,
  },
  {
    key: "longest_attention_seconds",
    labelKey: "leaderboards.tabs.longestAttention",
    icon: Brain,
    format: (r) => `${Math.floor(r.longest_attention_seconds / 60)} min`,
  },
];

export function LeaderboardsPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const [board, setBoard] = useState<Board>("longest_streak");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    supabase
      .from("reading_stats")
      .select(
        "user_id, current_streak, longest_streak, total_seconds, longest_attention_seconds, profile:profiles!user_id(display_name, avatar_url)",
      )
      .order(board, { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          logError("leaderboards:fetch", error);
          setRows([]);
        } else {
          // Supabase typings collapse the foreign-profile to an array;
          // the schema is 1:1 so we unwrap.
          setRows(
            (data ?? []).map((d) => {
              const prof = Array.isArray(d.profile) ? d.profile[0] : d.profile;
              return {
                user_id: d.user_id,
                current_streak: d.current_streak,
                longest_streak: d.longest_streak,
                total_seconds: d.total_seconds,
                longest_attention_seconds: d.longest_attention_seconds,
                profile: prof ?? null,
              } as Row;
            }),
          );
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [board]);

  const activeBoard = BOARDS.find((b) => b.key === board)!;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Trophy size={20} className="text-yellow-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("leaderboards.title")}
          </h1>
          <p className="text-sm text-text-muted">{t("leaderboards.subtitle")}</p>
        </div>
      </div>

      {/* Board tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-glass-border bg-glass-bg p-1">
        {BOARDS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setBoard(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors cursor-pointer sm:text-sm",
              board === key
                ? "bg-accent-purple/15 text-accent-purple"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            <Icon size={14} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          {t("leaderboards.loading")}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
          <Trophy size={28} className="mx-auto mb-2 text-text-muted/50" />
          <p className="text-sm font-medium text-text-primary">
            {t("leaderboards.empty")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("leaderboards.emptyBody")}
          </p>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <ol className="divide-y divide-glass-border rounded-xl border border-glass-border bg-glass-bg/40">
          {rows.map((row, i) => {
            const isMe = user?.id === row.user_id;
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
            const initial = (row.profile?.display_name?.[0] ?? "?").toUpperCase();
            return (
              <li
                key={row.user_id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 transition-colors",
                  isMe && "bg-accent-purple/5",
                )}
              >
                <span className="w-6 shrink-0 text-center text-sm font-semibold text-text-muted tabular-nums">
                  {medal ?? i + 1}
                </span>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-purple/15">
                  {row.profile?.avatar_url ? (
                    <img
                      src={row.profile.avatar_url}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-bold text-accent-purple">
                      {initial}
                    </span>
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                  {row.profile?.display_name ?? t("leaderboards.anonymous")}
                  {isMe && (
                    <span className="ml-2 rounded bg-accent-purple/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-purple">
                      {t("leaderboards.you")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                  {activeBoard.format(row)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="text-xs text-text-muted">
        {t("leaderboards.privacyNote")}
      </p>
    </div>
  );
}
