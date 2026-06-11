import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square, Clock, Flame, TrendingUp, Target } from "lucide-react";
import {
  useReadingSessionStore,
  formatSessionDuration,
} from "@/stores/reading-session-store";
import { fetchSessionsForDoc } from "@/lib/reading-sessions";
import { fetchResumeState } from "@/lib/resume-state";
import {
  computeBookReadingStats,
  formatTotalTime,
  formatFinishDate,
  type BookReadingStats,
} from "@/lib/book-reading-stats";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

interface Props {
  /** Same id PageTracker uses — book uuid OR PDF hash. */
  docId: string;
  pageCount: number | null;
}

/**
 * Reading session control + stats card. Lives on the OverviewTab
 * so it's the first thing the user sees on a book detail page.
 *
 * UX shape:
 *  • Idle: "Start session" button + summary stats (streak, total
 *    time, pace, finish-date estimate) computed from history.
 *  • Active for this book: live elapsed timer + Stop button.
 *  • Active for another book: ghosted "session running elsewhere"
 *    notice so we don't accidentally double-track.
 */
export function ReadingSessionCard({ docId, pageCount }: Props) {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const active = useReadingSessionStore((s) => s.active);
  const elapsedSeconds = useReadingSessionStore((s) => s.elapsedSeconds);
  const startSession = useReadingSessionStore((s) => s.start);
  const stopSession = useReadingSessionStore((s) => s.stop);

  const isActiveForThisBook = active?.doc_id === docId;
  const isActiveForOtherBook = active && active.doc_id !== docId;

  const [stats, setStats] = useState<BookReadingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // Bumped each time a session ends so the stats panel re-fetches.
  const [refreshKey, setRefreshKey] = useState(0);

  // Stop-flow modal state. We prompt for current page on stop so
  // pace math has fresh data — but it's skippable; pace just stays
  // less accurate without it.
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopPageDraft, setStopPageDraft] = useState("");

  useEffect(() => {
    if (!user) {
      setStats(null);
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    void (async () => {
      const [sessions, resume] = await Promise.all([
        fetchSessionsForDoc(docId, 60),
        fetchResumeState(docId),
      ]);
      if (cancelled) return;
      const current = resume?.page ?? null;
      setStats(computeBookReadingStats(sessions, current, pageCount));
      setStatsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, pageCount, user, refreshKey]);

  if (!user) return null;

  const handleStart = async () => {
    const resume = await fetchResumeState(docId);
    const startPage = resume?.page ?? null;
    await startSession(docId, startPage);
  };

  const handleStopClick = () => {
    setStopPageDraft("");
    setStopModalOpen(true);
  };

  const handleStopConfirm = async (withPage: boolean) => {
    let endPage: number | null = null;
    if (withPage) {
      const parsed = parseInt(stopPageDraft, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        endPage = pageCount ? Math.min(parsed, pageCount) : parsed;
      }
    }
    await stopSession(endPage);
    setStopModalOpen(false);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 sm:p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {t("book.overview.session.heading")}
          </h3>
          <p className="text-2xs text-text-muted">
            {t("book.overview.session.subheading")}
          </p>
        </div>

        {/* Action — Start when idle, Stop when running. Mobile-
            sized hit area; the chip-style buttons sit on a high-
            contrast background so they read on the dark surface. */}
        {isActiveForThisBook ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleStopClick}
            className="shrink-0 border border-danger/40"
          >
            <Square size={12} fill="currentColor" />
            {t("book.overview.session.stop")}
          </Button>
        ) : isActiveForOtherBook ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <Clock size={12} />
            {t("book.overview.session.running")}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleStart}
            className="shrink-0"
          >
            <Play size={12} fill="currentColor" />
            {t("book.overview.session.start")}
          </Button>
        )}
      </div>

      {isActiveForThisBook && (
        <div className="flex items-baseline justify-between rounded-md border border-accent/30 bg-accent/10 px-3 py-2">
          <span className="text-2xs uppercase tracking-wider text-accent">
            {t("book.overview.session.elapsed")}
          </span>
          <span className="font-mono text-lg tabular-nums text-text-primary">
            {formatSessionDuration(elapsedSeconds)}
          </span>
        </div>
      )}

      {isActiveForOtherBook && (
        <p className="text-2xs text-warning/80">
          {t("book.overview.session.activeOnOther")}
        </p>
      )}

      {/* Stats grid — single column on mobile, 2x2 at sm+. The
          finish-date / pace cells gracefully degrade when there
          isn't enough history yet. */}
      <StatsGrid
        stats={stats}
        loading={statsLoading}
        locale={i18n.language}
      />

      {stopModalOpen && (
        <StopSessionModal
          pageCount={pageCount}
          draft={stopPageDraft}
          onDraftChange={setStopPageDraft}
          onSkip={() => void handleStopConfirm(false)}
          onConfirm={() => void handleStopConfirm(true)}
          onCancel={() => setStopModalOpen(false)}
        />
      )}
    </div>
  );
}

