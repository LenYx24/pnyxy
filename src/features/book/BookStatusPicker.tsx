import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useTagStore } from "@/stores/tag-store";
import { useAuthStore } from "@/stores/auth-store";
import {
  ALL_STATUS_TAGS,
  COLOR_PALETTE,
  DEFAULT_TAG_COLORS,
  TAG_LABELS,
} from "@/lib/tag-colors";
import type { BookStatusTag } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";
import { cn } from "@/lib/cn";
import { useBook } from "./BookPageContext";

/**
 * Small status-tag picker for the book overview. Toggle-on / toggle-off
 * pills for the six built-in statuses (Want to read, Reading, Done…).
 * Wraps the existing `tag-store` actions so adding the picker doesn't
 * duplicate any DB plumbing, same source of truth as the library.
 *
 * For the tag-store helpers we only need `source` and the right id, so
 * we hand-build a minimal `UnifiedLibraryItem` shape rather than
 * rebuilding the full row from useBookData.
 */
export function BookStatusPicker() {
  const { t } = useTranslation();
  const data = useBook();
  const user = useAuthStore((s) => s.user);
  const fetchUserTags = useTagStore((s) => s.fetchUserTags);
  const getTagsForBook = useTagStore((s) => s.getTagsForBook);
  const addTag = useTagStore((s) => s.addTag);
  const removeTag = useTagStore((s) => s.removeTag);
  const tagsMap = useTagStore((s) => s.bookTags);
  const isLoading = useTagStore((s) => s.isLoading);

  const [pendingTag, setPendingTag] = useState<BookStatusTag | null>(null);

  // Build the minimal `UnifiedLibraryItem` shape tag-store reads.
  // Only `source` + the right id are used, the rest of the fields
  // would just be unused noise. The cast acknowledges this trim.
  const item = useMemo<UnifiedLibraryItem>(() => {
    if (data.source === "catalog") {
      return {
        source: "catalog",
        catalog_book_id: data.book.id,
      } as UnifiedLibraryItem;
    }
    return {
      source: "uploaded",
      id: data.book.id,
    } as UnifiedLibraryItem;
  }, [data]);

  // Hydrate tags on mount when signed in. Cheap idempotent fetch
  // (tag-store dedupes), so it's fine to fire on every mount.
  useEffect(() => {
    if (user) void fetchUserTags();
  }, [user, fetchUserTags]);

  // tagsMap is the dependency that causes re-render; we read through
  // the helper so we get the same comparison shape as elsewhere.
  void tagsMap;
  const active = getTagsForBook(item);
  const activeSet = useMemo(() => new Set(active), [active]);

  if (!user) return null;

  const toggle = async (tag: BookStatusTag) => {
    if (pendingTag) return;
    setPendingTag(tag);
    try {
      if (activeSet.has(tag)) {
        await removeTag(item, tag);
      } else {
        await addTag(item, tag);
      }
    } finally {
      setPendingTag(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t("book.status.heading")}
        </h3>
        {isLoading && (
          <Loader2 size={12} className="animate-spin text-text-muted" />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ALL_STATUS_TAGS.map((tag) => {
          const isActive = activeSet.has(tag);
          const palette = COLOR_PALETTE[DEFAULT_TAG_COLORS[tag]];
          const isPending = pendingTag === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => void toggle(tag)}
              disabled={isPending}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                isActive
                  ? cn(palette.bg, palette.text, "border-transparent")
                  : "border-glass-border bg-glass-bg/40 text-text-muted hover:bg-glass-hover hover:text-text-primary",
                isPending && "opacity-50",
              )}
              aria-pressed={isActive}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  isActive ? palette.dot : "bg-text-muted/50",
                )}
              />
              {TAG_LABELS[tag]}
              {isPending && <Loader2 size={10} className="animate-spin" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
