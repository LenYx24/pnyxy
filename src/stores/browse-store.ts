import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import type { CatalogBook, CatalogBookInsert } from "@/types/catalog";

function assertCatalogBookClean(book: CatalogBookInsert) {
  const authors = Array.isArray(book.authors)
    ? book.authors.join(" ")
    : (book.authors as unknown as string | undefined);
  const offenders = [book.title, authors, book.description].filter(
    (v): v is string => typeof v === "string" && containsProfanity(v),
  );
  if (offenders.length > 0) {
    throw new Error(
      "Book submission contains disallowed language in its title, author, or description.",
    );
  }
}

interface BrowseState {
  catalogBooks: CatalogBook[];
  searchQuery: string;
  activeCategory: string | null; // category UUID
  isLoading: boolean;
  selectedBook: CatalogBook | null;
  userLibraryIds: Set<string>;
  totalCount: number;
  page: number;

  fetchCatalogBooks: () => Promise<void>;
  searchCatalog: (query: string) => Promise<void>;
  filterByCategory: (categoryId: string | null) => Promise<void>;
  loadMore: () => Promise<void>;
  addBookToCatalog: (book: CatalogBookInsert, categoryIds?: string[]) => Promise<void>;
  addBooksToCatalog: (books: CatalogBookInsert[]) => Promise<void>;
  addToUserLibrary: (bookId: string) => Promise<void>;
  removeFromUserLibrary: (bookId: string) => Promise<void>;
  checkUserLibrary: () => Promise<void>;
  setSelectedBook: (book: CatalogBook | null) => void;
  /**
   * Subscribe to Supabase realtime UPDATEs on `catalog_books` so newly
   * approved submissions appear in the browse list without a refresh.
   * Returns an unsubscribe function.
   */
  subscribeCatalogUpdates: () => () => void;
}

const PAGE_SIZE = 20;

async function fetchBookIdsByCategory(categoryId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("catalog_book_categories")
    .select("catalog_book_id")
    .eq("category_id", categoryId);

  if (error) {
    logError("browse-store:fetchBookIdsByCategory", error.message);
    return [];
  }
  return (data ?? []).map((d) => d.catalog_book_id);
}

