import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import { prefetchImages } from "@/lib/image-prefetch";
import {
  loadAllFolders,
  saveFolderLocal,
  deleteFolderLocal,
  replaceAllFoldersLocal,
} from "@/lib/annotation-storage";
import { enqueueMutation } from "@/lib/sync/sync-queue";
import type {
  BookSyncPayload,
  FolderSyncPayload,
} from "@/lib/sync/sync-entity-handlers";
import { useTagStore } from "./tag-store";
import { useOrgStore } from "./org-store";
import { useNetworkStore } from "./network-store";
import {
  writeBookCounts,
  ROOT_FOLDER_KEY,
} from "@/features/library/bookCountCache";
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
  /** doc_ids with a saved reading position; drives the "Reading" pill. */
  inProgressDocIds: Set<string>;
  /** Last successful fetch time per resource, for the freshness skip. */
  lastFetchedAt: {
    books: number | null;
    folders: number | null;
    inProgress: number | null;
  };

  fetchLibrary: (force?: boolean) => Promise<void>;
  fetchFolders: (force?: boolean) => Promise<void>;
  fetchInProgress: (force?: boolean) => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<Folder | null>;
  /** Creates any missing ancestors in a slash-separated path, returns the deepest folder. */
  createFolderPath: (path: string, parentId: string | null) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  navigateToFolder: (id: string | null) => void;
  moveBookToFolder: (entry: UnifiedLibraryItem, folderId: string | null) => Promise<void>;
  moveFolderToFolder: (folderId: string, newParentId: string | null) => Promise<void>;
  /** Rename an uploaded book (catalog titles aren't editable). Throws on empty/long/profane. */
  renameBook: (entry: UploadedLibraryItem, title: string) => Promise<void>;
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

