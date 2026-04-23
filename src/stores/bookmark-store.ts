import { create } from "zustand";
import {
  loadBookmarks,
  saveBookmark,
  deleteBookmark as dbDeleteBookmark,
  type StoredBookmark,
} from "@/lib/annotation-storage";

export const BOOKMARK_COLORS = [
  "#facc15", // yellow
  "#4ade80", // green
  "#60a5fa", // blue
  "#f472b6", // pink
  "#fb923c", // orange
  "#a78bfa", // purple
] as const;

export type Bookmark = StoredBookmark;

interface BookmarkState {
  /** Bookmarks for the currently-loaded document. */
  bookmarks: Map<string, Bookmark>;
  documentId: string | null;

  loadForDocument: (documentId: string) => Promise<void>;
  clear: () => void;
  addBookmark: (page: number, label?: string, color?: string) => Promise<Bookmark | null>;
  updateBookmark: (
    id: string,
    patch: Partial<Pick<Bookmark, "label" | "color" | "page">>,
  ) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: new Map(),
  documentId: null,

  async loadForDocument(documentId) {
    const list = await loadBookmarks(documentId);
    set({
      documentId,
      bookmarks: new Map(list.map((b) => [b.id, b])),
    });
  },

  clear() {
    set({ bookmarks: new Map(), documentId: null });
  },

  async addBookmark(page, label = "", color = BOOKMARK_COLORS[0]) {
    const { documentId, bookmarks } = get();
    if (!documentId) return null;
    const bm: Bookmark = {
      id: crypto.randomUUID(),
      documentId,
      page,
      label: label.trim(),
      color,
      createdAt: Date.now(),
    };
    const next = new Map(bookmarks);
    next.set(bm.id, bm);
    set({ bookmarks: next });
    await saveBookmark(bm);
    return bm;
  },

  async updateBookmark(id, patch) {
    const { bookmarks } = get();
    const existing = bookmarks.get(id);
    if (!existing) return;
    const updated: Bookmark = {
      ...existing,
      ...patch,
      label: patch.label !== undefined ? patch.label.trim() : existing.label,
    };
    const next = new Map(bookmarks);
    next.set(id, updated);
    set({ bookmarks: next });
    await saveBookmark(updated);
  },

  async removeBookmark(id) {
    const { bookmarks } = get();
    if (!bookmarks.has(id)) return;
    const next = new Map(bookmarks);
    next.delete(id);
    set({ bookmarks: next });
    await dbDeleteBookmark(id);
  },
}));
