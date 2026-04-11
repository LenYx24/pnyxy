import { create } from "zustand";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";
import { loadDocumentMeta, saveDocumentMeta } from "@/lib/annotation-storage";

export type ZoomMode = "fit-width" | "fit-page" | "custom";

const ZOOM_STEP = 15;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

export interface DocumentState {
  adapter: DocumentAdapter;
  meta: DocumentMeta;
  toc: TocItem[];
  currentPage: number;
  totalPages: number;
  zoomMode: ZoomMode;
  zoomLevel: number;
  scrollToPage: number | null;
  customTitle: string | null;
}

interface ReaderState {
  documents: Map<string, DocumentState>;
  activeDocumentId: string | null;

  // Active document convenience getters
  getActiveDoc: () => DocumentState | undefined;

  // Document management
  addDocument: (adapter: DocumentAdapter, file: File) => Promise<string>;
  removeDocument: (docId: string) => void;
  setActiveDocument: (docId: string | null) => void;

  // Per-document actions (operate on active doc if no docId)
  goToPage: (page: number, docId?: string) => void;
  nextPage: (docId?: string) => void;
  prevPage: (docId?: string) => void;
  zoomIn: (docId?: string) => void;
  zoomOut: (docId?: string) => void;
  setZoomMode: (mode: ZoomMode, docId?: string) => void;
  setZoomLevel: (level: number, docId?: string) => void;
  setCurrentPage: (page: number, docId?: string) => void;
  requestScrollToPage: (page: number, docId?: string) => void;
  clearScrollRequest: (docId?: string) => void;
  setCustomTitle: (title: string | null, docId?: string) => void;
  getDisplayTitle: (docId?: string) => string;
}

function updateDoc(
  documents: Map<string, DocumentState>,
  docId: string,
  patch: Partial<DocumentState>,
): Map<string, DocumentState> {
  const doc = documents.get(docId);
  if (!doc) return documents;
  const next = new Map(documents);
  next.set(docId, { ...doc, ...patch });
  return next;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  documents: new Map(),
  activeDocumentId: null,

  getActiveDoc() {
    const { documents, activeDocumentId } = get();
    if (!activeDocumentId) return undefined;
    return documents.get(activeDocumentId);
  },

  async addDocument(adapter, file) {
    const meta = await adapter.load(file);
    const toc = await adapter.extractToc();

    let customTitle: string | null = null;
    try {
      const stored = await loadDocumentMeta(meta.id);
      if (stored?.customTitle) customTitle = stored.customTitle;
    } catch {
      // ignore
    }

    const docState: DocumentState = {
      adapter,
      meta,
      toc,
      currentPage: 1,
      totalPages: meta.totalPages,
      zoomMode: "fit-width",
      zoomLevel: 100,
      scrollToPage: null,
      customTitle,
    };

    const next = new Map(get().documents);
    next.set(meta.id, docState);
    set({ documents: next, activeDocumentId: meta.id });
    return meta.id;
  },

  removeDocument(docId) {
    const { documents, activeDocumentId } = get();
    const doc = documents.get(docId);
    if (doc) doc.adapter.dispose();

    const next = new Map(documents);
    next.delete(docId);

    let newActive = activeDocumentId;
    if (activeDocumentId === docId) {
      const remaining = Array.from(next.keys());
      newActive = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

    set({ documents: next, activeDocumentId: newActive });
  },

  setActiveDocument(docId) {
    set({ activeDocumentId: docId });
  },

  goToPage(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const clamped = Math.min(Math.max(page, 1), doc.totalPages);
    if (doc.totalPages > 0) {
      set({ documents: updateDoc(documents, id, { currentPage: clamped, scrollToPage: clamped }) });
    }
  },

  nextPage(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const next = Math.min(doc.currentPage + 1, doc.totalPages);
    if (next !== doc.currentPage) {
      set({ documents: updateDoc(documents, id, { currentPage: next, scrollToPage: next }) });
    }
  },

  prevPage(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const prev = Math.max(doc.currentPage - 1, 1);
    if (prev !== doc.currentPage) {
      set({ documents: updateDoc(documents, id, { currentPage: prev, scrollToPage: prev }) });
    }
  },

  zoomIn(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const next = Math.min(doc.zoomLevel + ZOOM_STEP, ZOOM_MAX);
    set({ documents: updateDoc(documents, id, { zoomLevel: next, zoomMode: "custom" }) });
  },

  zoomOut(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const next = Math.max(doc.zoomLevel - ZOOM_STEP, ZOOM_MIN);
    set({ documents: updateDoc(documents, id, { zoomLevel: next, zoomMode: "custom" }) });
  },

  setZoomMode(mode, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    set({ documents: updateDoc(get().documents, id, { zoomMode: mode }) });
  },

  setZoomLevel(level, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    set({
      documents: updateDoc(get().documents, id, {
        zoomLevel: Math.min(Math.max(level, ZOOM_MIN), ZOOM_MAX),
        zoomMode: "custom",
      }),
    });
  },

  setCurrentPage(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    set({ documents: updateDoc(get().documents, id, { currentPage: page }) });
  },

  requestScrollToPage(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc) return;
    if (page >= 1 && page <= doc.totalPages) {
      set({ documents: updateDoc(get().documents, id, { scrollToPage: page }) });
    }
  },

  clearScrollRequest(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    set({ documents: updateDoc(get().documents, id, { scrollToPage: null }) });
  },

  setCustomTitle(title, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc) return;
    set({ documents: updateDoc(get().documents, id, { customTitle: title }) });
    saveDocumentMeta({ documentId: id, customTitle: title });
  },

  getDisplayTitle(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return "Untitled";
    const doc = get().documents.get(id);
    if (!doc) return "Untitled";
    return doc.customTitle || doc.meta.title || "Untitled";
  },
}));

// ---- Selector hooks for active document ----

export function useActiveDocument(): DocumentState | undefined {
  return useReaderStore((s) => {
    if (!s.activeDocumentId) return undefined;
    return s.documents.get(s.activeDocumentId);
  });
}

export function useDocumentState(docId: string): DocumentState | undefined {
  return useReaderStore((s) => s.documents.get(docId));
}
