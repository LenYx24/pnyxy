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

// module-scope stale-while-revalidate cache so re-opening a book paints instantly
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

  // reset state during render when bookId changes (router keeps this mounted across param changes)
  // so a cache hit paints on the same commit with no spinner flash
  const [trackedBookId, setTrackedBookId] = useState(bookId);
  if (bookId !== trackedBookId) {
    setTrackedBookId(bookId);
    const cached = bookId ? bookDataCache.get(bookId) : undefined;
    setData(cached?.data ?? null);
    setLoading(!!bookId && !cached);
    setNotFound(!bookId);
  }

  // patch the loaded uploaded-book row and the cache together so a remount doesn't resurrect the old title
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

    // skip the network entirely while the cached copy is still fresh
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

      // Uploaded book (RLS restricts to user's own books). Look up by row
      // id first, then by file_hash: the reader's doc id for an uploaded
      // book is the file's content hash, so a title-click in the reader
      // lands here with the hash instead of the row id.
      let uploaded = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId)
        .maybeSingle();

      if (!cancelled && !uploaded.data) {
        uploaded = await supabase
          .from("books")
          .select("*")
          .eq("file_hash", bookId)
          .limit(1)
          .maybeSingle();
      }

      if (cancelled) return;

      if (uploaded.data) {
        // related rows are keyed by the real row id, not the hash
        const realId = (uploaded.data as Book).id;
        const [file, categories] = await Promise.all([
          supabase
            .from("book_files")
            .select("storage_path, file_name, size_bytes")
            .eq("book_id", realId)
            .eq("is_primary", true)
            .maybeSingle(),
          fetchCategoriesViaJunction("book_categories", "book_id", realId),
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

      // gone: drop the stale cache entry so revalidation surfaces the 404
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
