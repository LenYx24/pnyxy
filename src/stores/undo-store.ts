import { create } from "zustand";
import type { Highlight, Comment, HighlightColor } from "@/types/annotation";

const MAX_UNDO_STACK = 50;

export type UndoAction =
  | { type: "add-highlight"; highlight: Highlight }
  | { type: "remove-highlight"; highlight: Highlight }
  | { type: "change-highlight-color"; id: string; prevColor: HighlightColor; newColor: HighlightColor }
  | { type: "add-comment"; comment: Comment }
  | { type: "remove-comment"; comment: Comment };

// Deferred reference to avoid circular import issues at module evaluation time.
// Set by annotation-store when it initializes.
let _getAnnotationStore: (() => {
  _undoRemoveHighlight: (id: string) => void;
  _undoRestoreHighlight: (h: Highlight) => void;
  _undoUpdateHighlightColor: (id: string, color: HighlightColor) => void;
  _undoRemoveComment: (id: string) => void;
  _undoRestoreComment: (c: Comment) => void;
}) | null = null;

export function registerAnnotationStore(getter: NonNullable<typeof _getAnnotationStore>) {
  _getAnnotationStore = getter;
}

interface UndoState {
  stack: UndoAction[];
  pushAction: (action: UndoAction) => void;
  performUndo: () => void;
  clear: () => void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],

  pushAction(action) {
    set((s) => ({
      stack: [...s.stack.slice(-(MAX_UNDO_STACK - 1)), action],
    }));
  },

  performUndo() {
    const { stack } = get();
    if (stack.length === 0 || !_getAnnotationStore) return;

    const action = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });

    const store = _getAnnotationStore();

    switch (action.type) {
      case "add-highlight":
        store._undoRemoveHighlight(action.highlight.id);
        break;
      case "remove-highlight":
        store._undoRestoreHighlight(action.highlight);
        break;
      case "change-highlight-color":
        store._undoUpdateHighlightColor(action.id, action.prevColor);
        break;
      case "add-comment":
        store._undoRemoveComment(action.comment.id);
        break;
      case "remove-comment":
        store._undoRestoreComment(action.comment);
        break;
    }
  },

  clear() {
    set({ stack: [] });
  },
}));
