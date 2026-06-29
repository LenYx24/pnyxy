import type { UnifiedLibraryItem } from "@/types/catalog";
import { formatAuthors } from "@/lib/library/format-authors";

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
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

export function getRowDensity(cardSize: number) {
  if (cardSize <= 180) return { py: "py-1", text: "text-xs", icon: 14, gap: "gap-1" } as const;
  if (cardSize <= 250) return { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" } as const;
  return { py: "py-3.5", text: "text-sm", icon: 18, gap: "gap-2.5" } as const;
}

export type RowDensity = ReturnType<typeof getRowDensity>;
