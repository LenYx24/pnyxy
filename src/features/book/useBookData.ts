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
  const [data, setData] = useState<ResolvedBook | null>(null);
  const [loading, setLoading] = useState(() => !!bookId);
  const [notFound, setNotFound] = useState(() => !bookId);

  // Optimistic patch for the loaded uploaded-book row. Returned to
  // callers so a rename-from-the-description-page can update the
  // sidebar title + URL slug without a re-fetch round trip. The
  // library-store is the source of truth on its own — this just
  // keeps this page's local copy in sync for the in-flight session.
  const patchUploadedBook = (patch: Partial<Book>) => {
    setData((d) =>
      d?.source === "uploaded"
        ? { ...d, book: { ...d.book, ...patch } }
        : d,
    );
  };

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;

    (async () => {
      // State resets live inside the async callback (not the effect body)
      // so they fire once per bookId change, not on every render.
      setLoading(true);
      setNotFound(false);
      setData(null);

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
        setData({
          source: "catalog",
          book: catalog.data as CatalogBook,
          categories,
        });
        setLoading(false);
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
        setData({
          source: "uploaded",
          book: uploaded.data as Book,
          storagePath: file.data?.storage_path ?? null,
          fileName: file.data?.file_name ?? null,
          sizeBytes: file.data?.size_bytes ?? null,
          categories,
        });
        setLoading(false);
        return;
      }

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
