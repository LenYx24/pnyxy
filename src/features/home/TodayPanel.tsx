import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarClock,
  Map as MapIcon,
} from "lucide-react";
import { GlassCard } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { useRoadmapStore } from "@/stores/roadmap-store";
import { useQuizStore } from "@/stores/quiz-store";
import {
  useReadingPlanStore,
  computeProgress,
  type BookProgressMap,
  type BookTotalsLookup,
} from "@/stores/reading-plan-store";
import {
  computeSchedule,
  ymd,
} from "@/features/roadmaps/lib/scheduler";
import { bookIdSegment } from "@/lib/slugify";
import type { Roadmap, Enrollment } from "@/types/roadmap";
import type { UploadedLibraryItem, CatalogLibraryItem } from "@/types/catalog";
import { cn } from "@/lib/cn";

/**
 * "Today" aggregator surfaced at the top of the Home page for signed-in
 * users. Pulls four signals from existing data sources and renders one
 * card per non-empty bucket:
 *
 *   1. Reading plans whose `todayTarget` is ahead of `pagesRead` — the
 *      user has reading queued up for today.
 *   2. Roadmap nodes whose computed `dueDate` is today or earlier and
 *      whose progress is < 100.
 *   3. Quiz cards whose `due_at` is at or before now (spaced repetition).
 *   4. The most recently touched in-progress book — the obvious "pick
 *      up where you left off" CTA.
 *
 * The panel hides itself entirely when no card has content, so users
 * who haven't set up plans / roadmaps / quizzes don't see an empty
 * shell taking up the top of their home page.
 */
