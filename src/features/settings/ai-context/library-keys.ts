import type { UnifiedLibraryItem } from "@/types/catalog";

/**
 * The reader opens catalog books under `catalog_books.id` and uploads
 * under `books.id`; chat conversations store that same id as
 * `source_doc_id`. Bindings are keyed by it so a docId can be looked up
 * directly.
 */
export function bookBindingKey(item: UnifiedLibraryItem): string {
  return item.source === "catalog" ? item.catalog_book_id : item.id;
}

export function bookDisplayTitle(item: UnifiedLibraryItem): string {
  return item.source === "catalog" ? item.catalog_book.title : item.book.title;
}

export function findLibraryItemByDocId(
  items: readonly UnifiedLibraryItem[],
  docId: string,
): UnifiedLibraryItem | undefined {
  return items.find((it) => bookBindingKey(it) === docId);
}
