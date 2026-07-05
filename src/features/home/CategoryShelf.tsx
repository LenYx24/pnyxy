import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { CatalogBook } from "@/types/catalog";
import { Shelf } from "@/features/browse/Shelf";
import { BrowseBookShelfCard } from "@/features/browse/BrowseBookShelfCard";

const SHELF_SIZE = 10;

/**
 * Self-contained shelf that fetches the top N verified catalog books
 * for a given category via the category junction table. Renders
 * nothing when the category has no books, the Shelf component
 * already hides empty shelves, so categories with a small catalog
 * just silently disappear from the Home page.
 */
export function CategoryShelf({
  categoryId,
  title,
}: {
  categoryId: string;
  title: string;
}) {
  const navigate = useNavigate();
  const [books, setBooks] = useState<CatalogBook[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const junction = await supabase
        .from("catalog_book_categories")
        .select("catalog_book_id")
        .eq("category_id", categoryId);
      if (junction.error) {
        logError("CategoryShelf:junction", junction.error.message);
        return;
      }
      const ids = (junction.data ?? []).map((r) => r.catalog_book_id);
      if (ids.length === 0) {
        if (!cancelled) setBooks([]);
        return;
      }
      const { data, error } = await supabase
        .from("catalog_books")
        .select("*")
        .eq("status", "verified")
        .in("id", ids)
        .order("rating_count", { ascending: false })
        .range(0, SHELF_SIZE - 1);
      if (error) {
        logError("CategoryShelf:books", error.message);
        return;
      }
      if (!cancelled) setBooks((data ?? []) as CatalogBook[]);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  return (
    <Shelf title={title} itemCount={books.length}>
      {books.map((book) => (
        <div
          key={book.id}
          className="w-[7.5rem] shrink-0 snap-start sm:w-[8.5rem]"
        >
          <BrowseBookShelfCard
            book={book}
            onClick={() => navigate(`/books/${book.id}`)}
          />
        </div>
      ))}
    </Shelf>
  );
}
