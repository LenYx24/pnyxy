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

interface HasSelection {
  selection: TextSelection;
}

// Pages this annotation touches (deduped). An annotation can span multiple pages.
function pagesOf(item: HasSelection): number[] {
  const seen = new Set<number>();
  for (const r of item.selection.rects) seen.add(r.pageNum);
  return Array.from(seen);
}

function buildPageIndex<T extends HasSelection>(
  items: Iterable<T>,
): Map<number, T[]> {
  const index = new Map<number, T[]>();
  for (const item of items) {
    for (const pageNum of pagesOf(item)) {
      const list = index.get(pageNum);
      if (list) list.push(item);
      else index.set(pageNum, [item]);
    }
  }
  return index;
}

// Copy-on-write update: only the affected page lists get new references,
// so HighlightLayer/CommentMarkers on unaffected pages don't re-render.
function indexUpsert<T extends HasSelection & { id: string }>(
  index: Map<number, T[]>,
  prev: T | undefined,
  next: T,
): Map<number, T[]> {
  const out = new Map(index);
  const prevPages = prev ? new Set(pagesOf(prev)) : new Set<number>();
  const nextPages = new Set(pagesOf(next));
  // Remove from pages that no longer contain it.
  for (const p of prevPages) {
    if (nextPages.has(p)) continue;
    const list = (out.get(p) ?? []).filter((x) => x.id !== next.id);
    if (list.length === 0) out.delete(p);
    else out.set(p, list);
  }
  // Add/replace on each next page.
  for (const p of nextPages) {
    const existing = out.get(p) ?? [];
    const filtered = existing.filter((x) => x.id !== next.id);
    filtered.push(next);
    out.set(p, filtered);
  }
  return out;
}

function indexRemove<T extends HasSelection & { id: string }>(
  index: Map<number, T[]>,
  item: T,
): Map<number, T[]> {
  const out = new Map(index);
  for (const p of pagesOf(item)) {
    const list = (out.get(p) ?? []).filter((x) => x.id !== item.id);
    if (list.length === 0) out.delete(p);
    else out.set(p, list);
  }
  return out;
}

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
  // Per-page indexes derived from the maps above. Maintained by every
  // mutation so visible pages can do O(1) lookup instead of O(N) filtering.
  highlightsByPage: Map<number, Highlight[]>;
  commentsByPage: Map<number, Comment[]>;
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
  highlightsByPage: new Map(),
  commentsByPage: new Map(),
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
      highlightsByPage: buildPageIndex(highlights),
      commentsByPage: buildPageIndex(comments),
      selectedAnnotationId: null,
    });
  },

  clearAll() {
    set({
      documentId: null,
      highlights: new Map(),
      comments: new Map(),
      highlightsByPage: new Map(),
      commentsByPage: new Map(),
      selectedAnnotationId: null,
      contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },
    });
  },

  addHighlight(selection, color) {
    const { documentId, highlights, highlightsByPage } = get();
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
      highlightsByPage: indexUpsert(highlightsByPage, undefined, highlight),
      contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },
    });
    saveHighlight(highlight);
    useUndoStore.getState().pushAction({ type: "add-highlight", highlight });
  },

  removeHighlight(id) {
    const { highlights, highlightsByPage, selectedAnnotationId } = get();
    const highlight = highlights.get(id);
    const next = new Map(highlights);
    next.delete(id);
    set({
      highlights: next,
      highlightsByPage: highlight
        ? indexRemove(highlightsByPage, highlight)
        : highlightsByPage,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteHighlight(id);
    if (highlight) {
      useUndoStore.getState().pushAction({ type: "remove-highlight", highlight });
    }
  },

  updateHighlightColor(id, color) {
    const { highlights, highlightsByPage } = get();
    const h = highlights.get(id);
    if (!h) return;

    const prevColor = h.color;
    const updated = { ...h, color };
    const next = new Map(highlights);
    next.set(id, updated);
    set({
      highlights: next,
      highlightsByPage: indexUpsert(highlightsByPage, h, updated),
    });
    saveHighlight(updated);
    useUndoStore.getState().pushAction({
      type: "change-highlight-color",
      id,
      prevColor,
      newColor: color,
    });
  },

  addComment(selection, text, highlightId) {
    const { documentId, comments, commentsByPage } = get();
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
      commentsByPage: indexUpsert(commentsByPage, undefined, comment),
      selectedAnnotationId: comment.id,
      contextMenu: { visible: false, x: 0, y: 0, selection: null, highlightId: null },
    });
    saveComment(comment);
    useUndoStore.getState().pushAction({ type: "add-comment", comment });
  },

  addReply(commentId, text) {
    const { comments, commentsByPage } = get();
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
    set({
      comments: next,
      commentsByPage: indexUpsert(commentsByPage, c, updated),
    });
    saveComment(updated);
  },

  resolveComment(commentId) {
    const { comments, commentsByPage } = get();
    const c = comments.get(commentId);
    if (!c) return;

    const updated = { ...c, resolved: !c.resolved };
    const next = new Map(comments);
    next.set(commentId, updated);
    set({
      comments: next,
      commentsByPage: indexUpsert(commentsByPage, c, updated),
    });
    saveComment(updated);
  },

  removeComment(id) {
    const { comments, commentsByPage, selectedAnnotationId } = get();
    const comment = comments.get(id);
    const next = new Map(comments);
    next.delete(id);
    set({
      comments: next,
      commentsByPage: comment
        ? indexRemove(commentsByPage, comment)
        : commentsByPage,
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
    const { highlights, highlightsByPage, selectedAnnotationId } = get();
    const existing = highlights.get(id);
    const next = new Map(highlights);
    next.delete(id);
    set({
      highlights: next,
      highlightsByPage: existing
        ? indexRemove(highlightsByPage, existing)
        : highlightsByPage,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteHighlight(id);
  },

  _undoRestoreHighlight(highlight) {
    const { highlights, highlightsByPage } = get();
    const next = new Map(highlights);
    next.set(highlight.id, highlight);
    set({
      highlights: next,
      highlightsByPage: indexUpsert(highlightsByPage, undefined, highlight),
    });
    saveHighlight(highlight);
  },

  _undoUpdateHighlightColor(id, color) {
    const { highlights, highlightsByPage } = get();
    const h = highlights.get(id);
    if (!h) return;
    const updated = { ...h, color };
    const next = new Map(highlights);
    next.set(id, updated);
    set({
      highlights: next,
      highlightsByPage: indexUpsert(highlightsByPage, h, updated),
    });
    saveHighlight(updated);
  },

  _undoRemoveComment(id) {
    const { comments, commentsByPage, selectedAnnotationId } = get();
    const existing = comments.get(id);
    const next = new Map(comments);
    next.delete(id);
    set({
      comments: next,
      commentsByPage: existing
        ? indexRemove(commentsByPage, existing)
        : commentsByPage,
      selectedAnnotationId: selectedAnnotationId === id ? null : selectedAnnotationId,
    });
    dbDeleteComment(id);
  },

  _undoRestoreComment(comment) {
    const { comments, commentsByPage } = get();
    const next = new Map(comments);
    next.set(comment.id, comment);
    set({
      comments: next,
      commentsByPage: indexUpsert(commentsByPage, undefined, comment),
    });
    saveComment(comment);
  },
}));

// Register with undo store to break circular dependency
registerAnnotationStore(() => useAnnotationStore.getState());
