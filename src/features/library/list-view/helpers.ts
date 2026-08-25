import type { TFunction } from "i18next";
import type { UnifiedLibraryItem } from "@/types/catalog";
import { formatAuthors } from "@/lib/library/format-authors";

/**
 * Column layout shared by the header row and every list row. Mobile
 * collapses to checkbox / tile / name / menu; from md up the type,
 * progress and modified columns come back at their fixed widths.
 */
export const LIST_GRID_CLASS =
  "grid grid-cols-[36px_32px_minmax(0,1fr)_36px] items-center gap-3 px-3 md:grid-cols-[36px_32px_minmax(0,1fr)_110px_150px_110px_36px]";

/** The only line the library draws: a 1 px tone step between rows
 *  (surface-3 at low alpha), never a glass border. */
export const ROW_SEPARATOR_CLASS = "border-b border-surface-3/60";

/** Shared row chrome: 58 px, tone-step separator, hover is a soft
 *  surface-3 wash, selected / expanded rows sit on surface-2. */
export const ROW_BASE_CLASS =
  "group h-[58px] select-none text-sm transition-colors hover:bg-surface-3/40 cursor-pointer";
export const ROW_ACTIVE_CLASS = "bg-bg-tertiary";
export const ROW_FOCUS_CLASS =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft";

/** The inline detail panel is inset with `md:pl-[104px]`: row padding
 *  (12) + checkbox (36) + gap (12) + tile (32) + gap (12), so its
 *  content lines up with the name column. */

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

/** "today" / "yesterday" / "3 days ago" / "2 weeks ago", then the
 *  plain date once it is older than about two months. */
export function formatRelative(dateStr: string, t: TFunction): string {
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const dayMs = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - then) / dayMs) + 1;
  if (days <= 0) return t("library.list.relative.today");
  if (days === 1) return t("library.list.relative.yesterday");
  if (days < 7) return t("library.list.relative.daysAgo", { count: days });
  if (days < 60)
    return t("library.list.relative.weeksAgo", { count: Math.floor(days / 7) });
  return formatDate(dateStr);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function getFileSize(entry: UnifiedLibraryItem): string | null {
  if (entry.source === "uploaded" && entry.book.size_bytes) {
    return formatBytes(entry.book.size_bytes);
  }
  return null;
}

export function getTitle(entry: UnifiedLibraryItem): string {
  return entry.source === "catalog" ? entry.catalog_book.title : entry.book.title;
}

export function getAuthor(entry: UnifiedLibraryItem): string {
  return entry.source === "catalog"
    ? formatAuthors(entry.catalog_book.authors) || "Unknown author"
    : formatAuthors(entry.book.authors, entry.book.author) || "Unknown author";
}

export function getCoverUrl(entry: UnifiedLibraryItem): string | null {
  return entry.source === "catalog"
    ? entry.catalog_book.cover_url
    : entry.book.cover_url;
}

export function getPageCount(entry: UnifiedLibraryItem): number | null {
  return entry.source === "catalog"
    ? entry.catalog_book.page_count
    : entry.book.page_count;
}

/** Reader document id: file hash for uploaded books (falls back to the
 *  row id for file-less shell books), catalog id for catalog books.
 *  Matches what chats / resume state are keyed by. */
export function getDocId(entry: UnifiedLibraryItem): string {
  return entry.source === "catalog"
    ? entry.catalog_book_id
    : entry.book.file_hash || entry.book.id;
}

/** "PDF · 312 p." style text for the type column. */
export function getTypeLabel(entry: UnifiedLibraryItem, t: TFunction): string {
  const pages = getPageCount(entry);
  let kind: string;
  if (entry.source === "catalog") {
    kind = t("library.list.type.catalog");
  } else if (!entry.book.storage_path) {
    kind = t("library.list.type.manual");
  } else {
    kind = (entry.book.format || "pdf").toUpperCase();
  }
  return pages ? `${kind} · ${t("library.list.pagesShort", { count: pages })}` : kind;
}

export function getRowDensity(cardSize: number) {
  if (cardSize <= 180) return { py: "py-1", text: "text-xs", icon: 14, gap: "gap-1" } as const;
  if (cardSize <= 250) return { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" } as const;
  return { py: "py-3.5", text: "text-sm", icon: 18, gap: "gap-2.5" } as const;
}

export type RowDensity = ReturnType<typeof getRowDensity>;

/**
 * Keyboard handling for a focused list row: arrows move focus between
 * sibling rows, Enter opens, Space toggles the checkbox. Rows are
 * discovered via the `data-list-row` attribute so nothing needs to be
 * wired through props.
 */
export function handleRowKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  actions: { onOpen: () => void; onToggleSelect: () => void },
) {
  if (e.target !== e.currentTarget) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-list-row]"),
    );
    const idx = rows.indexOf(e.currentTarget);
    if (idx === -1) return;
    const next = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
    next?.focus();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    actions.onOpen();
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    actions.onToggleSelect();
  }
}
