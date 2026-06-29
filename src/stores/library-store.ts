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
  /** Set of doc_ids the user has any saved reading position for —
   *  used to render a "Reading" pill on the matching library cards
   *  so currently-active books pop visually. Populated by
   *  fetchInProgress(). Starts empty so signed-out / pre-fetch
   *  states render no pill rather than wrong pills. */
  inProgressDocIds: Set<string>;
  /** Timestamps of the last successful fetch per resource. Used by
   *  fetchLibrary/fetchFolders to skip a refetch when the user is
   *  just bouncing between pages (e.g., /home → /library → /home).
   *  Force=true on the refresh button bypasses the check. */
  lastFetchedAt: {
    books: number | null;
    folders: number | null;
    inProgress: number | null;
  };

  fetchLibrary: (force?: boolean) => Promise<void>;
  fetchFolders: (force?: boolean) => Promise<void>;
  fetchInProgress: (force?: boolean) => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<Folder | null>;
  /** Accepts a slash-separated path like "p1/p2/p3" and creates any
   * missing ancestors, returning the deepest (last) folder. */
  createFolderPath: (path: string, parentId: string | null) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  navigateToFolder: (id: string | null) => void;
  moveBookToFolder: (entry: UnifiedLibraryItem, folderId: string | null) => Promise<void>;
  moveFolderToFolder: (folderId: string, newParentId: string | null) => Promise<void>;
  /** Rename an uploaded book. Catalog titles aren't user-editable
   *  (they live on the shared catalog_books row). Throws on empty,
   *  too-long, or profane titles so callers can surface a toast. */
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

