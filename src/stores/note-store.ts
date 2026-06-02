import { create } from "zustand";
import {
  loadAllNotes,
  saveNote as dbSaveNote,
  deleteNote as dbDeleteNote,
} from "@/lib/annotation-storage";
import { enqueueMutation } from "@/lib/sync/sync-queue";
import type { NoteSyncPayload } from "@/lib/sync/sync-entity-handlers";

export interface Note {
  id: string;
  title: string;
  content: string;
  /** Library folder the note lives in, or null for the root. Lets
   *  notes appear in the library filetree alongside books + chats. */
  folderId: string | null;
  /** Position within the folder (lower = earlier). Fractional so a
   *  drag-reorder inserts between neighbours without renumbering. */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

interface NoteState {
  notes: Note[];
  loadNotes: () => Promise<void>;
  /** Create a note, optionally placed directly into a folder (used by
   *  the library's "New note here" action). Omit for a root note. */
  createNote: (folderId?: string | null) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "content">>) => void;
  /** Move a note into a folder (or null for root). Optionally pin its
   *  position via `sortOrder` for drag-into-folder-on-sibling drops. */
  moveNoteToFolder: (id: string, folderId: string | null, sortOrder?: number) => void;
  deleteNote: (id: string) => void;
  getNote: (id: string) => Note | undefined;
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],

  async loadNotes() {
    const stored = await loadAllNotes();
    const notes: Note[] = stored.map((s) => ({
      id: s.id,
      title: s.title,
      content: s.content,
      // Pre-00044 rows have no folderId/sortOrder — default to root / 0.
      folderId: s.folderId ?? null,
      sortOrder: s.sortOrder ?? 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    set({ notes });
  },

  createNote(folderId = null) {
    // New notes land at the top of their target folder: strictly below
    // every sibling's sort_order so no renumbering / collision with a
    // concurrent create. Mirrors chat's createConversation.
    const siblingSorts = get()
      .notes.filter((n) => n.folderId === folderId)
      .map((n) => n.sortOrder);
    const sortOrder =
      siblingSorts.length > 0 ? Math.min(...siblingSorts) - 1 : 0;
    const note: Note = {
      id: crypto.randomUUID(),
      title: "",
      content: "",
      folderId,
      sortOrder,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((s) => ({ notes: [note, ...s.notes] }));
    dbSaveNote(note);
    // Push to Supabase via the queue. If offline, the queue holds
    // it; if signed out, the orchestrator's auth gate skips drain
    // until sign-in. Either way the local write is the source of
    // truth and the user sees no latency.
    void enqueueMutation<NoteSyncPayload>("note", "insert", {
      id: note.id,
      title: note.title,
      content: note.content,
      folder_id: note.folderId,
      sort_order: note.sortOrder,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
    return note.id;
  },

  updateNote(id, patch) {
    const { notes } = get();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const updated: Note = {
      ...notes[idx],
      ...patch,
      updatedAt: Date.now(),
    };
    const next = [...notes];
    next[idx] = updated;
    set({ notes: next });
    dbSaveNote(updated);
    // The handler upserts the whole row, so always send every column —
    // omitting folder_id/sort_order here would reset them to defaults.
    void enqueueMutation<NoteSyncPayload>("note", "update", {
      id: updated.id,
      title: updated.title,
      content: updated.content,
      folder_id: updated.folderId,
      sort_order: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  },

  moveNoteToFolder(id, folderId, sortOrder) {
    const { notes } = get();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const current = notes[idx];
    const folderUnchanged = current.folderId === folderId;
    const sortUnchanged =
      sortOrder === undefined || current.sortOrder === sortOrder;
    if (folderUnchanged && sortUnchanged) return;
    const updated: Note = {
      ...current,
      folderId,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      updatedAt: Date.now(),
    };
    const next = [...notes];
    next[idx] = updated;
    set({ notes: next });
    dbSaveNote(updated);
    // Full-row upsert (see updateNote) — send content too so the move
    // doesn't blank the note's title/body on the server.
    void enqueueMutation<NoteSyncPayload>("note", "update", {
      id: updated.id,
      title: updated.title,
      content: updated.content,
      folder_id: updated.folderId,
      sort_order: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  },

  deleteNote(id) {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    dbDeleteNote(id);
    void enqueueMutation<NoteSyncPayload>("note", "delete", { id });
  },

  getNote(id) {
    return get().notes.find((n) => n.id === id);
  },
}));
