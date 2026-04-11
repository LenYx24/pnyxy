import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { CatalogBook, CatalogBookInsert } from "@/types/catalog";

interface BrowseState {
  catalogBooks: CatalogBook[];
  searchQuery: string;
  activeCategory: string | null;
  isLoading: boolean;
  selectedBook: CatalogBook | null;
  userLibraryIds: Set<string>;
  totalCount: number;
  page: number;

  fetchCatalogBooks: () => Promise<void>;
  searchCatalog: (query: string) => Promise<void>;
  filterByCategory: (category: string | null) => Promise<void>;
  loadMore: () => Promise<void>;
  addBookToCatalog: (book: CatalogBookInsert) => Promise<void>;
  addToUserLibrary: (bookId: string) => Promise<void>;
  removeFromUserLibrary: (bookId: string) => Promise<void>;
  checkUserLibrary: () => Promise<void>;
  setSelectedBook: (book: CatalogBook | null) => void;
}

const PAGE_SIZE = 20;

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

    let query = supabase
      .from("catalog_books")
      .select("*", { count: "exact" })
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (searchQuery) {
      query = query.ilike("title", `%${searchQuery}%`);
    }
    if (activeCategory) {
      query = query.contains("categories", [activeCategory]);
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("Failed to fetch catalog books:", error.message);
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

    let query = supabase
      .from("catalog_books")
      .select("*")
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (searchQuery) {
      query = query.ilike("title", `%${searchQuery}%`);
    }
    if (activeCategory) {
      query = query.contains("categories", [activeCategory]);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Failed to load more catalog books:", error.message);
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

  filterByCategory: async (category) => {
    set({ activeCategory: category });
    await get().fetchCatalogBooks();
  },

  addBookToCatalog: async (book) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("catalog_books").insert({
      ...book,
      submitted_by: user?.id,
      status: "pending",
    });

    if (error) {
      console.error("Failed to add book to catalog:", error.message);
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
      console.error("Failed to add to library:", error.message);
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
      console.error("Failed to remove from library:", error.message);
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
      console.error("Failed to check user library:", error.message);
      return;
    }

    set({
      userLibraryIds: new Set(data.map((d) => d.catalog_book_id)),
    });
  },

  setSelectedBook: (book) => set({ selectedBook: book }),
}));
