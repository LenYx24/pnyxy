import { create } from "zustand";
import {
  loadAllNotes,
  saveNote as dbSaveNote,
  deleteNote as dbDeleteNote,
  type StoredNote,
} from "@/lib/annotation-storage";

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
  },

  deleteNote(id) {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    dbDeleteNote(id);
  },

  getNote(id) {
    return get().notes.find((n) => n.id === id);
  },
}));