export function TodayPanel() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const plans = useReadingPlanStore((s) => s.plans);
  const fetchPlans = useReadingPlanStore((s) => s.fetchMine);

  const roadmaps = useRoadmapStore((s) => s.roadmaps);
  const enrollments = useRoadmapStore((s) => s.enrollments);
  const loadRoadmaps = useRoadmapStore((s) => s.load);
  const roadmapsLoaded = useRoadmapStore((s) => s.loaded);

  const fetchDueReviews = useQuizStore((s) => s.fetchDueReviews);

  const books = useLibraryStore((s) => s.books);

  // Reading-plan progress map — same query the streaks page does, kept
  // local so the panel doesn't depend on whether the user has visited
  // that page yet.
  const [planProgressMap, setPlanProgressMap] = useState<BookProgressMap>(
    new Map(),
  );
  useEffect(() => {
    if (!user) return;
    void fetchPlans();
  }, [user, fetchPlans]);
  useEffect(() => {
    if (!roadmapsLoaded) void loadRoadmaps();
  }, [roadmapsLoaded, loadRoadmaps]);
  useEffect(() => {
    if (!user || plans.length === 0) {
      setPlanProgressMap(new Map());
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
    supabase
      .from("reading_progress")
      .select("book_id, current_page")
      .eq("user_id", user.id)
      .in("book_id", Array.from(bookIds))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          logError("today-panel:loadProgress", error);
          return;
        }
        const m = new Map<string, number>();
        for (const row of data ?? []) {
          m.set(row.book_id as string, row.current_page as number);
        }
        setPlanProgressMap(m);
      });
    return () => {
      cancelled = true;
    };
  }, [user, plans]);

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

  // ─── Card 1: reading plans with pages-to-read today ──────
  const plansWithTodayWork = useMemo(() => {
    const today = ymd(new Date());
    return plans
      .filter((p) => p.plan.status === "active")
      .filter((p) => p.plan.start_date <= today)
      .map((p) => ({
        plan: p,
        progress: computeProgress(p.plan, p.items, planProgressMap, lookup),
      }))
      .filter(({ progress }) => progress.todayTarget > progress.pagesRead)
      .slice(0, 3);
  }, [plans, planProgressMap, lookup]);

  // ─── Card 2: roadmap nodes due today (or overdue) ────────
  const roadmapDueItems = useMemo(() => {
    const today = ymd(new Date());
    const items: Array<{
      enrollment: Enrollment;
      roadmap: Roadmap;
      nodeId: string;
      nodeTitle: string;
      estimatedMinutes: number;
      dueDate: string;
    }> = [];
    for (const enrollment of enrollments.values()) {
      const roadmap = roadmaps.get(enrollment.roadmapId);
      if (!roadmap) continue;
      const schedule = computeSchedule(roadmap, enrollment);
      for (const node of roadmap.nodes) {
        const progress = enrollment.nodeProgress[node.id] ?? 0;
        if (progress >= 100) continue;
        const sched = schedule.get(node.id);
        if (!sched) continue;
        if (sched.dueDate > today) continue;
        items.push({
          enrollment,
          roadmap,
          nodeId: node.id,
          nodeTitle: node.title || t("home.today.untitledNode", {
            defaultValue: "Untitled step",
          }),
          estimatedMinutes: node.estimatedMinutes ?? 0,
          dueDate: sched.dueDate,
        });
      }
    }
    // Earliest-due first, then cap to 5 — anything more drowns out
    // the other cards on the page.
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return items.slice(0, 5);
  }, [roadmaps, enrollments, t]);

  // ─── Card 3: due quiz reviews ────────────────────────────
  // The store has no in-memory cache for this — it's a server query
  // per call. We load once on mount and don't refetch; the count is
  // a glance signal, not a live counter.
  const [dueQuizCount, setDueQuizCount] = useState<number | null>(null);
  useEffect(() => {
    if (!user) {
      setDueQuizCount(null);
      return;
    }
    let cancelled = false;
    void fetchDueReviews(50).then((rows) => {
      if (cancelled) return;
      setDueQuizCount(rows.length);
    });
    return () => {
      cancelled = true;
    };
  }, [user, fetchDueReviews]);

  // ─── Card 4: continue reading (most recent in-progress) ──
  const [continueBook, setContinueBook] = useState<{
    docId: string;
    currentPage: number | null;
  } | null>(null);
  useEffect(() => {
    if (!user) {
      setContinueBook(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("book_resume_state")
      .select("doc_id, current_page, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setContinueBook({
          docId: data.doc_id as string,
          currentPage: (data.current_page as number) ?? null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const continueEntry = useMemo(() => {
    if (!continueBook) return null;
    return (
      books.find((b) =>
        b.source === "catalog"
          ? b.catalog_book_id === continueBook.docId
          : b.book.id === continueBook.docId,
      ) ?? null
    );
  }, [continueBook, books]);

  if (!user) return null;

  const hasAny =
    plansWithTodayWork.length > 0 ||
    roadmapDueItems.length > 0 ||
    (dueQuizCount !== null && dueQuizCount > 0) ||
    !!continueEntry;

  return (
    <section className="mb-6 space-y-3">
      <header>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
          <CalendarClock size={16} className="text-accent-purple" />
          {t("home.today.heading", { defaultValue: "Today" })}
        </h2>
        <p className="text-xs text-text-muted">
          {t("home.today.subtitle", {
            defaultValue: "What's queued up for you across plans and roadmaps.",
          })}
        </p>
      </header>
      {hasAny ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plansWithTodayWork.length > 0 && (
            <ReadingPlanCard
              plans={plansWithTodayWork}
              lookup={lookup}
            />
          )}
          {roadmapDueItems.length > 0 && (
            <RoadmapDueCard items={roadmapDueItems} />
          )}
          {dueQuizCount !== null && dueQuizCount > 0 && (
            <QuizDueCard count={dueQuizCount} />
          )}
          {continueEntry && <ContinueReadingCard entry={continueEntry} />}
        </div>
      ) : (
        <GlassCard className="p-4 text-xs text-text-muted">
          {t("home.today.emptyState", {
            defaultValue:
              "Nothing queued for today. Open a book, start a reading plan, or enroll in a roadmap to see actionable items here.",
          })}
        </GlassCard>
      )}
    </section>
  );
}

// ─── Cards ──────────────────────────────────────────────────

interface PlanProgressEntry {
  plan: ReturnType<typeof useReadingPlanStore.getState>["plans"][number];
  progress: ReturnType<typeof computeProgress>;
}

function ReadingPlanCard({
  plans,
  lookup,
}: {
  plans: PlanProgressEntry[];
  lookup: BookTotalsLookup;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The plan's per-item book identity isn't surfaced here yet —
  // showing just the plan title + "X of Y pages today" keeps the
  // card glanceable. Lookup is wired in so a future v2 can surface
  // "Crime and Punishment p.12-30" per plan without re-fetching.
  void lookup;
  return (
    <GlassCard className="flex flex-col gap-2 p-4">
      <header className="flex items-center gap-2">
        <BookOpen size={14} className="text-accent-purple" />
        <h3 className="text-sm font-semibold text-text-primary">
          {t("home.today.readingPlansTitle", {
            defaultValue: "Reading today",
          })}
        </h3>
      </header>
      <ul className="space-y-2.5">
        {plans.map(({ plan, progress }) => {
          const pagesLeft = Math.max(
            progress.todayTarget - progress.pagesRead,
            0,
          );
          const pct = Math.min(
            Math.max(progress.completion * 100, 0),
            100,
          );
          return (
            <li key={plan.plan.id}>
              <button
                type="button"
                onClick={() => navigate(`/plans/${plan.plan.id}`)}
                className="group/plan w-full rounded-md p-2 text-left transition-colors hover:bg-glass-hover cursor-pointer"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-text-primary">
                    {plan.plan.title || t("readingPlans.untitled", { defaultValue: "Untitled plan" })}
                  </span>
                  <span className="shrink-0 text-text-muted">
                    {t("home.today.pagesLeft", {
                      defaultValue: "{{count}} pages",
                      count: pagesLeft,
                    })}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-glass-bg">
                  <div
                    className="h-full bg-accent-purple/70 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function RoadmapDueCard({
  items,
}: {
  items: Array<{
    roadmap: Roadmap;
    nodeId: string;
    nodeTitle: string;
    estimatedMinutes: number;
    dueDate: string;
  }>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const today = ymd(new Date());
  return (
    <GlassCard className="flex flex-col gap-2 p-4">
      <header className="flex items-center gap-2">
        <MapIcon size={14} className="text-accent-purple" />
        <h3 className="text-sm font-semibold text-text-primary">
          {t("home.today.roadmapDueTitle", {
            defaultValue: "Roadmap steps due",
          })}
        </h3>
      </header>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const overdue = item.dueDate < today;
          return (
            <li key={`${item.roadmap.id}:${item.nodeId}`}>
              <button
                type="button"
                onClick={() => navigate(`/roadmaps/${item.roadmap.id}`)}
                className="w-full rounded-md p-2 text-left transition-colors hover:bg-glass-hover cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-text-primary">
                    {item.nodeTitle}
                  </span>
                  <span
                    className={cn(
                      "shrink-0",
                      overdue ? "text-amber-400" : "text-text-muted",
                    )}
                  >
                    {item.estimatedMinutes > 0
                      ? `~${item.estimatedMinutes}m`
                      : overdue
                        ? t("home.today.overdue", { defaultValue: "overdue" })
                        : t("home.today.dueToday", { defaultValue: "today" })}
                  </span>
                </div>
                <div className="truncate text-[11px] text-text-muted">
                  {item.roadmap.title}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}

function QuizDueCard({ count }: { count: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <GlassCard className="flex flex-col gap-2 p-4">
      <header className="flex items-center gap-2">
        <Brain size={14} className="text-accent-purple" />
        <h3 className="text-sm font-semibold text-text-primary">
          {t("home.today.quizDueTitle", {
            defaultValue: "Review queue",
          })}
        </h3>
      </header>
      <p className="text-2xl font-bold text-text-primary">{count}</p>
      <p className="text-xs text-text-muted">
        {t("home.today.quizDueBody", {
          defaultValue: "{{count}} cards are due for review.",
          count,
        })}
      </p>
      <button
        type="button"
        onClick={() => navigate("/quizzes/review")}
        className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-accent-purple/15 px-3 py-1.5 text-xs font-medium text-accent-purple transition-colors hover:bg-accent-purple/25 cursor-pointer"
      >
        {t("home.today.startReview", { defaultValue: "Start review" })}
        <ArrowRight size={12} />
      </button>
    </GlassCard>
  );
}

function ContinueReadingCard({
  entry,
}: {
  entry: UploadedLibraryItem | CatalogLibraryItem;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title =
    entry.source === "catalog" ? entry.catalog_book.title : entry.book.title;
  const author =
    entry.source === "catalog"
      ? entry.catalog_book.authors[0] ?? null
      : entry.book.author;
  const coverUrl =
    entry.source === "catalog"
      ? entry.catalog_book.cover_url
      : entry.book.cover_url;
  const id = entry.source === "catalog" ? entry.catalog_book_id : entry.book.id;
  return (
    <GlassCard className="flex flex-col gap-2 p-4">
      <header className="flex items-center gap-2">
        <BookOpen size={14} className="text-accent-purple" />
        <h3 className="text-sm font-semibold text-text-primary">
          {t("home.today.continueTitle", {
            defaultValue: "Continue reading",
          })}
        </h3>
      </header>
      <button
        type="button"
        onClick={() => navigate(`/books/${bookIdSegment(id, title)}`)}
        className="flex w-full items-start gap-3 rounded-md p-1 text-left transition-colors hover:bg-glass-hover cursor-pointer"
      >
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-glass-bg">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-purple/20 to-accent-blue/20">
              <BookOpen size={16} className="text-white/40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-text-primary">
            {title}
          </p>
          {author && (
            <p className="line-clamp-1 text-[11px] text-text-muted">{author}</p>
          )}
          <p className="mt-1 text-[11px] text-text-muted">
            {t("home.today.continueResumeHint", {
              defaultValue: "Pick up where you left off",
            })}
          </p>
        </div>
      </button>
    </GlassCard>
  );
}
