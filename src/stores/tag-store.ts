import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { BookStatusTag } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";

const EMPTY_STATUS_TAGS: BookStatusTag[] = [];
const EMPTY_CUSTOM_TAGS: string[] = [];

/** Hard cap on custom-tag length. Mirrors the DB CHECK constraint
 *  (`label_length`), keep these in sync if either side changes. */
export const CUSTOM_TAG_MAX_LENGTH = 50;

export function bookKey(item: UnifiedLibraryItem): string {
  return item.source === "catalog"
    ? `catalog:${item.catalog_book_id}`
    : `uploaded:${item.id}`;
}

interface TagState {
  /** Status (enum) tags per book. Map from "catalog:{id}" or
   *  "uploaded:{id}" to array of status tags. */
  bookTags: Map<string, BookStatusTag[]>;
  /** Free-text user-defined tags per book. Same key shape. */
  customTagsByBook: Map<string, string[]>;
  isLoading: boolean;

  /** Loads both status tags and custom tags in parallel. */
  fetchUserTags: () => Promise<void>;
  addTag: (item: UnifiedLibraryItem, tag: BookStatusTag) => Promise<void>;
  removeTag: (item: UnifiedLibraryItem, tag: BookStatusTag) => Promise<void>;
  getTagsForBook: (item: UnifiedLibraryItem) => BookStatusTag[];

  addCustomTag: (item: UnifiedLibraryItem, label: string) => Promise<void>;
  removeCustomTag: (item: UnifiedLibraryItem, label: string) => Promise<void>;
  getCustomTagsForBook: (item: UnifiedLibraryItem) => string[];
}

export const useTagStore = create<TagState>((set, get) => ({
  bookTags: new Map(),
  customTagsByBook: new Map(),
  isLoading: false,

  fetchUserTags: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    set({ isLoading: true });

    const [statusRes, customRes] = await Promise.all([
      supabase.from("user_book_tags").select("*").eq("user_id", user.id),
      supabase
        .from("user_book_custom_tags")
        .select("*")
        .eq("user_id", user.id),
    ]);

    if (statusRes.error) {
      logError("tag-store:fetchUserTags", statusRes.error.message);
    }
    if (customRes.error) {
      logError("tag-store:fetchUserCustomTags", customRes.error.message);
    }

    const statusMap = new Map<string, BookStatusTag[]>();
    for (const row of statusRes.data ?? []) {
      const key = row.catalog_book_id
        ? `catalog:${row.catalog_book_id}`
        : `uploaded:${row.book_id}`;
      const existing = statusMap.get(key) ?? [];
      existing.push(row.tag as BookStatusTag);
      statusMap.set(key, existing);
    }

    const customMap = new Map<string, string[]>();
    for (const row of customRes.data ?? []) {
      const key = row.catalog_book_id
        ? `catalog:${row.catalog_book_id}`
        : `uploaded:${row.book_id}`;
      const existing = customMap.get(key) ?? [];
      existing.push(row.label);
      customMap.set(key, existing);
    }

    set({
      bookTags: statusMap,
      customTagsByBook: customMap,
      isLoading: false,
    });
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
    return get().bookTags.get(bookKey(item)) ?? EMPTY_STATUS_TAGS;
  },

  addCustomTag: async (item, label) => {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > CUSTOM_TAG_MAX_LENGTH) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const key = bookKey(item);
    // Local de-dup mirrors the unique constraint, avoid a redundant
    // round-trip + the resulting 23505 error toast.
    const existing = get().customTagsByBook.get(key) ?? [];
    if (existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }

    const isCatalog = item.source === "catalog";
    const { error } = await supabase.from("user_book_custom_tags").insert({
      user_id: user.id,
      catalog_book_id: isCatalog ? item.catalog_book_id : null,
      book_id: isCatalog ? null : item.id,
      label: trimmed,
    });

    if (error) {
      logError("tag-store:addCustomTag", error.message);
      throw error;
    }

    set((state) => {
      const next = new Map(state.customTagsByBook);
      next.set(key, [...existing, trimmed]);
      return { customTagsByBook: next };
    });
  },

  removeCustomTag: async (item, label) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const isCatalog = item.source === "catalog";

    let query = supabase
      .from("user_book_custom_tags")
      .delete()
      .eq("user_id", user.id)
      .eq("label", label);

    if (isCatalog) {
      query = query.eq("catalog_book_id", item.catalog_book_id);
    } else {
      query = query.eq("book_id", item.id);
    }

    const { error } = await query;

    if (error) {
      logError("tag-store:removeCustomTag", error.message);
      throw error;
    }

    const key = bookKey(item);
    set((state) => {
      const next = new Map(state.customTagsByBook);
      const existing = next.get(key) ?? [];
      next.set(
        key,
        existing.filter((t) => t !== label),
      );
      return { customTagsByBook: next };
    });
  },

  getCustomTagsForBook: (item) => {
    return get().customTagsByBook.get(bookKey(item)) ?? EMPTY_CUSTOM_TAGS;
  },
}));
