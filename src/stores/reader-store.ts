import { create } from "zustand";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";
import { loadDocumentMeta, saveDocumentMeta } from "@/lib/annotation-storage";
import { fetchResumeState, saveResumeState } from "@/lib/resume-state";
import { useSettingsStore } from "@/stores/settings-store";
import { getFeatures } from "@/lib/use-features";
import { getTracker, type TrackerContext } from "@/lib/reading-trackers";
import { hostEventBus } from "@/lib/plugins/api/events";
import { track } from "@/lib/telemetry";

// "auto" = fit width capped at 100%, "actual" = intrinsic size. Resolved to a scale in PdfViewer.
export type ZoomMode =
  | "fit-width"
  | "fit-page"
  | "auto"
  | "actual"
  | "custom";

// Fit modes (everything but "custom") persist per-document and restore on open.
const FIT_MODES: ZoomMode[] = ["fit-width", "fit-page", "auto", "actual"];
function isFitMode(m: unknown): m is ZoomMode {
  return typeof m === "string" && FIT_MODES.includes(m as ZoomMode);
}

const ZOOM_STEP = 15;
const ZOOM_MIN = 25;
const ZOOM_MAX = 1000;
const PROGRESS_PERSIST_DEBOUNCE_MS = 800;

/** Window of `aiSurroundingPagesCount` pages either side of `center`,
 *  clamped to [1, totalPages]. Null for non-PDF, empty doc, or radius 0. */
function autoPagesAround(
  format: string,
  totalPages: number,
  center: number,
): Set<number> | null {
  if (format !== "pdf" || totalPages <= 0) return null;
  const radius = useSettingsStore.getState().aiSurroundingPagesCount;
  if (radius <= 0) return null;
  const c = center > 0 ? center : 1;
  const lo = Math.max(1, c - radius);
  const hi = Math.min(totalPages, c + radius);
  const set = new Set<number>();
  for (let p = lo; p <= hi; p++) set.add(p);
  return set;
}

/** When auto-mode is on, re-fill `aiSelectedPages` around the new center.
 *  `{}` when auto-mode is off (manual selection wins) or no selection is possible. */
function autoFollowUpdate(
  doc: DocumentState,
  newPage: number,
): Partial<DocumentState> {
  if (!doc.aiPagesAutoMode) return {};
  const next = autoPagesAround(doc.meta.format, doc.totalPages, newPage);
  if (!next) return {};
  return { aiSelectedPages: next, aiSelectionAnchor: newPage };
}

export interface DocumentState {
  adapter: DocumentAdapter;
  meta: DocumentMeta;
  toc: TocItem[];
  currentPage: number;
  totalPages: number;
  zoomMode: ZoomMode;
  zoomLevel: number;
  /** Page rotation in degrees clockwise, normalized to 0/90/180/270. PDF only. */
  pageRotation: 0 | 90 | 180 | 270;
  scrollToPage: number | null;
  customTitle: string | null;
  /** Last visited page, tracks `currentPage`, persisted on close. */
  lastPosition: number;
  /** Furthest page counted as read by the active tracker. */
  progressPage: number;
  /** 0..1 fractional position within `lastPosition`, for pixel-precise resume. */
  scrollOffset: number;
  /** EPUB CFI, null for PDFs. */
  cfi: string | null;
  /** ISO timestamp the book was last read (from resume state); drives the
   *  "summarize where you left off" offer when re-opened after a while. */
  lastReadAt?: string | null;
  /** Pages sent as AI chat context. Memory-only, resets on reader unmount. */
  aiSelectedPages: Set<number>;
  /** Anchor for shift-click range selection: last individual page toggled. */
  aiSelectionAnchor: number | null;
  /** Send selected pages as JPEG images instead of extracted text. Used for
   *  scanned PDFs (auto-flipped by chat-store) and figure-heavy pages. */
  aiSendPagesAsImage: boolean;
  /** When true, `aiSelectedPages` follows currentPage on every page change.
   *  Default on for new docs. Any manual selection edit flips it off. */
  aiPagesAutoMode: boolean;
}

