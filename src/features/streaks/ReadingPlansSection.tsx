import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, Calendar, BookOpen, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import {
  useReadingPlanStore,
  computeProgress,
  type BookProgressMap,
  type BookTotalsLookup,
} from "@/stores/reading-plan-store";
import { planColorClasses } from "@/lib/plan-colors";
import { useConfirm } from "@/hooks/use-confirm";
import type { ReadingPlanWithItems } from "@/types/reading-plan";

export function ReadingPlansSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const plans = useReadingPlanStore((s) => s.plans);
  const fetchPlans = useReadingPlanStore((s) => s.fetchMine);
  const deletePlan = useReadingPlanStore((s) => s.deletePlan);
  const setStatus = useReadingPlanStore((s) => s.setStatus);
  const books = useLibraryStore((s) => s.books);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);

  const [progressMap, setProgressMap] = useState<BookProgressMap>(new Map());
  const [loadingProgress, setLoadingProgress] = useState(false);
  const { confirm, ConfirmModalElement } = useConfirm();

  const handleDeletePlan = async (id: string) => {
    const ok = await confirm({
      title: t("readingPlans.card.deleteConfirmTitle"),
      body: t("readingPlans.card.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok) void deletePlan(id);
  };

  useEffect(() => {
    if (user) fetchPlans();
    fetchLibrary();
  }, [user, fetchPlans, fetchLibrary]);

  // Pull reading progress for every book referenced by any plan item.
  useEffect(() => {
    if (!user || plans.length === 0) {
      setProgressMap(new Map());
      return;
    }
    const bookIds = new Set<string>();
    for (const p of plans) {
      for (const it of p.items) {
        if (it.book_id) bookIds.add(it.book_id);
        if (it.catalog_book_id) bookIds.add(it.catalog_book_id);
      }
    }
    if (bookIds.size === 0) return;

    let cancelled = false;
    setLoadingProgress(true);
    supabase
      .from("reading_progress")
      .select("book_id, current_page")
      .eq("user_id", user.id)
      .in("book_id", Array.from(bookIds))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          logError("reading-plans:loadProgress", error);
          setProgressMap(new Map());
        } else {
          const m = new Map<string, number>();
          for (const row of data ?? []) {
            m.set(row.book_id as string, row.current_page as number);
          }
          setProgressMap(m);
        }
        setLoadingProgress(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, plans]);

  // Total-pages lookup: prefer the user's library metadata, fall back
  // to nothing (progress will show 0 / 0 for unknown totals).
  const lookup = useMemo<BookTotalsLookup>(() => {
    const pageMap = new Map<string, number | null>();
    for (const b of books) {
      if (b.source === "catalog") {
        pageMap.set(b.catalog_book_id, b.catalog_book.page_count);
      } else {
        pageMap.set(b.book.id, b.book.page_count);
      }
    }
    return {
      getTotalPages(bookId) {
        const p = pageMap.get(bookId);
        return typeof p === "number" ? p : null;
      },
    };
  }, [books]);

  if (!user) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Calendar size={16} className="text-accent-purple" />
            {t("readingPlans.section.heading")}
          </h2>
          <p className="text-xs text-text-muted">
            {t("readingPlans.section.subtitle")}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => navigate("/plans/new")}
          className="gap-2 px-3 py-1.5 text-xs sm:text-sm"
        >
          <Plus size={14} />
          {t("readingPlans.section.newPlan")}
        </Button>
      </div>

      {plans.length === 0 && (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
          <Calendar size={24} className="mx-auto mb-2 text-text-muted/50" />
          <p className="text-sm font-medium text-text-primary">
            {t("readingPlans.section.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("readingPlans.section.emptyBody")}
          </p>
        </div>
      )}

      {plans.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <PlanCard
              key={p.plan.id}
              plan={p}
              progressMap={progressMap}
              lookup={lookup}
              loadingProgress={loadingProgress}
              onOpen={() => navigate(`/plans/${p.plan.id}`)}
              onDelete={() => handleDeletePlan(p.plan.id)}
              onComplete={() => setStatus(p.plan.id, "completed")}
            />
          ))}
        </div>
      )}
      {ConfirmModalElement}
    </section>
  );
}

