import { create } from "zustand";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";
import { loadDocumentMeta, saveDocumentMeta } from "@/lib/annotation-storage";
import { useSettingsStore } from "@/stores/settings-store";
import { getTracker, type TrackerContext } from "@/lib/reading-trackers";
import { hostEventBus } from "@/lib/plugins/api/events";

export type ZoomMode = "fit-width" | "fit-page" | "custom";

const ZOOM_STEP = 15;
const ZOOM_MIN = 25;
const ZOOM_MAX = 1000;
const PROGRESS_PERSIST_DEBOUNCE_MS = 800;

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
  /** Last visited page — always tracks `currentPage`, persisted on close. */
  lastPosition: number;
  /** Furthest page counted as read by the active tracker. */
  progressPage: number;
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
  /**
   * Manually set the user's reading progress to a specific page,
   * bypassing the tracker's normal advancement rules.
   */
  manualSetProgress: (page: number, docId?: string) => void;
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

// ── Progress persistence (debounced per document) ───────────

const progressSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePersistProgress(docId: string): void {
  const existing = progressSaveTimers.get(docId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    progressSaveTimers.delete(docId);
    const doc = useReaderStore.getState().documents.get(docId);
    if (!doc) return;
    loadDocumentMeta(docId)
      .then((stored) => {
        saveDocumentMeta({
          documentId: docId,
          ...stored,
          lastPosition: doc.lastPosition,
          progressPage: doc.progressPage,
        });
      })
      .catch(() => {
        saveDocumentMeta({
          documentId: docId,
          lastPosition: doc.lastPosition,
          progressPage: doc.progressPage,
        });
      });
  }, PROGRESS_PERSIST_DEBOUNCE_MS);
  progressSaveTimers.set(docId, timer);
}

// ── Tracker invocation ──────────────────────────────────────

function buildTrackerContext(doc: DocumentState): TrackerContext {
  const settingsState = useSettingsStore.getState();
  const trackerId = settingsState.activeTrackerId;
  return {
    currentProgress: doc.progressPage,
    totalPages: doc.totalPages,
    settings: settingsState.trackerSettings[trackerId] ?? {},
  };
}

function clampProgress(value: number, totalPages: number): number {
  if (!Number.isFinite(value)) return 0;
  if (totalPages <= 0) return Math.max(0, Math.floor(value));
  return Math.max(0, Math.min(totalPages, Math.floor(value)));
}

/** Notify the active tracker about a page change and persist. */
function recordPageChange(
  documents: Map<string, DocumentState>,
  docId: string,
  from: number,
  to: number,
): Map<string, DocumentState> {
  const doc = documents.get(docId);
  if (!doc) return documents;

  const tracker = getTracker(useSettingsStore.getState().activeTrackerId);
  let nextProgress = doc.progressPage;
  if (tracker.onPageChange) {
    const result = tracker.onPageChange(buildTrackerContext(doc), from, to);
    if (typeof result === "number") {
      nextProgress = clampProgress(result, doc.totalPages);
    }
  }

  const patch: Partial<DocumentState> = { lastPosition: to };
  if (nextProgress !== doc.progressPage) {
    patch.progressPage = nextProgress;
  }

  const next = updateDoc(documents, docId, patch);
  schedulePersistProgress(docId);
  hostEventBus.emit("reader:page-change", { docId, page: to, from });
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
    let zoomMode: ZoomMode = useSettingsStore.getState().defaultFitMode;
    let lastPosition = 1;
    let progressPage = 0;
    try {
      const stored = await loadDocumentMeta(meta.id);
      if (stored?.customTitle) customTitle = stored.customTitle;
      if (stored?.zoomMode === "fit-width" || stored?.zoomMode === "fit-page") {
        zoomMode = stored.zoomMode;
      }
      if (typeof stored?.lastPosition === "number") {
        lastPosition = clampProgress(stored.lastPosition, meta.totalPages) || 1;
      }
      if (typeof stored?.progressPage === "number") {
        progressPage = clampProgress(stored.progressPage, meta.totalPages);
      }
    } catch {
      // ignore
    }

    const docState: DocumentState = {
      adapter,
      meta,
      toc,
      currentPage: lastPosition,
      totalPages: meta.totalPages,
      zoomMode,
      zoomLevel: 100,
      scrollToPage: lastPosition > 1 ? lastPosition : null,
      customTitle,
      lastPosition,
      progressPage,
    };

    const next = new Map(get().documents);
    next.set(meta.id, docState);
    set({ documents: next, activeDocumentId: meta.id });
    hostEventBus.emit("book:opened", { docId: meta.id, title: meta.title });
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
    hostEventBus.emit("book:closed", { docId });
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
    if (doc.totalPages <= 0 || clamped === doc.currentPage) return;
    const updated = recordPageChange(
      updateDoc(documents, id, { currentPage: clamped, scrollToPage: clamped }),
      id,
      doc.currentPage,
      clamped,
    );
    set({ documents: updated });
  },

  nextPage(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const next = Math.min(doc.currentPage + 1, doc.totalPages);
    if (next === doc.currentPage) return;
    const updated = recordPageChange(
      updateDoc(documents, id, { currentPage: next, scrollToPage: next }),
      id,
      doc.currentPage,
      next,
    );
    set({ documents: updated });
  },

  prevPage(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    const prev = Math.max(doc.currentPage - 1, 1);
    if (prev === doc.currentPage) return;
    const updated = recordPageChange(
      updateDoc(documents, id, { currentPage: prev, scrollToPage: prev }),
      id,
      doc.currentPage,
      prev,
    );
    set({ documents: updated });
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
    // Persist fit mode per-document (only fit-width/fit-page, not custom)
    if (mode !== "custom") {
      loadDocumentMeta(id).then((existing) => {
        saveDocumentMeta({ documentId: id, ...existing, zoomMode: mode });
      }).catch(() => {
        saveDocumentMeta({ documentId: id, zoomMode: mode });
      });
    }
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
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    if (page === doc.currentPage) return;
    const updated = recordPageChange(
      updateDoc(documents, id, { currentPage: page }),
      id,
      doc.currentPage,
      page,
    );
    set({ documents: updated });
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

  manualSetProgress(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;

    const tracker = getTracker(useSettingsStore.getState().activeTrackerId);
    if (!tracker.onManualSet) return;
    const result = tracker.onManualSet(buildTrackerContext(doc), page);
    if (typeof result !== "number") return;
    const next = clampProgress(result, doc.totalPages);
    if (next === doc.progressPage) return;
    set({ documents: updateDoc(documents, id, { progressPage: next }) });
    schedulePersistProgress(id);
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