/** Transient slot for citation-chip jumps; CitationQuoteHighlightLayer reads it and paints a fading highlight. */
export interface ActiveCitation {
  docId: string;
  page: number;
  quote: string;
  createdAt: number;
}

interface ReaderState {
  documents: Map<string, DocumentState>;
  activeDocumentId: string | null;
  /** Armed by a citation-chip click, read by CitationQuoteHighlightLayer. */
  activeCitation: ActiveCitation | null;

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
  /** Rotate 90° clockwise (1) or counter-clockwise (-1). Wraps modulo 360. */
  rotatePage: (direction: 1 | -1, docId?: string) => void;
  setCurrentPage: (page: number, docId?: string) => void;
  requestScrollToPage: (page: number, docId?: string) => void;
  clearScrollRequest: (docId?: string) => void;
  setCustomTitle: (title: string | null, docId?: string) => void;
  getDisplayTitle: (docId?: string) => string;
  /** Set reading progress to a page, bypassing the tracker's advancement rules. */
  manualSetProgress: (page: number, docId?: string) => void;
  /** Update within-page scroll offset (PDF). Debounced persist. */
  setScrollOffset: (offset: number, docId?: string) => void;
  /** Update the EPUB CFI. Debounced persist. */
  setCfi: (cfi: string, docId?: string) => void;

  // AI context page selection
  /** Toggle a single page in/out of the AI selection, setting it as anchor. */
  toggleAiPage: (page: number, docId?: string) => void;
  /** Add [from, to] (inclusive, order-independent) to the selection, anchor → to. */
  selectAiPageRange: (from: number, to: number, docId?: string) => void;
  /** Replace the selection with all pages 1..totalPages. */
  selectAllAiPages: (docId?: string) => void;
  /** Empty the selection and clear the anchor. */
  clearAiPages: (docId?: string) => void;
  /** Replace the selection with the pages around currentPage. */
  selectAiPagesAround: (docId?: string) => void;
  /** Toggle send-pages-as-images mode. */
  setAiSendPagesAsImage: (value: boolean, docId?: string) => void;

  /** Arm a citation highlight from a clicked chat-message chip. */
  setActiveCitation: (citation: ActiveCitation | null) => void;
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

// Progress persistence (debounced per document)

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
          scrollOffset: doc.scrollOffset,
          cfi: doc.cfi ?? undefined,
        });
      })
      .catch(() => {
        saveDocumentMeta({
          documentId: docId,
          lastPosition: doc.lastPosition,
          progressPage: doc.progressPage,
          scrollOffset: doc.scrollOffset,
          cfi: doc.cfi ?? undefined,
        });
      });
    // Mirror to cloud, fire-and-forget. Failures fall back to the IndexedDB copy.
    void saveResumeState(docId, {
      page: doc.lastPosition,
      scrollOffset: doc.scrollOffset,
      cfi: doc.cfi,
    });
  }, PROGRESS_PERSIST_DEBOUNCE_MS);
  progressSaveTimers.set(docId, timer);
}

// Tracker invocation

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
// reader_page_view throttle: at most one event per doc per 30s, so a fast
// scroll/flip session doesn't flood the telemetry queue.
const READER_PAGE_VIEW_THROTTLE_MS = 30_000;
const lastPageViewTrackedAt = new Map<string, number>();