function StatsGrid({
  stats,
  loading,
  locale,
}: {
  stats: BookReadingStats | null;
  loading: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  if (loading || !stats) {
    return (
      <div className="h-20 animate-pulse rounded-md bg-bg-primary/30" />
    );
  }

  const finishValue = stats.estimatedFinishDate
    ? formatFinishDate(stats.estimatedFinishDate, locale)
    : t("book.overview.stats.finishUnknown");
  const finishLabel = t("book.overview.stats.finishLabel");

  const paceValue =
    stats.pagesPerDay !== null
      ? t("book.overview.stats.pacePerDay", {
          pages:
            stats.pagesPerDay >= 10
              ? Math.round(stats.pagesPerDay)
              : stats.pagesPerDay.toFixed(1),
        })
      : t("book.overview.stats.paceNone");

  const streakValue =
    stats.currentStreak > 0
      ? t("book.overview.stats.streakValue", { count: stats.currentStreak })
      : t("book.overview.stats.streakNone");

  return (
    <div className="space-y-2">
      {stats.percentComplete !== null && (
        <div>
          <div className="mb-1 flex items-baseline justify-between text-2xs uppercase tracking-wider text-text-muted">
            <span>
              {t("book.overview.stats.percentComplete", {
                percent: stats.percentComplete,
              })}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-primary/40">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${stats.percentComplete}%` }}
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatCell
          icon={Flame}
          iconClass="text-orange-400"
          label={t("book.overview.stats.streak")}
          value={streakValue}
        />
        <StatCell
          icon={Clock}
          iconClass="text-accent-blue"
          label={t("book.overview.stats.totalTime")}
          value={formatTotalTime(stats.totalSeconds)}
        />
        <StatCell
          icon={TrendingUp}
          iconClass="text-success"
          label={t("book.overview.stats.pace")}
          value={paceValue}
        />
        <StatCell
          icon={Target}
          iconClass="text-accent"
          label={finishLabel}
          value={finishValue}
        />
      </div>
    </div>
  );
}

function StatCell({
  icon: Icon,
  iconClass,
  label,
  value,
}: {
  icon: typeof Flame;
  iconClass: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-glass-border bg-bg-primary/30 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-2xs uppercase tracking-wider text-text-muted">
        <Icon size={11} className={cn("shrink-0", iconClass)} />
        <span className="truncate">{label}</span>
      </div>
      <p className="text-xs text-text-primary">{value}</p>
    </div>
  );
}

function StopSessionModal({
  pageCount,
  draft,
  onDraftChange,
  onSkip,
  onConfirm,
  onCancel,
}: {
  pageCount: number | null;
  draft: string;
  onDraftChange: (v: string) => void;
  onSkip: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      onClick={onCancel}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h4 className="mb-1 text-sm font-semibold text-text-primary">
          {t("book.overview.session.stopPromptTitle")}
        </h4>
        <p className="mb-3 text-xs text-text-muted">
          {t("book.overview.session.stopPromptBody")}
        </p>
        <div className="mb-3 flex items-center gap-2">
          <input
            type="number"
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder={t("book.overview.session.stopPagePlaceholder")}
            min={1}
            max={pageCount ?? undefined}
            className="w-full rounded-md border border-glass-border bg-bg-primary px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
          />
          {pageCount && (
            <span className="text-xs text-text-muted">/ {pageCount}</span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            {t("book.overview.session.stopSkip")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={!draft.trim()}
          >
            {t("book.overview.session.stopConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
