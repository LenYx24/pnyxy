import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import { useTagStore } from "./tag-store";
import type {
  UnifiedLibraryItem,
  CatalogLibraryItem,
  UploadedLibraryItem,
} from "@/types/catalog";
import type { Folder } from "@/types/database";

interface LibraryState {
  books: UnifiedLibraryItem[];
  folders: Folder[];
  isLoading: boolean;
  currentFolderId: string | null;
  folderPath: Folder[];

  fetchLibrary: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<Folder | null>;
  /** Accepts a slash-separated path like "p1/p2/p3" and creates any
   * missing ancestors, returning the deepest (last) folder. */
  createFolderPath: (path: string, parentId: string | null) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  navigateToFolder: (id: string | null) => void;
  moveBookToFolder: (entry: UnifiedLibraryItem, folderId: string | null) => Promise<void>;
  moveFolderToFolder: (folderId: string, newParentId: string | null) => Promise<void>;
  removeFromLibrary: (entry: UnifiedLibraryItem) => Promise<void>;
  getBooksInFolder: (folderId: string | null) => UnifiedLibraryItem[];
  getSubfolders: (parentId: string | null) => Folder[];
  getRecentBooks: (limit: number) => UnifiedLibraryItem[];
}

function buildFolderPath(folders: Folder[], targetId: string | null): Folder[] {
  if (!targetId) return [];
  const path: Folder[] = [];
  let current = folders.find((f) => f.id === targetId);
  while (current) {
    path.unshift(current);
    current = current.parent_id
      ? folders.find((f) => f.id === current!.parent_id)
      : undefined;
  }
  return path;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  folders: [],
  isLoading: false,
  currentFolderId: null,
  folderPath: [],

  fetchLibrary: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    set({ isLoading: true });

    // Fetch catalog books and uploaded books in parallel
    const [catalogRes, uploadedRes] = await Promise.all([
      supabase
        .from("user_library")
        .select("id, catalog_book_id, folder_id, added_at, catalog_book:catalog_books(*)")
        .eq("user_id", user.id)
        .order("added_at", { ascending: false }),
      supabase
        .from("books")
        .select("id, title, author, cover_url, page_count, format, file_hash, folder_id, created_at, book_files(storage_path, file_name, size_bytes)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);

    if (catalogRes.error) {
      logError("library-store:fetchLibrary:catalog", catalogRes.error.message);
    }
    if (uploadedRes.error) {
      logError("library-store:fetchLibrary:uploaded", uploadedRes.error.message);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase join response is dynamically shaped
    const catalogItems: CatalogLibraryItem[] = ((catalogRes.data ?? []) as any[]).map(
      (row) => ({
        source: "catalog" as const,
        id: row.id,
        folder_id: row.folder_id,
        added_at: row.added_at,
        catalog_book_id: row.catalog_book_id,
        catalog_book: row.catalog_book,
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase join response is dynamically shaped
    const uploadedItems: UploadedLibraryItem[] = ((uploadedRes.data ?? []) as any[])
      .filter((row) => row.book_files && row.book_files.length > 0)
      .map((row) => {
        const file = row.book_files[0];
        return {
          source: "uploaded" as const,
          id: row.id,
          folder_id: row.folder_id,
          added_at: row.created_at,
          book: {
            id: row.id,
            title: row.title,
            author: row.author,
            cover_url: row.cover_url,
            page_count: row.page_count,
            format: row.format,
            file_hash: row.file_hash,
            storage_path: file.storage_path,
            size_bytes: file.size_bytes,
            file_name: file.file_name,
          },
        };
      });

    // Merge and sort by date descending
    const all: UnifiedLibraryItem[] = [...catalogItems, ...uploadedItems].sort(
      (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
    );

    set({ books: all, isLoading: false });

    // Fetch user tags alongside library
    useTagStore.getState().fetchUserTags();
  },

  fetchFolders: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", user.id)
      .order("sort_order");

    if (error) {
      logError("library-store:fetchFolders", error.message);
      return;
    }

    const folders = (data ?? []) as Folder[];
    const { currentFolderId } = get();

    // If current folder was deleted, reset to root
    if (currentFolderId && !folders.find((f) => f.id === currentFolderId)) {
      set({ folders, currentFolderId: null, folderPath: [] });
    } else {
      set({ folders, folderPath: buildFolderPath(folders, currentFolderId) });
    }
  },

  createFolder: async (name, parentId) => {
    if (containsProfanity(name)) {
      throw new Error(
        "Folder name contains disallowed language. Please choose another.",
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("folders")
      .insert({
        user_id: user.id,
        name,
        parent_id: parentId,
        sort_order: 0,
      })
      .select()
      .single<Folder>();

    if (error) {
      logError("library-store:createFolder", error.message);
      throw error;
    }

    await get().fetchFolders();
    return data;
  },

  createFolderPath: async (path, parentId) => {
    const parts = path
      .split("/")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length === 0) {
      throw new Error("Folder name cannot be empty.");
    }

    let currentParent: string | null = parentId;
    let last: Folder | null = null;

    for (const part of parts) {
      // Reuse an existing sibling folder with the same name rather
      // than creating a duplicate. get().folders is kept fresh by
      // createFolder's internal fetchFolders() call on every insert.
      const existing = get().folders.find(
        (f) => f.parent_id === currentParent && f.name === part,
      );
      if (existing) {
        currentParent = existing.id;
        last = existing;
        continue;
      }
      const created = await get().createFolder(part, currentParent);
      if (!created) throw new Error(`Failed to create folder "${part}".`);
      currentParent = created.id;
      last = created;
    }

    return last;
  },

  renameFolder: async (id, name) => {
    if (containsProfanity(name)) {
      throw new Error(
        "Folder name contains disallowed language. Please choose another.",
      );
    }

    const { error } = await supabase
      .from("folders")
      .update({ name })
      .eq("id", id);

    if (error) {
      logError("library-store:renameFolder", error.message);
      throw error;
    }

    await get().fetchFolders();
  },

  deleteFolder: async (id) => {
    const { error } = await supabase.from("folders").delete().eq("id", id);

    if (error) {
      logError("library-store:deleteFolder", error.message);
      throw error;
    }

    // Refetch both — books may have moved to root
    await Promise.all([get().fetchFolders(), get().fetchLibrary()]);
  },

  navigateToFolder: (id) => {
    const { folders } = get();
    set({
      currentFolderId: id,
      folderPath: buildFolderPath(folders, id),
    });
  },

  moveBookToFolder: async (entry, folderId) => {
    if (entry.source === "catalog") {
      const { error } = await supabase
        .from("user_library")
        .update({ folder_id: folderId })
        .eq("id", entry.id);

      if (error) {
        logError("library-store:moveBookToFolder", error.message);
        throw error;
      }
    } else {
      const { error } = await supabase
        .from("books")
        .update({ folder_id: folderId })
        .eq("id", entry.id);

      if (error) {
        logError("library-store:moveBookToFolder", error.message);
        throw error;
      }
    }

    set((state) => ({
      books: state.books.map((b) =>
        b.id === entry.id && b.source === entry.source
          ? { ...b, folder_id: folderId }
          : b,
      ),
    }));
  },

  moveFolderToFolder: async (folderId, newParentId) => {
    // Prevent moving a folder into itself or its own descendants
    const { folders } = get();
    const isDescendant = (parentId: string | null, targetId: string): boolean => {
      if (parentId === targetId) return true;
      const parent = folders.find((f) => f.id === parentId);
      return parent?.parent_id ? isDescendant(parent.parent_id, targetId) : false;
    };

    if (newParentId && (newParentId === folderId || isDescendant(newParentId, folderId))) {
      return;
    }

    const { error } = await supabase
      .from("folders")
      .update({ parent_id: newParentId })
      .eq("id", folderId);

    if (error) {
      logError("library-store:moveFolderToFolder", error.message);
      throw error;
    }

    await get().fetchFolders();
  },

  removeFromLibrary: async (entry) => {
    if (entry.source === "catalog") {
      const { error } = await supabase
        .from("user_library")
        .delete()
        .eq("id", entry.id);

      if (error) {
        logError("library-store:removeFromLibrary", error.message);
        throw error;
      }
    } else {
      // For uploaded books: delete storage file, then delete books row (cascades book_files)
      await supabase.storage
        .from("book-files")
        .remove([entry.book.storage_path]);

      const { error } = await supabase
        .from("books")
        .delete()
        .eq("id", entry.id);

      if (error) {
        logError("library-store:removeFromLibrary:delete", error.message);
        throw error;
      }
    }

    set((state) => ({
      books: state.books.filter(
        (b) => !(b.id === entry.id && b.source === entry.source),
      ),
    }));
  },

  getBooksInFolder: (folderId) => {
    return get().books.filter((b) => b.folder_id === folderId);
  },

  getSubfolders: (parentId) => {
    return get().folders.filter((f) => f.parent_id === parentId);
  },

  getRecentBooks: (limit) => {
    return get().books.slice(0, limit);
  },
}));
