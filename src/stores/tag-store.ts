import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { BookStatusTag } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";
import { useSettingsStore } from "@/stores/settings-store";

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

  /** Every distinct custom label: on any book, or created in Settings. */
  getAllCustomLabels: () => string[];
  /** Rename a label on every book that has it (plus its color / library entry). */
  renameCustomTagEverywhere: (from: string, to: string) => Promise<void>;
  /** Remove a label from every book, its color and the library entry. */
  deleteCustomTagEverywhere: (label: string) => Promise<void>;
}

/** "catalog:{id}" / "uploaded:{id}" back to the insert columns. */
function keyToRefs(key: string): {
  catalog_book_id: string | null;
  book_id: string | null;
} {
  const [kind, id] = key.split(":");
  return kind === "catalog"
    ? { catalog_book_id: id, book_id: null }
    : { catalog_book_id: null, book_id: id };
}

function sortLabels(labels: Iterable<string>): string[] {
  return Array.from(new Set(labels)).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
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

  getAllCustomLabels: () => {
    const labels: string[] = [...useSettingsStore.getState().customTagLibrary];
    for (const list of get().customTagsByBook.values()) labels.push(...list);
    return sortLabels(labels);
  },

  renameCustomTagEverywhere: async (from, to) => {
    const next = to.trim();
    if (!next || next.length > CUSTOM_TAG_MAX_LENGTH || next === from) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Which books carry the old label. The table has no UPDATE policy,
    // so a rename is delete + re-insert per book.
    const affected: string[] = [];
    for (const [key, list] of get().customTagsByBook) {
      if (list.includes(from)) affected.push(key);
    }

    if (affected.length > 0) {
      const { error: delError } = await supabase
        .from("user_book_custom_tags")
        .delete()
        .eq("user_id", user.id)
        .eq("label", from);
      if (delError) {
        logError("tag-store:renameCustomTag:delete", delError.message);
        throw delError;
      }
      // skip books that already have the target label (unique constraint)
      const rows = affected
        .filter((key) => {
          const list = get().customTagsByBook.get(key) ?? [];
          return !list.some(
            (l) => l !== from && l.toLowerCase() === next.toLowerCase(),
          );
        })
        .map((key) => ({ user_id: user.id, ...keyToRefs(key), label: next }));
      if (rows.length > 0) {
        const { error: insError } = await supabase
          .from("user_book_custom_tags")
          .insert(rows);
        if (insError) {
          logError("tag-store:renameCustomTag:insert", insError.message);
          throw insError;
        }
      }
    }

    set((state) => {
      const map = new Map(state.customTagsByBook);
      for (const key of affected) {
        const list = map.get(key) ?? [];
        const without = list.filter((l) => l !== from);
        const hasTarget = without.some(
          (l) => l.toLowerCase() === next.toLowerCase(),
        );
        map.set(key, hasTarget ? without : [...without, next]);
      }
      return { customTagsByBook: map };
    });

    const settings = useSettingsStore.getState();
    const color = settings.customTagColors[from];
    if (color) {
      settings.setCustomTagColor(from, undefined);
      settings.setCustomTagColor(next, color);
    }
    settings.setCustomTagLibrary(
      sortLabels(settings.customTagLibrary.map((l) => (l === from ? next : l))),
    );
  },

  deleteCustomTagEverywhere: async (label) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("user_book_custom_tags")
      .delete()
      .eq("user_id", user.id)
      .eq("label", label);
    if (error) {
      logError("tag-store:deleteCustomTagEverywhere", error.message);
      throw error;
    }

    set((state) => {
      const map = new Map(state.customTagsByBook);
      for (const [key, list] of map) {
        if (list.includes(label)) map.set(key, list.filter((l) => l !== label));
      }
      return { customTagsByBook: map };
    });

    const settings = useSettingsStore.getState();
    settings.setCustomTagColor(label, undefined);
    settings.setCustomTagLibrary(
      settings.customTagLibrary.filter((l) => l !== label),
    );
  },
}));
