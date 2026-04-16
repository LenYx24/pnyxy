import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { BookStatusTag } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";

const EMPTY_TAGS: BookStatusTag[] = [];

export function bookKey(item: UnifiedLibraryItem): string {
  return item.source === "catalog"
    ? `catalog:${item.catalog_book_id}`
    : `uploaded:${item.id}`;
}

interface TagState {
  /** Map from "catalog:{id}" or "uploaded:{id}" to array of tags */
  bookTags: Map<string, BookStatusTag[]>;
  isLoading: boolean;

  fetchUserTags: () => Promise<void>;
  addTag: (item: UnifiedLibraryItem, tag: BookStatusTag) => Promise<void>;
  removeTag: (item: UnifiedLibraryItem, tag: BookStatusTag) => Promise<void>;
  getTagsForBook: (item: UnifiedLibraryItem) => BookStatusTag[];
}

export const useTagStore = create<TagState>((set, get) => ({
  bookTags: new Map(),
  isLoading: false,

  fetchUserTags: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    set({ isLoading: true });

    const { data, error } = await supabase
      .from("user_book_tags")
      .select("*")
      .eq("user_id", user.id);

    if (error) {
      logError("tag-store:fetchUserTags", error.message);
      set({ isLoading: false });
      return;
    }

    const map = new Map<string, BookStatusTag[]>();
    for (const row of data ?? []) {
      const key = row.catalog_book_id
        ? `catalog:${row.catalog_book_id}`
        : `uploaded:${row.book_id}`;
      const existing = map.get(key) ?? [];
      existing.push(row.tag as BookStatusTag);
      map.set(key, existing);
    }

    set({ bookTags: map, isLoading: false });
  },

  addTag: async (item, tag) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const isCatalog = item.source === "catalog";
    const { error } = await supabase.from("user_book_tags").insert({
      user_id: user.id,
      catalog_book_id: isCatalog ? item.catalog_book_id : null,
      book_id: isCatalog ? null : item.id,
      tag,
    });

    if (error) {
      logError("tag-store:addTag", error.message);
      throw error;
    }

    const key = bookKey(item);
    set((state) => {
      const next = new Map(state.bookTags);
      const existing = next.get(key) ?? [];
      if (!existing.includes(tag)) {
        next.set(key, [...existing, tag]);
      }
      return { bookTags: next };
    });
  },

  removeTag: async (item, tag) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const isCatalog = item.source === "catalog";

    let query = supabase
      .from("user_book_tags")
      .delete()
      .eq("user_id", user.id)
      .eq("tag", tag);

    if (isCatalog) {
      query = query.eq("catalog_book_id", item.catalog_book_id);
    } else {
      query = query.eq("book_id", item.id);
    }

    const { error } = await query;

    if (error) {
      logError("tag-store:removeTag", error.message);
      throw error;
    }

    const key = bookKey(item);
    set((state) => {
      const next = new Map(state.bookTags);
      const existing = next.get(key) ?? [];
      next.set(
        key,
        existing.filter((t) => t !== tag),
      );
      return { bookTags: next };
    });
  },

  getTagsForBook: (item) => {
    return get().bookTags.get(bookKey(item)) ?? EMPTY_TAGS;
  },
}));