// How long a successful fetch is considered "fresh enough" that a
// remount-triggered refetch is skipped. 60s is short enough that
// real changes (uploads, deletes, folder edits, signing in/out) get
// surfaced quickly, long enough that bouncing between pages doesn't
// hit the server every time. The toolbar Refresh button always
// passes force=true to bypass this.
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

    // No active org yet (e.g. orgs still hydrating after sign-in)
    // — the org-store subscription below will retrigger this fetch
    // as soon as currentOrgId becomes a real id, so just present an
    // empty library in the meantime instead of leaking another
    // org's contents.
    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      set({ books: [], isLoading: false });
      return;
    }

    set({ isLoading: true });

    // Fetch catalog books and uploaded books in parallel
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
      // Keep books that have a file, plus manually-added "shell" books
      // (metadata.manual_entry) which intentionally have no book_files
      // row. The file check still filters out books mid-upload (the
      // books row is inserted before its book_files row), so half-
      // uploaded books don't flash into the grid.
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

    // Merge and sort by date descending
    const all: UnifiedLibraryItem[] = [...catalogItems, ...uploadedItems].sort(
      (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
    );

    set({
      books: all,
      isLoading: false,
      lastFetchedAt: { ...get().lastFetchedAt, books: Date.now() },
    });

    // Snapshot per-folder counts to localStorage so the next mount
    // can paint skeleton cards at the right count before this fetch
    // resolves. Best-effort — failures here just degrade the next
    // load back to a generic skeleton row.
    const byFolder: Record<string, number> = {};
    for (const entry of all) {
      const k = entry.folder_id ?? ROOT_FOLDER_KEY;
      byFolder[k] = (byFolder[k] ?? 0) + 1;
    }
    writeBookCounts(orgId, { total: all.length, byFolder });

    // Warm the browser HTTP cache for the most-recently-added covers.
    // Same data drives Library + Home's RecentlyAddedShelf, so this
    // one prefetch covers both surfaces. Capped to 16 inside the
    // helper so a 500-book library doesn't fire 500 parallel image
    // requests. Fire-and-forget — Image() is a side-effect-only call.
    prefetchImages(
      all.map((entry) =>
        entry.source === "catalog"
          ? entry.catalog_book.cover_url
          : entry.book.cover_url,
      ),
    );

    // Fetch user tags alongside library
    useTagStore.getState().fetchUserTags();
  },

  fetchFolders: async (force = false) => {
    const last = get().lastFetchedAt.folders;
    if (!force && last !== null && Date.now() - last < FRESH_FETCH_MS) return;

    // Cold-start hydration from IDB — populates the tree
    // immediately even before (or instead of) the network round-
    // trip resolves. Offline-first: the user sees their last-
    // known library structure on app open with zero latency.
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
        // IDB unavailable (private mode, quota, …) — fall through
        // to the network. Don't break library load over a cache miss.
        logError("library-store:fetchFolders:hydrate", err);
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Offline: trust whatever's in state / just hydrated from IDB.
    // The sync orchestrator will drain pending folder mutations
    // when we're back online, and the next fetchFolders call will
    // refresh against the canonical Supabase view.
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

    // Refresh the IDB mirror so the next cold start shows the
    // canonical Supabase view, not stale optimistic edits.
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

    // Optimistic local insert. The UUID is generated client-side so
    // the same id can round-trip through the sync queue's INSERT
    // and any subsequent rename/move/delete the user does while
    // offline. Server enforces uniqueness — if a collision ever
    // happens the queue dead-letters and the UI can show the
    // dropped row.
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
    // Optimistic — update state + IDB mirror, queue the Supabase
    // patch. The user sees the rename land instantly; if it
    // dead-letters server-side, the queue's dead-letter UI will
    // surface it (TODO once that UI lands).
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
    // Optimistic delete from local state + IDB. Books that lived
    // in this folder need their `folder_id` cleared on the
    // Supabase side too — the existing flow relied on a server
    // CASCADE / re-fetch to handle this; here we still refetch
    // the library once online (best-effort), but the user-visible
    // folder is gone immediately.
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
    // Fire-and-forget refresh in case books moved to root. Gated
    // on online so it doesn't error-log when offline; the next
    // online fetch picks up the canonical state anyway.
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
    // Optimistic — same shape as moveFolderToFolder: patch local
    // state first, queue the Supabase mutation for the sync worker.
    // Lets a drag-into-folder land instantly + survive offline, and
    // also stops a failed Supabase call from silently swallowing the
    // user's action behind a `void`-ed handler.
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
    // Sanitize first so a paste with control chars / runs of
    // whitespace can't ship a janky title to Supabase. Mirrors the
    // shape of renameFolder above — same profanity gate, same
    // optimistic-then-queue rhythm.
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

    // Optimistic — same shape as rename: patch local state + IDB,
    // queue the parent_id update for sync.
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
    // Optimistic delete: drop the row locally, queue the Supabase
    // side. For uploaded books we also pass storage_path so the
    // worker removes the underlying file before the books row goes
    // (the storage cleanup is idempotent — safe to retry).
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

// Refetch library + folders whenever the active org changes (e.g. on
// fresh hydration after sign-in, or when the user picks a new org
// from the sidebar). Switching to a null org clears local state so
// the previous org's contents don't leak into a signed-out view.
useOrgStore.subscribe((state, prev) => {
  if (state.currentOrgId === prev.currentOrgId) return;
  if (state.currentOrgId) {
    // Org change is a real data invalidation — bypass the freshness
    // check; otherwise switching to a different workspace within 60s
    // would silently keep showing the previous org's books. The
    // in-progress doc-id set is per-user, but the *visible* set is
    // gated to the books we just fetched, so it has to be refetched
    // in lockstep — otherwise the "Reading" pill keeps showing the
    // previous org's doc ids until the next freshness window.
    void useLibraryStore.getState().fetchLibrary(true);
    void useLibraryStore.getState().fetchFolders(true);
    void useLibraryStore.getState().fetchInProgress(true);
  } else {
    useLibraryStore.setState({
      books: [],
      folders: [],
      // Clear the in-progress set too; an empty books list with a
      // populated id set is harmless today but a stale invariant
      // waiting to fire later.
      inProgressDocIds: new Set(),
      currentFolderId: null,
      folderPath: [],
      lastFetchedAt: { books: null, folders: null, inProgress: null },
    });
  }
});
