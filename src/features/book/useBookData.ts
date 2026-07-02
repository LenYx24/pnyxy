import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CatalogBook } from "@/types/catalog";
import type { Book, Category } from "@/types/database";

export type ResolvedBook =
  | {
      source: "catalog";
      book: CatalogBook;
      categories: Category[];
    }
  | {
      source: "uploaded";
      book: Book;
      storagePath: string | null;
      fileName: string | null;
      sizeBytes: number | null;
      categories: Category[];
    };

// Session-lived cache of resolved book detail, keyed by bookId. Re-
// opening a book you've already viewed this session paints instantly
// from here instead of replaying the Supabase waterfall (the "why is
// the description page so slow" complaint). Stale-while-revalidate:
// the cached copy shows immediately, then a background refetch —
// throttled by REVALIDATE_MS — refreshes it in place with no spinner.
// Lives at module scope so it survives route unmount/remount; cleared
// on a full page reload (fine — that's a fresh session).
const bookDataCache = new Map<string, { data: ResolvedBook; fetchedAt: number }>();
const REVALIDATE_MS = 60_000;

async function fetchCategoriesViaJunction(
  table: "catalog_book_categories" | "book_categories",
  fkColumn: "catalog_book_id" | "book_id",
  id: string,
): Promise<Category[]> {
  const links = await supabase
    .from(table)
    .select("category_id")
    .eq(fkColumn, id);
  if (!links.data || links.data.length === 0) return [];
  const ids = links.data.map((l) => l.category_id);
  const cats = await supabase.from("categories").select("*").in("id", ids);
  return (cats.data ?? []) as Category[];
}

export function useBookData(bookId: string | undefined) {
  const [data, setData] = useState<ResolvedBook | null>(
    () => (bookId ? bookDataCache.get(bookId)?.data ?? null : null),
  );
  const [loading, setLoading] = useState(
    () => !!bookId && !bookDataCache.has(bookId),
  );
  const [notFound, setNotFound] = useState(() => !bookId);

  // Adjust state during render when the book changes without a remount
  // (React Router keeps this component across `:bookId` param changes).
  // Doing it here — the documented "reset state when a prop changes"
  // pattern — instead of in an effect means a cache hit paints its data
  // on the same commit, with no spinner flash and no synchronous
  // setState-in-effect cascade.
  const [trackedBookId, setTrackedBookId] = useState(bookId);
  if (bookId !== trackedBookId) {
    setTrackedBookId(bookId);
    const cached = bookId ? bookDataCache.get(bookId) : undefined;
    setData(cached?.data ?? null);
    setLoading(!!bookId && !cached);
    setNotFound(!bookId);
  }

  // Optimistic patch for the loaded uploaded-book row. Returned to
  // callers so a rename-from-the-description-page can update the
  // sidebar title + URL slug without a re-fetch round trip. The
  // library-store is the source of truth on its own — this keeps both
  // this page's local copy AND the session cache in sync so a remount
  // doesn't resurrect the pre-rename title.
  const patchUploadedBook = (patch: Partial<Book>) => {
    setData((d) => {
      if (d?.source !== "uploaded") return d;
      const next: ResolvedBook = { ...d, book: { ...d.book, ...patch } };
      if (bookId) {
        bookDataCache.set(bookId, {
          data: next,
          fetchedAt: bookDataCache.get(bookId)?.fetchedAt ?? Date.now(),
        });
      }
      return next;
    });
  };

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;

    // Initial data/loading/notFound state is already set (from the cache
    // via useState init, or reset during render above). Here we only
    // decide whether to hit the network: skip entirely when a cached
    // copy is still fresh, otherwise cold-fetch or background-revalidate.
    const cached = bookDataCache.get(bookId);
    if (cached && Date.now() - cached.fetchedAt < REVALIDATE_MS) return;

    const commit = (resolved: ResolvedBook) => {
      bookDataCache.set(bookId, { data: resolved, fetchedAt: Date.now() });
      if (cancelled) return;
      setData(resolved);
      setLoading(false);
      setNotFound(false);
    };

    (async () => {
      // Catalog first (public, no auth needed)
      const catalog = await supabase
        .from("catalog_books")
        .select("*")
        .eq("id", bookId)
        .maybeSingle();

      if (cancelled) return;

      if (catalog.data) {
        const categories = await fetchCategoriesViaJunction(
          "catalog_book_categories",
          "catalog_book_id",
          bookId,
        );
        if (cancelled) return;
        commit({
          source: "catalog",
          book: catalog.data as CatalogBook,
          categories,
        });
        return;
      }

      // Uploaded book (RLS restricts to user's own books)
      const uploaded = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId)
        .maybeSingle();

      if (cancelled) return;

      if (uploaded.data) {
        const [file, categories] = await Promise.all([
          supabase
            .from("book_files")
            .select("storage_path, file_name, size_bytes")
            .eq("book_id", bookId)
            .eq("is_primary", true)
            .maybeSingle(),
          fetchCategoriesViaJunction("book_categories", "book_id", bookId),
        ]);
        if (cancelled) return;
        commit({
          source: "uploaded",
          book: uploaded.data as Book,
          storagePath: file.data?.storage_path ?? null,
          fileName: file.data?.file_name ?? null,
          sizeBytes: file.data?.size_bytes ?? null,
          categories,
        });
        return;
      }

      // Genuinely gone (never existed, or deleted since we cached it).
      // Drop any stale cache entry so a revalidation surfaces the 404.
      bookDataCache.delete(bookId);
      if (cancelled) return;
      setData(null);
      setNotFound(true);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return { data, loading, notFound, patchUploadedBook };
}