function recordPageChange(
  documents: Map<string, DocumentState>,
  docId: string,
  from: number,
  to: number,
): Map<string, DocumentState> {
  const doc = documents.get(docId);
  if (!doc) return documents;

  const now = Date.now();
  if (now - (lastPageViewTrackedAt.get(docId) ?? 0) >= READER_PAGE_VIEW_THROTTLE_MS) {
    lastPageViewTrackedAt.set(docId, now);
    track("reader_page_view", { doc: docId, page: to });
  }

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

export const useReaderStore = create<ReaderState>((set, get) => {
  /** Resolve `docId` (default: the active doc), look up its DocumentState,
   *  and no-op when either is missing. The common "resolve id, get doc,
   *  bail" preamble shared by most per-document actions below. */
  function withDoc<T>(
    docId: string | undefined,
    fn: (
      doc: DocumentState,
      id: string,
      documents: Map<string, DocumentState>,
    ) => T,
  ): T | undefined {
    const id = docId ?? get().activeDocumentId;
    if (!id) return undefined;
    const documents = get().documents;
    const doc = documents.get(id);
    if (!doc) return undefined;
    return fn(doc, id, documents);
  }

  return {
    documents: new Map(),
    activeDocumentId: null,
    activeCitation: null,

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
      let scrollOffset = 0;
      let cfi: string | null = null;
      let lastReadAt: string | null = null;

      // Local IndexedDB read, works offline.
      let stored: Awaited<ReturnType<typeof loadDocumentMeta>>;
      try {
        stored = await loadDocumentMeta(meta.id);
        if (stored?.customTitle) customTitle = stored.customTitle;
        if (isFitMode(stored?.zoomMode)) {
          zoomMode = stored.zoomMode;
        }
        if (typeof stored?.lastPosition === "number") {
          lastPosition = clampProgress(stored.lastPosition, meta.totalPages) || 1;
        }
        if (typeof stored?.progressPage === "number") {
          progressPage = clampProgress(stored.progressPage, meta.totalPages);
        }
        if (typeof stored?.scrollOffset === "number") {
          scrollOffset = stored.scrollOffset;
        }
        if (typeof stored?.cfi === "string") cfi = stored.cfi;
        if (typeof stored?.updatedAt === "number") {
          lastReadAt = new Date(stored.updatedAt).toISOString();
        }
      } catch {
        // ignore
      }

      // Cloud read, overrides local when newer. Skipped when offline/unauth.
      try {
        const cloud = await fetchResumeState(meta.id);
        if (cloud) {
          // cloud row is the authoritative last-seen timestamp
          lastReadAt = cloud.updated_at;
          const cloudTs = new Date(cloud.updated_at).getTime();
          const localTs = stored?.updatedAt ?? 0;
          if (cloudTs > localTs) {
            const cloudPage = clampProgress(cloud.page, meta.totalPages) || 1;
            lastPosition = cloudPage;
            scrollOffset = cloud.scroll_offset ?? 0;
            cfi = cloud.cfi ?? null;
          }
        }
      } catch {
        // ignore, local copy already loaded above
      }

      // Pre-fill AI selection around the resume position so chat has context on open.
      const initialAiPages =
        autoPagesAround(meta.format, meta.totalPages, lastPosition) ??
        new Set<number>();

      const docState: DocumentState = {
        adapter,
        meta,
        toc,
        currentPage: lastPosition,
        totalPages: meta.totalPages,
        zoomMode,
        zoomLevel: 100,
        pageRotation: 0,
        scrollToPage: lastPosition > 1 ? lastPosition : null,
        customTitle,
        lastPosition,
        progressPage,
        scrollOffset,
        cfi,
        lastReadAt,
        aiSelectedPages: initialAiPages,
        aiSelectionAnchor: null,
        aiSendPagesAsImage: false,
        aiPagesAutoMode: true,
      };

      const next = new Map(get().documents);
      // Single-document mode (pilot default): opening a book replaces the
      // ones already open instead of stacking tabs.
      if (!getFeatures().multiDoc) {
        for (const [id, doc] of next) {
          if (id !== meta.id) {
            doc.adapter.dispose();
            next.delete(id);
          }
        }
      }
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
      withDoc(docId, (doc, id, documents) => {
        const clamped = Math.min(Math.max(page, 1), doc.totalPages);
        if (doc.totalPages <= 0 || clamped === doc.currentPage) return;
        // reset scrollOffset so imperative jumps land at page top (setCurrentPage keeps it)
        const updated = recordPageChange(
          updateDoc(documents, id, {
            currentPage: clamped,
            scrollToPage: clamped,
            scrollOffset: 0,
            ...autoFollowUpdate(doc, clamped),
          }),
          id,
          doc.currentPage,
          clamped,
        );
        set({ documents: updated });
      });
    },

    nextPage(docId) {
      withDoc(docId, (doc) => get().goToPage(doc.currentPage + 1, docId));
    },

    prevPage(docId) {
      withDoc(docId, (doc) => get().goToPage(doc.currentPage - 1, docId));
    },

    zoomIn(docId) {
      withDoc(docId, (doc, id, documents) => {
        const next = Math.min(doc.zoomLevel + ZOOM_STEP, ZOOM_MAX);
        set({ documents: updateDoc(documents, id, { zoomLevel: next, zoomMode: "custom" }) });
      });
    },

    zoomOut(docId) {
      withDoc(docId, (doc, id, documents) => {
        const next = Math.max(doc.zoomLevel - ZOOM_STEP, ZOOM_MIN);
        set({ documents: updateDoc(documents, id, { zoomLevel: next, zoomMode: "custom" }) });
      });
    },

    setZoomMode(mode, docId) {
      const id = docId ?? get().activeDocumentId;
      if (!id) return;
      set({ documents: updateDoc(get().documents, id, { zoomMode: mode }) });
      // Persist fit mode per-document (not custom)
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

    rotatePage(direction, docId) {
      withDoc(docId, (doc, id, documents) => {
        // Wrap modulo 360 to stay in the 0/90/180/270 domain.
        const next = (((doc.pageRotation + direction * 90) % 360) + 360) %
          360 as 0 | 90 | 180 | 270;
        set({
          documents: updateDoc(documents, id, { pageRotation: next }),
        });
      });
    },

    setCurrentPage(page, docId) {
      withDoc(docId, (doc, id, documents) => {
        if (page === doc.currentPage) return;
        const updated = recordPageChange(
          updateDoc(documents, id, {
            currentPage: page,
            ...autoFollowUpdate(doc, page),
          }),
          id,
          doc.currentPage,
          page,
        );
        set({ documents: updated });
      });
    },

    requestScrollToPage(page, docId) {
      withDoc(docId, (doc, id, documents) => {
        if (page >= 1 && page <= doc.totalPages) {
          // reset offset or PdfViewer reuses the stale value and overshoots into page N+1
          set({
            documents: updateDoc(documents, id, {
              scrollToPage: page,
              scrollOffset: 0,
            }),
          });
        }
      });
    },

    clearScrollRequest(docId) {
      const id = docId ?? get().activeDocumentId;
      if (!id) return;
      set({ documents: updateDoc(get().documents, id, { scrollToPage: null }) });
    },

    setCustomTitle(title, docId) {
      withDoc(docId, (_doc, id, documents) => {
        set({ documents: updateDoc(documents, id, { customTitle: title }) });
        saveDocumentMeta({ documentId: id, customTitle: title });
      });
    },

    getDisplayTitle(docId) {
      return (
        withDoc(docId, (doc) => doc.customTitle || doc.meta.title || "Untitled") ??
        "Untitled"
      );
    },

    manualSetProgress(page, docId) {
      withDoc(docId, (doc, id, documents) => {
        const tracker = getTracker(useSettingsStore.getState().activeTrackerId);
        if (!tracker.onManualSet) return;
        const result = tracker.onManualSet(buildTrackerContext(doc), page);
        if (typeof result !== "number") return;
        const next = clampProgress(result, doc.totalPages);
        if (next === doc.progressPage) return;
        set({ documents: updateDoc(documents, id, { progressPage: next }) });
        schedulePersistProgress(id);
      });
    },

    setScrollOffset(offset, docId) {
      withDoc(docId, (doc, id, documents) => {
        // Snap to 4 decimals so sub-pixel scroll jitter doesn't spam persists.
        const clamped = Math.max(0, Math.min(1, offset));
        const rounded = Math.round(clamped * 10000) / 10000;
        if (Math.abs(rounded - doc.scrollOffset) < 0.0001) return;
        set({ documents: updateDoc(documents, id, { scrollOffset: rounded }) });
        schedulePersistProgress(id);
      });
    },

    setCfi(cfi, docId) {
      withDoc(docId, (doc, id, documents) => {
        if (doc.cfi === cfi) return;
        set({ documents: updateDoc(documents, id, { cfi }) });
        schedulePersistProgress(id);
      });
    },

    toggleAiPage(page, docId) {
      withDoc(docId, (doc, id, documents) => {
        if (page < 1 || page > doc.totalPages) return;
        const next = new Set(doc.aiSelectedPages);
        if (next.has(page)) next.delete(page);
        else next.add(page);
        set({
          documents: updateDoc(documents, id, {
            aiSelectedPages: next,
            aiSelectionAnchor: page,
            // manual edit leaves auto-mode so navigation won't clobber the choice
            aiPagesAutoMode: false,
          }),
        });
      });
    },

    selectAiPageRange(from, to, docId) {
      withDoc(docId, (doc, id, documents) => {
        const lo = Math.max(1, Math.min(from, to));
        const hi = Math.min(doc.totalPages, Math.max(from, to));
        if (hi < lo) return;
        const next = new Set(doc.aiSelectedPages);
        for (let p = lo; p <= hi; p++) next.add(p);
        set({
          documents: updateDoc(documents, id, {
            aiSelectedPages: next,
            aiSelectionAnchor: to,
            aiPagesAutoMode: false,
          }),
        });
      });
    },

    selectAllAiPages(docId) {
      withDoc(docId, (doc, id, documents) => {
        if (doc.totalPages <= 0) return;
        const next = new Set<number>();
        for (let p = 1; p <= doc.totalPages; p++) next.add(p);
        set({
          documents: updateDoc(documents, id, {
            aiSelectedPages: next,
            aiSelectionAnchor: doc.totalPages,
            aiPagesAutoMode: false,
          }),
        });
      });
    },

    clearAiPages(docId) {
      withDoc(docId, (doc, id, documents) => {
        if (doc.aiSelectedPages.size === 0 && !doc.aiPagesAutoMode) return;
        set({
          documents: updateDoc(documents, id, {
            aiSelectedPages: new Set(),
            aiSelectionAnchor: null,
            aiPagesAutoMode: false,
          }),
        });
      });
    },

    selectAiPagesAround(docId) {
      withDoc(docId, (doc, id, documents) => {
        if (doc.totalPages <= 0) return;
        const center = doc.currentPage > 0 ? doc.currentPage : 1;
        const next = autoPagesAround(doc.meta.format, doc.totalPages, center);
        if (!next) return;
        set({
          documents: updateDoc(documents, id, {
            aiSelectedPages: next,
            aiSelectionAnchor: center,
            // back into auto-mode
            aiPagesAutoMode: true,
          }),
        });
      });
    },

    setAiSendPagesAsImage(value, docId) {
      withDoc(docId, (doc, id, documents) => {
        if (doc.aiSendPagesAsImage === value) return;
        set({
          documents: updateDoc(documents, id, {
            aiSendPagesAsImage: value,
          }),
        });
      });
    },

    setActiveCitation(citation) {
      set({ activeCitation: citation });
    },
  };
});

// Selector hooks

export function useActiveDocument(): DocumentState | undefined {
  return useReaderStore((s) => {
    if (!s.activeDocumentId) return undefined;
    return s.documents.get(s.activeDocumentId);
  });
}

export function useDocumentState(docId: string): DocumentState | undefined {
  return useReaderStore((s) => s.documents.get(docId));
}
