import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Trash2, BookOpen, Loader2 } from "lucide-react";
import { Button, Toggle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useReadingPlanStore, todayIso } from "@/stores/reading-plan-store";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface DraftItem {
  /** Local key to keep React happy. */
  key: string;
  /** `catalog:<id>` or `uploaded:<id>` — stringly typed so the <select>
   *  can round-trip. Unpacked on submit. */
  bookKey: string;
  title: string;
  totalPages: number | null;
  useRange: boolean;
  startPage: number | null;
  endPage: number | null;
}

interface CreateReadingPlanModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (planId: string) => void;
}

function bookKey(item: UnifiedLibraryItem): string {
  return item.source === "catalog"
    ? `catalog:${item.catalog_book_id}`
    : `uploaded:${item.book.id}`;
}

function bookTitle(item: UnifiedLibraryItem): string {
  return item.source === "catalog" ? item.catalog_book.title : item.book.title;
}

function bookPageCount(item: UnifiedLibraryItem): number | null {
  return item.source === "catalog"
    ? item.catalog_book.page_count
    : item.book.page_count;
}

export function CreateReadingPlanModal({
  open,
  onClose,
  onCreated,
}: CreateReadingPlanModalProps) {
  const { t } = useTranslation();
  const books = useLibraryStore((s) => s.books);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const createPlan = useReadingPlanStore((s) => s.createPlan);

  // ── Form state ───────────────────────────────────────
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [ignoreWeekends, setIgnoreWeekends] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) fetchLibrary();
  }, [open, fetchLibrary]);

  // Reset when the modal opens fresh.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setStartDate(todayIso());
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setEndDate(d.toISOString().slice(0, 10));
    setIgnoreWeekends(false);
    setItems([]);
    setError("");
  }, [open]);

  // Quick lookup for showing total pages when an item's book is picked.
  const booksByKey = useMemo(() => {
    const m = new Map<string, UnifiedLibraryItem>();
    for (const b of books) m.set(bookKey(b), b);
    return m;
  }, [books]);

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        bookKey: "",
        title: "",
        totalPages: null,
        useRange: false,
        startPage: null,
        endPage: null,
      },
    ]);
  };

  const handleRemoveItem = (key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key));
  };

  const handlePickBook = (key: string, selectedKey: string) => {
    const book = booksByKey.get(selectedKey);
    if (!book) return;
    setItems((prev) =>
      prev.map((it) =>
        it.key === key
          ? {
              ...it,
              bookKey: selectedKey,
              title: bookTitle(book),
              totalPages: bookPageCount(book),
            }
          : it,
      ),
    );
  };

  const handleItemPatch = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
  };

  const canSubmit =
    title.trim().length > 0 &&
    startDate &&
    endDate &&
    endDate >= startDate &&
    items.length > 0 &&
    items.every((it) => !!it.bookKey);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const planId = await createPlan({
        title: title.trim(),
        start_date: startDate,
        end_date: endDate,
        ignore_weekends: ignoreWeekends,
        items: items.map((it, i) => {
          const [kind, id] = it.bookKey.split(":");
          return {
            book_id: kind === "uploaded" ? id : null,
            catalog_book_id: kind === "catalog" ? id : null,
            start_page: it.useRange ? (it.startPage ?? null) : null,
            end_page: it.useRange ? (it.endPage ?? null) : null,
            ordering: i,
          };
        }),
      });
      if (planId) onCreated?.(planId);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-glass-border bg-bg-secondary/95 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border px-5 py-3">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("readingPlans.create.title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("readingPlans.create.planTitle")}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("readingPlans.create.planTitlePlaceholder")}
              maxLength={120}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple"
            />
          </div>

          {/* Date range */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                {t("readingPlans.create.startDate")}
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
                {t("readingPlans.create.endDate")}
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

          {/* Options */}
          <div className="flex items-center justify-between rounded-lg border border-glass-border bg-glass-bg/40 p-3">
            <div>
              <div className="text-sm font-medium text-text-primary">
                {t("readingPlans.create.ignoreWeekends")}
              </div>
              <div className="text-xs text-text-muted">
                {t("readingPlans.create.ignoreWeekendsHint")}
              </div>
            </div>
            <Toggle
              checked={ignoreWeekends}
              onChange={setIgnoreWeekends}
              label={t("readingPlans.create.ignoreWeekends")}
            />
          </div>

          {/* Books */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">
                {t("readingPlans.create.booksHeading")}
              </label>
              <button
                onClick={handleAddItem}
                className="inline-flex items-center gap-1 rounded-md border border-glass-border bg-glass-bg px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Plus size={12} />
                {t("readingPlans.create.addBook")}
              </button>
            </div>

            {items.length === 0 && (
              <p className="rounded-lg border border-dashed border-glass-border bg-glass-bg/30 p-3 text-center text-xs text-text-muted">
                {t("readingPlans.create.noBooksHint")}
              </p>
            )}

            {items.map((it) => (
              <ItemRow
                key={it.key}
                item={it}
                books={books}
                onPickBook={(sk) => handlePickBook(it.key, sk)}
                onPatch={(patch) => handleItemPatch(it.key, patch)}
                onRemove={() => handleRemoveItem(it.key)}
              />
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-glass-border px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting
              ? t("readingPlans.create.creating")
              : t("readingPlans.create.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ItemRow({
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
          <option value="">{t("readingPlans.create.pickBook")}</option>
          {books.map((b) => (
            <option key={bookKey(b)} value={bookKey(b)}>
              {bookTitle(b)}
              {bookPageCount(b) ? ` (${bookPageCount(b)}p)` : ""}
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
            {t("readingPlans.create.useRange")}
          </label>

          {item.useRange && (
            <div
              className={cn(
                "grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-center text-xs",
              )}
            >
              <div>
                <label className="block text-[10px] text-text-muted">
                  {t("readingPlans.create.startPage")}
                </label>
                <input
                  type="number"
                  min={1}
                  max={item.totalPages ?? undefined}
                  value={item.startPage ?? ""}
                  onChange={(e) =>
                    onPatch({
                      startPage: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full rounded border border-glass-border bg-bg-primary/50 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-purple"
                />
              </div>
              <div>
                <label className="block text-[10px] text-text-muted">
                  {t("readingPlans.create.endPage")}
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
                  {t("readingPlans.create.totalPages", {
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