export const useBrowseStore = create<BrowseState>((set, get) => ({
  catalogBooks: [],
  searchQuery: "",
  activeCategory: null,
  isLoading: false,
  selectedBook: null,
  userLibraryIds: new Set(),
  totalCount: 0,
  page: 0,

  fetchCatalogBooks: async () => {
    set({ isLoading: true, page: 0 });
    const { searchQuery, activeCategory } = get();

    // If filtering by category, get matching IDs from junction table first
    let categoryBookIds: string[] | null = null;
    if (activeCategory) {
      categoryBookIds = await fetchBookIdsByCategory(activeCategory);
      if (categoryBookIds.length === 0) {
        set({ catalogBooks: [], totalCount: 0, isLoading: false });
        return;
      }
    }

    let query = supabase
      .from("catalog_books")
      .select("*", { count: "exact" })
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (searchQuery) {
      query = query.ilike("title", `%${searchQuery}%`);
    }
    if (categoryBookIds) {
      query = query.in("id", categoryBookIds);
    }

    const { data, error, count } = await query;
    if (error) {
      logError("browse-store:fetchCatalogBooks", error.message);
      set({ isLoading: false });
      return;
    }

    set({
      catalogBooks: data ?? [],
      totalCount: count ?? 0,
      isLoading: false,
    });
  },

  loadMore: async () => {
    const { page, catalogBooks, searchQuery, activeCategory, totalCount } =
      get();
    if (catalogBooks.length >= totalCount) return;

    const nextPage = page + 1;
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    set({ isLoading: true });

    // If filtering by category, get matching IDs from junction table
    let categoryBookIds: string[] | null = null;
    if (activeCategory) {
      categoryBookIds = await fetchBookIdsByCategory(activeCategory);
    }

    let query = supabase
      .from("catalog_books")
      .select("*")
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (searchQuery) {
      query = query.ilike("title", `%${searchQuery}%`);
    }
    if (categoryBookIds) {
      query = query.in("id", categoryBookIds);
    }

    const { data, error } = await query;
    if (error) {
      logError("browse-store:loadMore", error.message);
      set({ isLoading: false });
      return;
    }

    set({
      catalogBooks: [...catalogBooks, ...(data ?? [])],
      page: nextPage,
      isLoading: false,
    });
  },

  searchCatalog: async (query) => {
    set({ searchQuery: query });
    await get().fetchCatalogBooks();
  },

  filterByCategory: async (categoryId) => {
    set({ activeCategory: categoryId });
    await get().fetchCatalogBooks();
  },

  addBookToCatalog: async (book, categoryIds) => {
    assertCatalogBookClean(book);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { downloadable: _, ...catalogBook } = book as unknown as Record<string, unknown>;
    const { data, error } = await supabase
      .from("catalog_books")
      .insert({
        ...catalogBook,
        submitted_by: user?.id,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      logError("browse-store:addBookToCatalog", error.message);
      throw error;
    }

    // Link to categories via junction table
    if (data && categoryIds && categoryIds.length > 0) {
      const rows = categoryIds.map((cid) => ({
        catalog_book_id: data.id,
        category_id: cid,
      }));
      await supabase.from("catalog_book_categories").insert(rows);
    }
  },

  addBooksToCatalog: async (books) => {
    books.forEach(assertCatalogBookClean);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rows = books.map((book) => {
      const { downloadable: _, ...catalogBook } = book as unknown as Record<
        string,
        unknown
      >;
      return { ...catalogBook, submitted_by: user?.id, status: "pending" };
    });

    const { error } = await supabase.from("catalog_books").insert(rows);

    if (error) {
      logError("browse-store:addBooksToCatalog", error.message);
      throw error;
    }
  },

  addToUserLibrary: async (bookId) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Must be signed in");

    const { error } = await supabase.from("user_library").insert({
      user_id: user.id,
      catalog_book_id: bookId,
    });

    if (error) {
      logError("browse-store:addToUserLibrary", error.message);
      throw error;
    }

    set((state) => ({
      userLibraryIds: new Set([...state.userLibraryIds, bookId]),
    }));
  },

  removeFromUserLibrary: async (bookId) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Must be signed in");

    const { error } = await supabase
      .from("user_library")
      .delete()
      .eq("user_id", user.id)
      .eq("catalog_book_id", bookId);

    if (error) {
      logError("browse-store:removeFromUserLibrary", error.message);
      throw error;
    }

    set((state) => {
      const next = new Set(state.userLibraryIds);
      next.delete(bookId);
      return { userLibraryIds: next };
    });
  },

  checkUserLibrary: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ userLibraryIds: new Set() });
      return;
    }

    const { data, error } = await supabase
      .from("user_library")
      .select("catalog_book_id")
      .eq("user_id", user.id);

    if (error) {
      logError("browse-store:checkUserLibrary", error.message);
      return;
    }

    set({
      userLibraryIds: new Set(data.map((d) => d.catalog_book_id)),
    });
  },

  setSelectedBook: (book) => set({ selectedBook: book }),

  subscribeCatalogUpdates: () => {
    // Listen for INSERT (published directly by an admin) and UPDATE
    // (pending → verified). We only act when the row now has the
    // `verified` status so users see newly approved books immediately.
    const channel = supabase
      .channel("catalog_books_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "catalog_books" },
        (payload) => {
          // supabase-js gives us `new` for INSERT/UPDATE, `old` for DELETE.
          const untyped = payload as unknown as {
            new?: Record<string, unknown>;
            old?: Record<string, unknown>;
          };
          const rowCandidate =
            payload.eventType === "DELETE" ? untyped.old : untyped.new;
          if (!rowCandidate || typeof rowCandidate.id !== "string") return;

          if (payload.eventType === "DELETE") {
            const id = rowCandidate.id;
            set((state) => ({
              catalogBooks: state.catalogBooks.filter((b) => b.id !== id),
              totalCount: Math.max(0, state.totalCount - 1),
            }));
            return;
          }

          const row = rowCandidate as unknown as CatalogBook;

          const state = get();
          const isVerified =
            (row as { status?: string }).status === "verified";

          // Skip books that don't match the current search query. We leave
          // category filtering to a re-fetch since the junction is queried
          // separately; simplest correct behavior is to re-fetch when a
          // category filter is active.
          if (isVerified && state.activeCategory) {
            get().fetchCatalogBooks();
            return;
          }

          if (!isVerified) {
            // The book just left "verified" (rejected / re-pended) — drop it.
            set((s) => ({
              catalogBooks: s.catalogBooks.filter((b) => b.id !== row.id),
              totalCount: Math.max(0, s.totalCount - 1),
            }));
            return;
          }

          const query = state.searchQuery.toLowerCase().trim();
          if (query && !row.title.toLowerCase().includes(query)) return;

          set((s) => {
            // If we already have the book (e.g. metadata update), replace it.
            const existing = s.catalogBooks.findIndex((b) => b.id === row.id);
            if (existing >= 0) {
              const next = s.catalogBooks.slice();
              next[existing] = row;
              return { catalogBooks: next };
            }
            // Otherwise prepend (matches the default sort order: created_at desc).
            return {
              catalogBooks: [row, ...s.catalogBooks],
              totalCount: s.totalCount + 1,
            };
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
}));
