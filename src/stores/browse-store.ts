import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { CatalogBook, CatalogBookInsert } from "@/types/catalog";

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
}));
