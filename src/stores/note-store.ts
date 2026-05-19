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
  createdAt: number;
  updatedAt: number;
}

interface NoteState {
  notes: Note[];
  loadNotes: () => Promise<void>;
  createNote: () => string;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "content">>) => void;
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
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    set({ notes });
  },

  createNote() {
    const note: Note = {
      id: crypto.randomUUID(),
      title: "",
      content: "",
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
    void enqueueMutation<NoteSyncPayload>("note", "update", {
      id: updated.id,
      title: updated.title,
      content: updated.content,
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
