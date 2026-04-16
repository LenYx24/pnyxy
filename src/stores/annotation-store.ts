import { create } from "zustand";
import type {
  Highlight,
  Comment,
  HighlightColor,
  TextSelection,
} from "@/types/annotation";
import {
  loadHighlights,
  saveHighlight,
  deleteHighlight as dbDeleteHighlight,
  loadComments,
  saveComment,
  deleteComment as dbDeleteComment,
} from "@/lib/annotation-storage";
import { cleanUserText } from "@/lib/profanity-filter";
import { useUndoStore, registerAnnotationStore } from "@/stores/undo-store";

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  selection: TextSelection | null;
  /** If the context menu was triggered on an existing highlight */
  highlightId: string | null;
}

interface AnnotationState {
  documentId: string | null;
  highlights: Map<string, Highlight>;
  comments: Map<string, Comment>;
  activeHighlightColor: HighlightColor;
  selectedAnnotationId: string | null;
  contextMenu: ContextMenuState;

  loadAnnotations(documentId: string): Promise<void>;
  clearAll(): void;

  addHighlight(selection: TextSelection, color: HighlightColor): void;
  removeHighlight(id: string): void;
  updateHighlightColor(id: string, color: HighlightColor): void;

  addComment(
    selection: TextSelection,
    text: string,
    highlightId?: string,
  ): void;
  addReply(commentId: string, text: string): void;
  resolveComment(commentId: string): void;
  removeComment(id: string): void;

  setActiveHighlightColor(color: HighlightColor): void;
  setSelectedAnnotation(id: string | null): void;
  showContextMenu(
    x: number,
    y: number,
    selection: TextSelection | null,
    highlightId?: string | null,
  ): void;
  hideContextMenu(): void;

  // Internal methods for undo (skip pushing to undo stack)
  _undoRemoveHighlight(id: string): void;
  _undoRestoreHighlight(highlight: Highlight): void;
  _undoUpdateHighlightColor(id: string, color: HighlightColor): void;
  _undoRemoveComment(id: string): void;
  _undoRestoreComment(comment: Comment): void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  documentId: null,
  highlights: new Map(),
  comments: new Map(),
  activeHighlightColor: "yellow",
  selectedAnnotationId: null,
  contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },

  async loadAnnotations(documentId: string) {
    const [highlights, comments] = await Promise.all([
      loadHighlights(documentId),
      loadComments(documentId),
    ]);
    set({
      documentId,
      highlights: new Map(highlights.map((h) => [h.id, h])),
      comments: new Map(comments.map((c) => [c.id, c])),
      selectedAnnotationId: null,
    });
  },

  clearAll() {
    set({
      documentId: null,
      highlights: new Map(),
      comments: new Map(),
      selectedAnnotationId: null,
      contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },
    });
  },

  addHighlight(selection, color) {
    const { documentId, highlights } = get();
    if (!documentId) return;

    const highlight: Highlight = {
      id: crypto.randomUUID(),
      documentId,
      color,
      selection,
      createdAt: Date.now(),
    };

    const next = new Map(highlights);
    next.set(highlight.id, highlight);
    set({
      highlights: next,
      contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },
    });
    saveHighlight(highlight);
    useUndoStore.getState().pushAction({ type: "add-highlight", highlight });
  },

  removeHighlight(id) {
    const { highlights, selectedAnnotationId } = get();
    const highlight = highlights.get(id);
    const next = new Map(highlights);
    next.delete(id);
    set({
      highlights: next,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteHighlight(id);
    if (highlight) {
      useUndoStore.getState().pushAction({ type: "remove-highlight", highlight });
    }
  },

  updateHighlightColor(id, color) {
    const { highlights } = get();
    const h = highlights.get(id);
    if (!h) return;

    const prevColor = h.color;
    const updated = { ...h, color };
    const next = new Map(highlights);
    next.set(id, updated);
    set({ highlights: next });
    saveHighlight(updated);
    useUndoStore.getState().pushAction({
      type: "change-highlight-color",
      id,
      prevColor,
      newColor: color,
    });
  },

  addComment(selection, text, highlightId) {
    const { documentId, comments } = get();
    if (!documentId) return;

    const comment: Comment = {
      id: crypto.randomUUID(),
      documentId,
      selection,
      highlightId,
      messages: [
        {
          id: crypto.randomUUID(),
          text: cleanUserText(text),
          createdAt: Date.now(),
        },
      ],
      resolved: false,
      createdAt: Date.now(),
    };

    const next = new Map(comments);
    next.set(comment.id, comment);
    set({
      comments: next,
      selectedAnnotationId: comment.id,
      contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },
    });
    saveComment(comment);
    useUndoStore.getState().pushAction({ type: "add-comment", comment });
  },

  addReply(commentId, text) {
    const { comments } = get();
    const c = comments.get(commentId);
    if (!c) return;

    const updated: Comment = {
      ...c,
      messages: [
        ...c.messages,
        {
          id: crypto.randomUUID(),
          text: cleanUserText(text),
          createdAt: Date.now(),
        },
      ],
    };

    const next = new Map(comments);
    next.set(commentId, updated);
    set({ comments: next });
    saveComment(updated);
  },

  resolveComment(commentId) {
    const { comments } = get();
    const c = comments.get(commentId);
    if (!c) return;

    const updated = { ...c, resolved: !c.resolved };
    const next = new Map(comments);
    next.set(commentId, updated);
    set({ comments: next });
    saveComment(updated);
  },

  removeComment(id) {
    const { comments, selectedAnnotationId } = get();
    const comment = comments.get(id);
    const next = new Map(comments);
    next.delete(id);
    set({
      comments: next,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteComment(id);
    if (comment) {
      useUndoStore.getState().pushAction({ type: "remove-comment", comment });
    }
  },

  setActiveHighlightColor(color) {
    set({ activeHighlightColor: color });
  },

  setSelectedAnnotation(id) {
    set({ selectedAnnotationId: id });
  },

  showContextMenu(x, y, selection, highlightId) {
    set({
      contextMenu: {
        visible: true,
        x,
        y,
        selection,
        highlightId: highlightId ?? null,
      },
    });
  },

  hideContextMenu() {
    set({
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        selection: null,
        highlightId: null,
      },
    });
  },

  // --- Undo internal methods (skip undo stack) ---

  _undoRemoveHighlight(id) {
    const { highlights, selectedAnnotationId } = get();
    const next = new Map(highlights);
    next.delete(id);
    set({
      highlights: next,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteHighlight(id);
  },

  _undoRestoreHighlight(highlight) {
    const { highlights } = get();
    const next = new Map(highlights);
    next.set(highlight.id, highlight);
    set({ highlights: next });
    saveHighlight(highlight);
  },

  _undoUpdateHighlightColor(id, color) {
    const { highlights } = get();
    const h = highlights.get(id);
    if (!h) return;
    const updated = { ...h, color };
    const next = new Map(highlights);
    next.set(id, updated);
    set({ highlights: next });
    saveHighlight(updated);
  },

  _undoRemoveComment(id) {
    const { comments, selectedAnnotationId } = get();
    const next = new Map(comments);
    next.delete(id);
    set({
      comments: next,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteComment(id);
  },

  _undoRestoreComment(comment) {
    const { comments } = get();
    const next = new Map(comments);
    next.set(comment.id, comment);
    set({ comments: next });
    saveComment(comment);
  },
}));

// Register with undo store to break circular dependency
registerAnnotationStore(() => useAnnotationStore.getState());