function PlanCard({
  plan,
  progressMap,
  lookup,
  loadingProgress,
  onOpen,
  onDelete,
  onComplete,
}: {
  plan: ReadingPlanWithItems;
  progressMap: BookProgressMap;
  lookup: BookTotalsLookup;
  loadingProgress: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const progress = useMemo(
    () => computeProgress(plan.plan, plan.items, progressMap, lookup),
    [plan, progressMap, lookup],
  );

  const pct = Math.round(progress.completion * 100);
  const ahead = progress.pagesAhead;
  const isCompleted = plan.plan.status === "completed";
  const isDone = progress.completion >= 1;
  const colorClasses = planColorClasses(plan.plan.color);

  // Whole-card click navigates to the detail page; the action buttons
  // call stopPropagation to avoid double-fires.
  const stopAndCall = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "relative cursor-pointer rounded-xl border-l-4 border p-4 transition-colors hover:bg-glass-hover",
        colorClasses.border,
        isCompleted
          ? "border-green-500/30 bg-green-500/5"
          : cn("border-glass-border", colorClasses.bg || "bg-glass-bg/40"),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-text-primary">
            {plan.plan.title}
          </h3>
          {plan.plan.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-text-secondary">
              {plan.plan.description}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-text-muted">
            {plan.plan.start_date} → {plan.plan.end_date}
            {plan.plan.ignore_weekends &&
              ` · ${t("readingPlans.card.weekdaysOnly")}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isCompleted && isDone && (
            <button
              onClick={stopAndCall(onComplete)}
              aria-label={t("readingPlans.card.markComplete")}
              title={t("readingPlans.card.markComplete")}
              className="rounded-md p-1.5 text-green-400 transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <CheckCircle2 size={14} />
            </button>
          )}
          <button
            onClick={stopAndCall(onDelete)}
            aria-label={t("readingPlans.card.delete")}
            title={t("readingPlans.card.delete")}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-red-400 cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 space-y-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-text-primary tabular-nums">
            {progress.pagesRead} / {progress.totalPages || "?"}{" "}
            <span className="text-text-muted font-normal">
              {t("readingPlans.card.pages")}
            </span>
          </span>
          <span className="text-text-muted tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-glass-bg">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              isDone ? "bg-green-500" : "bg-accent-purple",
            )}
            style={{
              width: `${Math.min(100, Math.max(0, progress.completion * 100))}%`,
            }}
          />
        </div>
      </div>

      {/* Status line */}
      {!isCompleted && progress.totalPages > 0 && !loadingProgress && (
        <p
          className={cn(
            "mt-2 text-[11px]",
            ahead >= 0 ? "text-green-400" : "text-amber-400",
          )}
        >
          {ahead >= 0
            ? t("readingPlans.card.ahead", { pages: ahead })
            : t("readingPlans.card.behind", { pages: Math.abs(ahead) })}
          <span className="ml-1 text-text-muted">
            · {t("readingPlans.card.todayTarget", { target: progress.todayTarget })}
          </span>
        </p>
      )}

      {/* Books list */}
      <ul className="mt-3 space-y-1 text-[11px]">
        {plan.items.map((it) => {
          const bookId = it.book_id ?? it.catalog_book_id;
          const total = bookId ? lookup.getTotalPages(bookId) ?? 0 : 0;
          const start = it.start_page ?? 1;
          const end = it.end_page ?? total;
          const current = bookId ? progressMap.get(bookId) ?? 0 : 0;
          return (
            <li
              key={it.id}
              className="flex items-center gap-2 text-text-muted"
            >
              <BookOpen size={10} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {it.start_page || it.end_page
                  ? t("readingPlans.card.bookRange", {
                      start,
                      end: end || "?",
                    })
                  : t("readingPlans.card.wholeBook")}
              </span>
              <span className="shrink-0 tabular-nums">
                {Math.min(current, end)} / {end || "?"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