// Skip a refetch if the last one was this recent. Refresh button passes force=true.
const FRESH_FETCH_MS = 60_000;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  folders: [],
  isLoading: false,
  currentFolderId: null,
  folderPath: [],
  inProgressDocIds: new Set<string>(),
  lastFetchedAt: { books: null, folders: null, inProgress: null },

  fetchInProgress: async (force = false) => {
    const last = get().lastFetchedAt.inProgress;
    if (!force && last !== null && Date.now() - last < FRESH_FETCH_MS) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ inProgressDocIds: new Set() });
      return;
    }
    const { data, error } = await supabase
      .from("book_resume_state")
      .select("doc_id")
      .eq("user_id", user.id);
    if (error) {
      logError("library-store:fetchInProgress", error.message);
      return;
    }
    const ids = new Set<string>(
      (data ?? []).map((r) => r.doc_id as string),
    );
    set({
      inProgressDocIds: ids,
      lastFetchedAt: { ...get().lastFetchedAt, inProgress: Date.now() },
    });
  },

  fetchLibrary: async (force = false) => {
    const last = get().lastFetchedAt.books;
    if (!force && last !== null && Date.now() - last < FRESH_FETCH_MS) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // no active org: show empty rather than another org's contents (org-store sub retriggers once set)
    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      set({ books: [], isLoading: false });
      return;
    }

    set({ isLoading: true });

    const [catalogRes, uploadedRes] = await Promise.all([
      supabase
        .from("user_library")
        .select("id, catalog_book_id, folder_id, added_at, catalog_book:catalog_books(*)")
        .eq("user_id", user.id)
        .eq("org_id", orgId)
        .order("added_at", { ascending: false }),
      supabase
        .from("books")
        .select("id, title, authors, author, cover_url, page_count, format, file_hash, folder_id, created_at, metadata, book_files(storage_path, file_name, size_bytes)")
        .eq("user_id", user.id)
        .eq("org_id", orgId)
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
      // keep books with a file plus manual_entry shells; file check hides mid-upload rows
      .filter(
        (row) =>
          (row.book_files && row.book_files.length > 0) ||
          row.metadata?.manual_entry === true,
      )
      .map((row) => {
        const file = row.book_files?.[0];
        return {
          source: "uploaded" as const,
          id: row.id,
          folder_id: row.folder_id,
          added_at: row.created_at,
          book: {
            id: row.id,
            title: row.title,
            authors: row.authors ?? [],
            author: row.author,
            cover_url: row.cover_url,
            page_count: row.page_count,
            format: row.format,
            file_hash: row.file_hash,
            storage_path: file?.storage_path ?? null,
            size_bytes: file?.size_bytes ?? null,
            file_name: file?.file_name ?? null,
          },
        };
      });

    const all: UnifiedLibraryItem[] = [...catalogItems, ...uploadedItems].sort(
      (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
    );

    set({
      books: all,
      isLoading: false,
      lastFetchedAt: { ...get().lastFetchedAt, books: Date.now() },
    });

    // per-folder counts so the next mount sizes skeletons right
    const byFolder: Record<string, number> = {};
    for (const entry of all) {
      const k = entry.folder_id ?? ROOT_FOLDER_KEY;
      byFolder[k] = (byFolder[k] ?? 0) + 1;
    }
    writeBookCounts(orgId, { total: all.length, byFolder });

    // warm the HTTP cache for recent covers (helper caps at 16)
    prefetchImages(
      all.map((entry) =>
        entry.source === "catalog"
          ? entry.catalog_book.cover_url
          : entry.book.cover_url,
      ),
    );

    useTagStore.getState().fetchUserTags();
  },

  fetchFolders: async (force = false) => {
    const last = get().lastFetchedAt.folders;
    if (!force && last !== null && Date.now() - last < FRESH_FETCH_MS) return;

    // hydrate from IDB so the tree paints before the network resolves
    if (get().folders.length === 0) {
      try {
        const local = await loadAllFolders<Folder>();
        if (local.length > 0) {
          const { currentFolderId } = get();
          set({
            folders: local,
            folderPath: buildFolderPath(local, currentFolderId),
          });
        }
      } catch (err) {
        // IDB unavailable (private mode, quota), fall through to network
        logError("library-store:fetchFolders:hydrate", err);
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // offline: trust IDB hydration, sync refreshes later
    if (!useNetworkStore.getState().online()) return;

    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      set({ folders: [], currentFolderId: null, folderPath: [] });
      void replaceAllFoldersLocal<Folder>([]);
      return;
    }

    const { data, error } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .order("sort_order");

    if (error) {
      logError("library-store:fetchFolders", error.message);
      return;
    }

    const folders = (data ?? []) as Folder[];
    const { currentFolderId } = get();

    // refresh IDB mirror so next cold start isn't stale optimistic edits
    void replaceAllFoldersLocal(folders);

    // If current folder was deleted, reset to root
    const lastFetchedAt = { ...get().lastFetchedAt, folders: Date.now() };
    if (currentFolderId && !folders.find((f) => f.id === currentFolderId)) {
      set({ folders, currentFolderId: null, folderPath: [], lastFetchedAt });
    } else {
      set({
        folders,
        folderPath: buildFolderPath(folders, currentFolderId),
        lastFetchedAt,
      });
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

    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      throw new Error("No active organization. Pick one from the sidebar.");
    }

    // client-side UUID so the id round-trips the sync queue for offline rename/move/delete
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const folder: Folder = {
      id,
      user_id: user.id,
      parent_id: parentId,
      name,
      color: null,
      sort_order: 0,
      created_at: now,
      updated_at: now,
    };

    set((s) => ({
      folders: [...s.folders, folder],
      folderPath: buildFolderPath(
        [...s.folders, folder],
        s.currentFolderId,
      ),
    }));
    void saveFolderLocal(folder);
    void enqueueMutation<FolderSyncPayload>("folder", "insert", {
      id,
      name,
      parent_id: parentId,
      org_id: orgId,
      sort_order: 0,
    });
    return folder;
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
      // reuse an existing same-name sibling instead of duplicating
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
    // optimistic: update state + IDB, queue the patch
    const updatedAt = new Date().toISOString();
    const nextFolders = get().folders.map((f) =>
      f.id === id ? { ...f, name, updated_at: updatedAt } : f,
    );
    set({
      folders: nextFolders,
      folderPath: buildFolderPath(nextFolders, get().currentFolderId),
    });
    const updated = nextFolders.find((f) => f.id === id);
    if (updated) void saveFolderLocal(updated);
    void enqueueMutation<FolderSyncPayload>("folder", "update", { id, name });
  },

  deleteFolder: async (id) => {
    // optimistic delete. server CASCADE clears folder_id on contained books, so refetch once online
    const nextFolders = get().folders.filter((f) => f.id !== id);
    const currentFolderId =
      get().currentFolderId === id ? null : get().currentFolderId;
    set({
      folders: nextFolders,
      currentFolderId,
      folderPath: buildFolderPath(nextFolders, currentFolderId),
    });
    void deleteFolderLocal(id);
    void enqueueMutation<FolderSyncPayload>("folder", "delete", { id });
    // refresh in case books moved to root; gated on online to avoid error logs
    if (useNetworkStore.getState().online()) {
      void get().fetchLibrary(true);
    }
  },

  navigateToFolder: (id) => {
    const { folders } = get();
    set({
      currentFolderId: id,
      folderPath: buildFolderPath(folders, id),
    });
  },

  moveBookToFolder: async (entry, folderId) => {
    // optimistic: patch local state, queue the mutation
    set((state) => ({
      books: state.books.map((b) =>
        b.id === entry.id && b.source === entry.source
          ? { ...b, folder_id: folderId }
          : b,
      ),
    }));
    void enqueueMutation<BookSyncPayload>("book", "update", {
      id: entry.id,
      source: entry.source,
      folder_id: folderId,
    });
  },

  renameBook: async (entry, title) => {
    // strip control chars and collapse whitespace
    const sanitized = title
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (sanitized.length === 0) {
      throw new Error("Title cannot be empty.");
    }
    if (sanitized.length > 200) {
      throw new Error("Title is too long (max 200 characters).");
    }
    if (containsProfanity(sanitized)) {
      throw new Error(
        "Title contains disallowed language. Please choose another.",
      );
    }
    set((state) => ({
      books: state.books.map((b) =>
        b.source === "uploaded" && b.id === entry.id
          ? { ...b, book: { ...b.book, title: sanitized } }
          : b,
      ),
    }));
    void enqueueMutation<BookSyncPayload>("book", "update", {
      id: entry.id,
      source: "uploaded",
      title: sanitized,
    });
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

    // optimistic: patch state + IDB, queue the parent_id update
    const updatedAt = new Date().toISOString();
    const nextFolders = get().folders.map((f) =>
      f.id === folderId
        ? { ...f, parent_id: newParentId, updated_at: updatedAt }
        : f,
    );
    set({
      folders: nextFolders,
      folderPath: buildFolderPath(nextFolders, get().currentFolderId),
    });
    const moved = nextFolders.find((f) => f.id === folderId);
    if (moved) void saveFolderLocal(moved);
    void enqueueMutation<FolderSyncPayload>("folder", "update", {
      id: folderId,
      parent_id: newParentId,
    });
  },

  removeFromLibrary: async (entry) => {
    // optimistic delete. for uploaded books pass storage_path so the worker removes the file
    set((state) => ({
      books: state.books.filter(
        (b) => !(b.id === entry.id && b.source === entry.source),
      ),
    }));
    void enqueueMutation<BookSyncPayload>("book", "delete", {
      id: entry.id,
      source: entry.source,
      storage_path:
        entry.source === "uploaded"
          ? (entry.book.storage_path ?? undefined)
          : undefined,
    });
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

// Refetch on org change; a null org clears state so contents don't leak.
useOrgStore.subscribe((state, prev) => {
  if (state.currentOrgId === prev.currentOrgId) return;
  if (state.currentOrgId) {
    // real invalidation: force all three refetches or the old org's books/pills linger 60s
    void useLibraryStore.getState().fetchLibrary(true);
    void useLibraryStore.getState().fetchFolders(true);
    void useLibraryStore.getState().fetchInProgress(true);
  } else {
    useLibraryStore.setState({
      books: [],
      folders: [],
      inProgressDocIds: new Set(),
      currentFolderId: null,
      folderPath: [],
      lastFetchedAt: { books: null, folders: null, inProgress: null },
    });
  }
});
