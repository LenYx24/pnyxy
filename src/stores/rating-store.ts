import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { CatalogBook } from "@/types/catalog";

interface RatingState {
  /** Map of catalogBookId → user's own star rating (1-5). Books the
   *  user hasn't rated aren't in the map. */
  myRatings: Map<string, number>;
  /** Lock used to prevent duplicate concurrent writes for the same
   *  book from racing each other. */
  inFlight: Set<string>;

  /** One-shot load of every rating the current user has made. Called
   *  once on sign-in so the browse grid can show each user's mark. */
  fetchMyRatings: () => Promise<void>;

  /**
   * Upsert the current user's rating for a book. Returns the updated
   * CatalogBook row (with refreshed rating_avg/rating_count) so the
   * caller can patch its list. Optimistically updates myRatings.
   */
  rateBook: (bookId: string, stars: number) => Promise<CatalogBook | null>;

  /** Delete the current user's rating for a book. Returns the updated
   *  CatalogBook row for the same reason as rateBook. */
  clearRating: (bookId: string) => Promise<CatalogBook | null>;
}

async function refetchBook(bookId: string): Promise<CatalogBook | null> {
  const { data, error } = await supabase
    .from("catalog_books")
    .select("*")
    .eq("id", bookId)
    .single();
  if (error) {
    logError("rating-store:refetchBook", error.message);
    return null;
  }
  return data as CatalogBook;
}

export const useRatingStore = create<RatingState>((set, get) => ({
  myRatings: new Map(),
  inFlight: new Set(),

  fetchMyRatings: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ myRatings: new Map() });
      return;
    }
    const { data, error } = await supabase
      .from("book_ratings")
      .select("catalog_book_id, stars")
      .eq("user_id", user.id);
    if (error) {
      logError("rating-store:fetchMyRatings", error.message);
      return;
    }
    const map = new Map<string, number>();
    for (const row of data ?? []) {
      map.set(row.catalog_book_id as string, row.stars as number);
    }
    set({ myRatings: map });
  },

  rateBook: async (bookId, stars) => {
    if (stars < 1 || stars > 5) return null;
    const { inFlight } = get();
    if (inFlight.has(bookId)) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // Optimistic update so the star picker stays responsive.
    const prev = get().myRatings.get(bookId);
    const nextMap = new Map(get().myRatings);
    nextMap.set(bookId, stars);
    const nextFlight = new Set(inFlight);
    nextFlight.add(bookId);
    set({ myRatings: nextMap, inFlight: nextFlight });

    const { error } = await supabase.from("book_ratings").upsert(
      {
        user_id: user.id,
        catalog_book_id: bookId,
        stars,
      },
      { onConflict: "user_id,catalog_book_id" },
    );

    // Clear the in-flight flag regardless of outcome.
    const clearedFlight = new Set(get().inFlight);
    clearedFlight.delete(bookId);

    if (error) {
      logError("rating-store:rateBook", error.message);
      // Roll back the optimistic map.
      const rollback = new Map(get().myRatings);
      if (prev != null) rollback.set(bookId, prev);
      else rollback.delete(bookId);
      set({ myRatings: rollback, inFlight: clearedFlight });
      return null;
    }

    set({ inFlight: clearedFlight });
    return refetchBook(bookId);
  },

  clearRating: async (bookId) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const prev = get().myRatings.get(bookId);
    if (prev == null) return null;

    const nextMap = new Map(get().myRatings);
    nextMap.delete(bookId);
    set({ myRatings: nextMap });

    const { error } = await supabase
      .from("book_ratings")
      .delete()
      .eq("user_id", user.id)
      .eq("catalog_book_id", bookId);

    if (error) {
      logError("rating-store:clearRating", error.message);
      const rollback = new Map(get().myRatings);
      rollback.set(bookId, prev);
      set({ myRatings: rollback });
      return null;
    }

    return refetchBook(bookId);
  },
}));
