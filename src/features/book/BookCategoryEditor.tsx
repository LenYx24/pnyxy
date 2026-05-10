import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useCategoryStore } from "@/stores/category-store";
import { useAuthStore } from "@/stores/auth-store";
import { FloatingMenu } from "@/components/ui";
import type { Category } from "@/types/database";
import { cn } from "@/lib/cn";

/**
 * Inline category editor for the book overview. Uploaded books only
 * for now — catalog book categories are community-shared and editing
 * them needs proper moderation, which is a separate feature.
 *
 * Loads the full category list from `category-store`, displays the
 * currently linked ones as removable chips, and exposes a "+" button
 * with a floating menu of unselected categories. Writes go to
 * `book_categories` (the user-uploaded junction table).
 */
interface BookCategoryEditorProps {
  bookId: string;
  initialCategories: Category[];
  /** Optional callback so the parent can update its local copy of
   *  the book's categories without re-fetching the whole book. */
  onChange?: (next: Category[]) => void;
}

export function BookCategoryEditor({
  bookId,
  initialCategories,
  onChange,
}: BookCategoryEditorProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const allCategories = useCategoryStore((s) => s.categories);
  const fetchCategories = useCategoryStore((s) => s.fetchCategories);
  const isLoadingCatalog = useCategoryStore((s) => s.isLoading);

  const [linked, setLinked] = useState<Category[]>(initialCategories);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (allCategories.length === 0 && !isLoadingCatalog) {
      void fetchCategories();
    }
  }, [allCategories.length, isLoadingCatalog, fetchCategories]);

  useEffect(() => {
    setLinked(initialCategories);
  }, [initialCategories]);

  const linkedIds = useMemo(
    () => new Set(linked.map((c) => c.id)),
    [linked],
  );
  const available = useMemo(
    () => allCategories.filter((c) => !linkedIds.has(c.id)),
    [allCategories, linkedIds],
  );

  const updateLinked = (next: Category[]) => {
    setLinked(next);
    onChange?.(next);
  };

  const handleAdd = async (cat: Category) => {
    setMenuOpen(false);
    if (!user || pending) return;
    setPending(true);
    setError(null);
    const { error: insertError } = await supabase
      .from("book_categories")
      .insert({ book_id: bookId, category_id: cat.id });
    if (insertError) {
      logError("BookCategoryEditor:add", insertError);
      setError(insertError.message);
      setPending(false);
      return;
    }
    updateLinked([...linked, cat].sort((a, b) => a.sort_order - b.sort_order));
    setPending(false);
  };

  const handleRemove = async (cat: Category) => {
    if (!user || pending) return;
    const previous = linked;
    updateLinked(linked.filter((c) => c.id !== cat.id));
    setPending(true);
    setError(null);
    const { error: deleteError } = await supabase
      .from("book_categories")
      .delete()
      .eq("book_id", bookId)
      .eq("category_id", cat.id);
    if (deleteError) {
      logError("BookCategoryEditor:remove", deleteError);
      setError(deleteError.message);
      updateLinked(previous);
    }
    setPending(false);
  };

  if (!user) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {t("book.categories.heading", { defaultValue: "Categories" })}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {linked.map((cat) => (
          <span
            key={cat.id}
            className="inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-bg/40 pl-3 pr-1 py-0.5 text-xs text-text-secondary"
          >
            {cat.name}
            <button
              type="button"
              onClick={() => void handleRemove(cat)}
              className="rounded-full p-0.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-red-400 cursor-pointer"
              aria-label={t("common.remove", { defaultValue: "Remove" })}
              title={t("common.remove", { defaultValue: "Remove" })}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={available.length === 0 || pending}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-glass-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
            (available.length === 0 || pending) && "cursor-not-allowed opacity-50",
          )}
        >
          {pending ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Plus size={11} />
          )}
          {t("book.categories.add", { defaultValue: "Add category" })}
        </button>
        <FloatingMenu
          open={menuOpen}
          anchorRef={triggerRef}
          onClose={() => setMenuOpen(false)}
          className="max-h-72 overflow-y-auto"
        >
          {available.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted">
              {t("book.categories.noneLeft", {
                defaultValue: "All categories already linked.",
              })}
            </p>
          ) : (
            available.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => void handleAdd(cat)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                {cat.name}
              </button>
            ))
          )}
        </FloatingMenu>
      </div>
      {error && (
        <p className="text-[11px] text-red-400">{error}</p>
      )}
    </div>
  );
}
