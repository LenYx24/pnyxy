import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useBrowseStore } from "@/stores/browse-store";
import type { CatalogBook } from "@/types/catalog";
import { Shelf } from "./Shelf";
import { BrowseBookCard } from "./BrowseBookCard";
import { getRecentlyViewedIds } from "./recently-viewed";

/**
 * Shelf of catalog books the user has recently opened. Hydrates
 * itself from localStorage ids and a single Supabase `in(...)` lookup.
 * Re-fetches when the id list changes (custom event fired by
 * trackRecentlyViewed). Renders nothing when the list is empty, so
 * first-time users don't see a placeholder.
 */
export function RecentlyViewedShelf() {
  const { t } = useTranslation();
  const setSelectedBook = useBrowseStore((s) => s.setSelectedBook);
  const [books, setBooks] = useState<CatalogBook[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const ids = getRecentlyViewedIds();
      if (ids.length === 0) {
        if (!cancelled) setBooks([]);
        return;
      }
      const { data, error } = await supabase
        .from("catalog_books")
        .select("*")
        .in("id", ids);
      if (error) {
        logError("RecentlyViewedShelf:load", error.message);
        return;
      }
      if (cancelled) return;
      // Preserve the localStorage order (most-recent first).
      const order = new Map(ids.map((id, i) => [id, i] as const));
      const sorted = ((data ?? []) as CatalogBook[]).slice().sort((a, b) => {
        return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
      });
      setBooks(sorted);
    };

    load();
    const onChange = () => load();
    window.addEventListener("pnyxy:recently-viewed-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("pnyxy:recently-viewed-changed", onChange);
    };
  }, []);

  return (
    <Shelf title={t("browse.shelves.recentlyViewed")} itemCount={books.length}>
      {books.map((book) => (
        <div
          key={book.id}
          className="shrink-0 basis-[10rem] snap-start sm:basis-[11rem]"
        >
          <BrowseBookCard
            book={book}
            onClick={() => setSelectedBook(book)}
          />
        </div>
      ))}
    </Shelf>
  );
}
