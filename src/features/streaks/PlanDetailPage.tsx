import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import {
  useReadingPlanStore,
  todayIso,
  computeProgress,
  type BookProgressMap,
  type BookTotalsLookup,
} from "@/stores/reading-plan-store";
import {
  PLAN_COLOR_KEYS,
  planColorClasses,
  type PlanColorKey,
} from "@/lib/plan-colors";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { ReadingPlanItem } from "@/types/reading-plan";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";

interface DraftItem {
  /** Local key for React + drag/remove. */
  key: string;
  /** `catalog:<id>` or `uploaded:<id>`. Empty until the user picks. */
  bookKey: string;
  title: string;
  totalPages: number | null;
  useRange: boolean;
  startPage: number | null;
  endPage: number | null;
}

function bookKeyOf(item: UnifiedLibraryItem): string {
  return item.source === "catalog"
    ? `catalog:${item.catalog_book_id}`
    : `uploaded:${item.book.id}`;
}

function bookTitleOf(item: UnifiedLibraryItem): string {
  return item.source === "catalog" ? item.catalog_book.title : item.book.title;
}

function bookPageCountOf(item: UnifiedLibraryItem): number | null {
  return item.source === "catalog"
    ? item.catalog_book.page_count
    : item.book.page_count;
}

function emptyDraft(): DraftItem {
  return {
    key: crypto.randomUUID(),
    bookKey: "",
    title: "",
    totalPages: null,
    useRange: false,
    startPage: null,
    endPage: null,
  };
}

function defaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export function PlanDetailPage() {
  const { t } = useTranslation();
  const { planId } = useParams<{ planId?: string }>();
  const navigate = useNavigate();
  const isNew = !planId;

  const user = useAuthStore((s) => s.user);
  const books = useLibraryStore((s) => s.books);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);

  const getPlan = useReadingPlanStore((s) => s.getPlan);
  const createPlan = useReadingPlanStore((s) => s.createPlan);
  const updatePlan = useReadingPlanStore((s) => s.updatePlan);
  const deletePlan = useReadingPlanStore((s) => s.deletePlan);
  const setStatus = useReadingPlanStore((s) => s.setStatus);

  const [loadingInitial, setLoadingInitial] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<PlanColorKey | null>(null);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [ignoreWeekends, setIgnoreWeekends] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [planStatus, setPlanStatus] = useState<
    "active" | "completed" | "abandoned"
  >("active");

  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  // Progress (edit mode only, for the "Mark complete" affordance).
  const [progressMap, setProgressMap] = useState<BookProgressMap>(new Map());

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Hydrate from existing plan.
  useEffect(() => {
    if (isNew) return;
    if (!planId) return;
    let cancelled = false;
    (async () => {
      const data = await getPlan(planId);
      if (cancelled) return;
      if (!data) {
        setNotFound(true);
        setLoadingInitial(false);
        return;
      }
      setTitle(data.plan.title);
      setDescription(data.plan.description ?? "");
      setColor(
        (PLAN_COLOR_KEYS as string[]).includes(data.plan.color ?? "")
          ? (data.plan.color as PlanColorKey)
          : null,
      );
      setStartDate(data.plan.start_date);
      setEndDate(data.plan.end_date);
      setIgnoreWeekends(data.plan.ignore_weekends);
      setPlanStatus(data.plan.status);
      setItems(data.items.map((it) => itemToDraft(it, books)));
      setLoadingInitial(false);
    })();
    return () => {
      cancelled = true;
    };
    // `books` is intentionally omitted: when it later loads, we'd
    // re-overwrite the user's in-progress edits. We hydrate once
    // from the plan's own item rows instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, getPlan, isNew]);

  // Fetch reading_progress for the plan's books so the "Mark complete"
  // button can show when progress hits 100%.
  useEffect(() => {
    if (isNew || !user) return;
    const bookIds = new Set<string>();
    for (const it of items) {
      const [, id] = it.bookKey.split(":");
      if (id) bookIds.add(id);
    }
    if (bookIds.size === 0) {
      setProgressMap(new Map());
      return;
    }
    let cancelled = false;
    supabase
      .from("reading_progress")
      .select("book_id, current_page")
      .eq("user_id", user.id)
      .in("book_id", Array.from(bookIds))
      .then(({ data, error: pErr }) => {
        if (cancelled) return;
        if (pErr) {
          logError("plan-detail:loadProgress", pErr);
          setProgressMap(new Map());
          return;
        }
        const m = new Map<string, number>();
        for (const row of data ?? []) {
          m.set(row.book_id as string, row.current_page as number);
        }
        setProgressMap(m);
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, user, items]);

  const booksByKey = useMemo(() => {
    const m = new Map<string, UnifiedLibraryItem>();
    for (const b of books) m.set(bookKeyOf(b), b);
    return m;
  }, [books]);

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

  // Plan-shape proxy for computeProgress in edit mode.
  const progressSnapshot = useMemo(() => {
    if (isNew) return null;
    const planLike = {
      id: planId ?? "",
      user_id: user?.id ?? "",
      title,
      description,
      color,
      start_date: startDate,
      end_date: endDate,
      ignore_weekends: ignoreWeekends,
      status: planStatus,
      created_at: "",
      completed_at: null,
    };
    const itemsLike: ReadingPlanItem[] = items
      .filter((it) => !!it.bookKey)
      .map((it, i) => {
        const [kind, id] = it.bookKey.split(":");
        return {
          id: it.key,
          plan_id: planId ?? "",
          book_id: kind === "uploaded" ? id : null,
          catalog_book_id: kind === "catalog" ? id : null,
          start_page: it.useRange ? (it.startPage ?? null) : null,
          end_page: it.useRange ? (it.endPage ?? null) : null,
          ordering: i,
        };
      });
    return computeProgress(planLike, itemsLike, progressMap, lookup);
  }, [
    isNew,
    planId,
    user,
    title,
    description,
    color,
    startDate,
    endDate,
    ignoreWeekends,
    planStatus,
    items,
    progressMap,
    lookup,
  ]);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <p className="text-text-muted">{t("readingPlans.detail.signInFirst")}</p>
      </div>
    );
  }

  if (loadingInitial) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-center">
        <p className="text-text-muted">{t("readingPlans.detail.notFound")}</p>
        <button
          onClick={() => navigate("/streaks")}
          className="mt-3 inline-block text-sm text-accent-purple hover:underline"
        >
          {t("readingPlans.detail.backToList")}
        </button>
      </div>
    );
  }

  const handleAddItem = () =>
    setItems((prev) => [...prev, emptyDraft()]);

  const handleRemoveItem = (key: string) =>
    setItems((prev) => prev.filter((it) => it.key !== key));

  const handlePickBook = (key: string, selectedKey: string) => {
    const book = booksByKey.get(selectedKey);
    if (!book) {
      // Allow clearing the picker.
      setItems((prev) =>
        prev.map((it) =>
          it.key === key
            ? {
                ...it,
                bookKey: "",
                title: "",
                totalPages: null,
                useRange: false,
                startPage: null,
                endPage: null,
              }
            : it,
        ),
      );
      return;
    }
    setItems((prev) =>
      prev.map((it) =>
        it.key === key
          ? {
              ...it,
              bookKey: selectedKey,
              title: bookTitleOf(book),
              totalPages: bookPageCountOf(book),
            }
          : it,
      ),
    );
  };

  const handleItemPatch = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );

  const datesValid =
    !!startDate && !!endDate && endDate >= startDate;
  // Allow plans with zero items — the user can attach books later.
  // Reject items that have been added but left without a book pick,
  // since those are user mistakes that the modal also caught.
  const itemsValid = items.every((it) => !!it.bookKey);
  const canSubmit =
    title.trim().length > 0 && datesValid && itemsValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const itemDrafts = items
        .filter((it) => !!it.bookKey)
        .map((it, i) => {
          const [kind, id] = it.bookKey.split(":");
          return {
            book_id: kind === "uploaded" ? id : null,
            catalog_book_id: kind === "catalog" ? id : null,
            start_page: it.useRange ? (it.startPage ?? null) : null,
            end_page: it.useRange ? (it.endPage ?? null) : null,
            ordering: i,
          };
        });

      if (isNew) {
        const id = await createPlan({
          title: title.trim(),
          description: description.trim() || null,
          color,
          start_date: startDate,
          end_date: endDate,
          ignore_weekends: ignoreWeekends,
          items: itemDrafts,
        });
        if (id) navigate(`/plans/${id}`);
      } else if (planId) {
        await updatePlan(
          planId,
          {
            title: title.trim(),
            description: description.trim() || null,
            color,
            start_date: startDate,
            end_date: endDate,
            ignore_weekends: ignoreWeekends,
          },
          itemDrafts,
        );
        navigate("/streaks");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("readingPlans.detail.errors.saveFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!planId) return;
    setDeleting(true);
    try {
      await deletePlan(planId);
      navigate("/streaks");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("readingPlans.detail.errors.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!planId) return;
    try {
      await setStatus(planId, "completed");
      setPlanStatus("completed");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("readingPlans.detail.errors.saveFailed"),
      );
    }
  };

  const colorClasses = planColorClasses(color);
  const isCompleted = planStatus === "completed";
  const showMarkComplete =
    !isNew &&
    !isCompleted &&
    progressSnapshot !== null &&
    progressSnapshot.completion >= 1;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft size={14} />
        {t("common.back")}
      </button>

      <header className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 inline-block h-3 w-3 shrink-0 rounded-full",
            colorClasses.swatch,
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-text-primary">
            {isNew
              ? t("readingPlans.detail.newTitle")
              : t("readingPlans.detail.editTitle")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {isNew
              ? t("readingPlans.detail.newSubtitle")
              : t("readingPlans.detail.editSubtitle")}
          </p>
        </div>
      </header>

      <section
        className={cn(
          "space-y-4 rounded-xl border-l-4 border border-glass-border p-4",
          colorClasses.border,
          colorClasses.bg || "bg-glass-bg/40",
        )}
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            {t("readingPlans.detail.titleLabel")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("readingPlans.detail.titlePlaceholder")}
            maxLength={120}
            className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            {t("readingPlans.detail.descriptionLabel")}
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("readingPlans.detail.descriptionPlaceholder")}
            maxLength={500}
            className="w-full resize-none rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium text-text-secondary">
            {t("readingPlans.detail.colorLabel")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setColor(null)}
              aria-label={t("readingPlans.detail.colorNone")}
              title={t("readingPlans.detail.colorNone")}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors cursor-pointer",
                color === null
                  ? "border-accent-purple"
                  : "border-glass-border hover:border-text-muted/60",
              )}
            >
              <span className="block h-3 w-3 rounded-full bg-text-muted/40" />
            </button>
            {PLAN_COLOR_KEYS.map((key) => {
              const cc = planColorClasses(key);
              const active = color === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setColor(key)}
                  aria-label={t(`readingPlans.detail.color.${key}`)}
                  title={t(`readingPlans.detail.color.${key}`)}
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors cursor-pointer",
                    active
                      ? "border-text-primary"
                      : "border-transparent hover:border-glass-border",
                  )}
                >
                  <span className={cn("block h-5 w-5 rounded-full", cc.swatch)} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("readingPlans.detail.startDate")}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("readingPlans.detail.endDate")}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-glass-border bg-bg-primary/40 px-3 py-2">
          <div className="min-w-0 pr-2">
            <p className="text-sm font-medium text-text-primary">
              {t("readingPlans.detail.ignoreWeekends")}
            </p>
            <p className="text-xs text-text-muted">
              {t("readingPlans.detail.ignoreWeekendsHint")}
            </p>
          </div>
          <Toggle checked={ignoreWeekends} onChange={setIgnoreWeekends} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              {t("readingPlans.detail.booksHeading")}
            </h2>
            <p className="text-xs text-text-muted">
              {t("readingPlans.detail.booksHint")}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={handleAddItem}
            className="gap-1 px-2.5 py-1 text-xs"
          >
            <Plus size={14} />
            {t("readingPlans.detail.addBook")}
          </Button>
        </div>

        {items.length === 0 && (
          <p className="rounded-lg border border-dashed border-glass-border bg-glass-bg/30 p-4 text-center text-xs text-text-muted">
            {t("readingPlans.detail.noBooksHint")}
          </p>
        )}

        {items.map((item) => (
          <PlanItemRow
            key={item.key}
            item={item}
            books={books}
            onPickBook={(sk) => handlePickBook(item.key, sk)}
            onPatch={(patch) => handleItemPatch(item.key, patch)}
            onRemove={() => handleRemoveItem(item.key)}
          />
        ))}
      </section>

      {error && (
        <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {showMarkComplete && (
            <Button
              variant="secondary"
              onClick={handleMarkComplete}
              className="gap-2 text-green-400"
            >
              <CheckCircle2 size={14} />
              {t("readingPlans.detail.markComplete")}
            </Button>
          )}
          {!isNew && (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="gap-2 text-red-400 hover:bg-red-500/10"
              disabled={deleting}
            >
              <Trash2 size={14} />
              {t("readingPlans.detail.deletePlan")}
            </Button>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={() => navigate(-1)}
            disabled={submitting}
            className="w-full sm:w-auto"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full sm:w-auto"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t("common.saving")}
              </>
            ) : isNew ? (
              t("readingPlans.detail.create")
            ) : (
              t("readingPlans.detail.save")
            )}
          </Button>
        </div>
      </div>

      {confirmDelete && !isNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDelete(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              {t("readingPlans.detail.confirmDeleteTitle")}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {t("readingPlans.detail.confirmDeleteBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                {t("common.cancel")}
              </Button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="cursor-pointer rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={14} className="animate-spin" />
                    {t("common.deleting")}
                  </span>
                ) : (
                  t("readingPlans.detail.deletePlan")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function itemToDraft(
  item: ReadingPlanItem,
  books: UnifiedLibraryItem[],
): DraftItem {
  const bookId = item.book_id ?? item.catalog_book_id;
  const kind = item.book_id ? "uploaded" : "catalog";
  const bk = bookId ? `${kind}:${bookId}` : "";
  const matchedBook = books.find((b) => bookKeyOf(b) === bk);
  const totalPages = matchedBook ? bookPageCountOf(matchedBook) : null;
  const useRange = item.start_page !== null || item.end_page !== null;
  return {
    key: item.id,
    bookKey: bk,
    title: matchedBook ? bookTitleOf(matchedBook) : "",
    totalPages,
    useRange,
    startPage: item.start_page,
    endPage: item.end_page,
  };
}

function PlanItemRow({
  item,
  books,
  onPickBook,
  onPatch,
  onRemove,
}: {
  item: DraftItem;
  books: UnifiedLibraryItem[];
  onPickBook: (key: string) => void;
  onPatch: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-glass-border bg-glass-bg/40 p-3">
      <div className="flex items-center gap-2">
        <BookOpen size={14} className="shrink-0 text-text-muted" />
        <select
          value={item.bookKey}
          onChange={(e) => onPickBook(e.target.value)}
          className="min-w-0 flex-1 rounded border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-purple"
        >
          <option value="">{t("readingPlans.detail.pickBook")}</option>
          {books.map((b) => (
            <option key={bookKeyOf(b)} value={bookKeyOf(b)}>
              {bookTitleOf(b)}
              {bookPageCountOf(b) ? ` (${bookPageCountOf(b)}p)` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={onRemove}
          aria-label={t("common.remove")}
          className="rounded p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-red-400 cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {item.bookKey && (
        <>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={item.useRange}
              onChange={(e) =>
                onPatch({
                  useRange: e.target.checked,
                  startPage: e.target.checked ? 1 : null,
                  endPage: e.target.checked ? item.totalPages ?? null : null,
                })
              }
              className="cursor-pointer accent-accent-purple"
            />
            {t("readingPlans.detail.useRange")}
          </label>

          {item.useRange && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center text-xs">
              <div>
                <label className="block text-[10px] text-text-muted">
                  {t("readingPlans.detail.startPage")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={item.totalPages ?? undefined}
                  value={item.startPage ?? ""}
                  onChange={(e) =>
                    onPatch({
                      startPage: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="w-full rounded border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-purple"
                />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted">
                  {t("readingPlans.detail.endPage")}
                </label>
                <input
                  type="number"
                  min={item.startPage ?? 1}
                  max={item.totalPages ?? undefined}
                  value={item.endPage ?? ""}
                  onChange={(e) =>
                    onPatch({
                      endPage: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full rounded border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-purple"
                />
              </div>
              {item.totalPages && (
                <span className="text-[10px] text-text-muted sm:self-end sm:pb-1">
                  {t("readingPlans.detail.totalPages", {
                    total: item.totalPages,
                  })}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
