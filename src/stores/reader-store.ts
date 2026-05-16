import { create } from "zustand";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";
import { loadDocumentMeta, saveDocumentMeta } from "@/lib/annotation-storage";
import { fetchResumeState, saveResumeState } from "@/lib/resume-state";
import { useSettingsStore } from "@/stores/settings-store";
import { getTracker, type TrackerContext } from "@/lib/reading-trackers";
import { hostEventBus } from "@/lib/plugins/api/events";

export type ZoomMode = "fit-width" | "fit-page" | "custom";

const ZOOM_STEP = 15;
const ZOOM_MIN = 25;
const ZOOM_MAX = 1000;
const PROGRESS_PERSIST_DEBOUNCE_MS = 800;

/** Compute the auto-mode AI page selection for a doc: a window of
 *  `aiSurroundingPagesCount` pages on either side of `center`,
 *  clamped to [1, totalPages]. Returns null when there's nothing to
 *  pick (non-PDF, empty doc, radius 0). Shared between `addDocument`
 *  and the page-change actions so the "initial fill" and "follow
 *  reading" paths can't drift. */
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

/** Helper for the page-change actions: when `doc.aiPagesAutoMode` is
 *  on, return a partial doc update that re-fills `aiSelectedPages`
 *  around the new center. Returns `{}` when auto-mode is off (the
 *  user picked their own pages, leave them alone) or when the new
 *  page can't produce an auto selection. Spread into the existing
 *  updateDoc call. */
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
  /** Rotation applied to all rendered pages, in degrees clockwise.
   *  Stored as a normalized 0/90/180/270 so the four-way cycle is
   *  unambiguous. PDF only — react-pdf's `<Page rotate>` prop swaps
   *  the page bounding box automatically, which feeds straight back
   *  into the virtualized layout's height calculation. */
  pageRotation: 0 | 90 | 180 | 270;
  scrollToPage: number | null;
  customTitle: string | null;
  /** Last visited page — always tracks `currentPage`, persisted on close. */
  lastPosition: number;
  /** Furthest page counted as read by the active tracker. */
  progressPage: number;
  /** 0..1 fractional position WITHIN `lastPosition`. Reported by the
   *  PDF viewer on scroll; restored on reopen so resume is
   *  pixel-precise rather than just snapping to the page top. */
  scrollOffset: number;
  /** EPUB Canonical Fragment Identifier — null for PDFs. The EPUB
   *  viewer reports it on every relocate and consumes it on first
   *  render via `rendition.display(cfi)`. */
  cfi: string | null;
  /** Pages the user has explicitly chosen to send as context to the
   *  AI chat for this document. Read by the chat-store at send time;
   *  the TOC selection mode in ThumbnailToc writes to it. Memory-only
   *  (resets on full reader unmount); a session-local feature on
   *  purpose so a stale 200-page selection from yesterday doesn't
   *  silently leak into today's first chat turn. */
  aiSelectedPages: Set<number>;
  /** Anchor for shift-click range selection in the TOC. Tracks the
   *  last individual page the user toggled so a follow-up shift+click
   *  paints the range from anchor → target. Cleared when the user
   *  clears the selection or leaves selection mode. */
  aiSelectionAnchor: number | null;
  /** When true, the selected pages are rendered as JPEG images and
   *  attached to the next chat turn instead of being extracted as
   *  text. Used for two cases: (a) scanned/image PDFs where text
   *  extraction returns nothing, auto-flipped on by the chat-store
   *  when needed; (b) figure/diagram-heavy pages where the user
   *  wants the model to actually see the pictures. Memory-only —
   *  same lifecycle as aiSelectedPages. */
  aiSendPagesAsImage: boolean;
  /** When true, `aiSelectedPages` follows the user's current page —
   *  re-fills with `currentPage ± aiSurroundingPagesCount` on every
   *  page change. Default for new docs so the AI always has *some*
   *  book context out of the box and the user can SEE which pages
   *  are queued without entering a separate selection mode. Any
   *  manual selection edit (toggle, range, select-all, clear) flips
   *  this off so the user's choice sticks. Re-enabled by clicking
   *  "Select around current page". */
  aiPagesAutoMode: boolean;
}

/**
 * Transient highlight slot for LLM citation jumps. When the user
 * clicks a `[p.42:"quote"]` chip in a chat message, the click
 * dispatcher writes the docId + page + quote into this slot;
 * `CitationQuoteHighlightLayer` reads it, searches the PDF for the
 * quote on that page, and paints a fading highlight. Cleared on
 * timeout or on doc switch so a stale citation doesn't ghost-mark
 * the next session.
 */
export interface ActiveCitation {
  docId: string;
  page: number;
  quote: string;
  /** Performance.now()-ish timestamp; the layer fades the highlight
   *  out a few seconds later. Kept as a single source of truth so
   *  the layer doesn't need its own timer state. */
  createdAt: number;
}

interface ReaderState {
  documents: Map<string, DocumentState>;
  activeDocumentId: string | null;
  /** Set by the chat citation click handler when the user opens a
   *  `[p.N:"..."]` chip. Read by `CitationQuoteHighlightLayer` to
   *  paint the transient highlight on the referenced page. Cleared
   *  automatically when the highlight finishes fading. */
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
  /** Rotate the active doc's pages by 90° clockwise (`direction = 1`)
   *  or counter-clockwise (`direction = -1`). Wraps modulo 360. */
  rotatePage: (direction: 1 | -1, docId?: string) => void;
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
  /** Update the fractional scroll position within the current page
   *  (PDF). Persisted on a debounce so a flick-scroll doesn't hammer
   *  IndexedDB or the network. */
  setScrollOffset: (offset: number, docId?: string) => void;
  /** Update the EPUB CFI as the user navigates the spine. Persisted
   *  on a debounce so page-flip doesn't hammer the network. */
  setCfi: (cfi: string, docId?: string) => void;

  // ── AI context page selection ────────────────────────────
  /** Toggle a single page in / out of the AI context selection,
   *  also setting it as the shift-click anchor. */
  toggleAiPage: (page: number, docId?: string) => void;
  /** Add every page in [from, to] (inclusive, order-independent) to
   *  the AI selection. The shift-click range path. Anchor is moved
   *  to `to` so a subsequent shift+click extends from there. */
  selectAiPageRange: (from: number, to: number, docId?: string) => void;
  /** Replace the selection with all pages 1..totalPages. */
  selectAllAiPages: (docId?: string) => void;
  /** Empty the selection and clear the anchor. */
  clearAiPages: (docId?: string) => void;
  /** Replace the selection with the N pages around currentPage —
   *  N = settings.aiSurroundingPagesCount on each side, clamped to
   *  [1, totalPages]. Used by the "select around current" button. */
  selectAiPagesAround: (docId?: string) => void;
  /** Toggle the "send selected pages as images" mode for the doc. */
  setAiSendPagesAsImage: (value: boolean, docId?: string) => void;

  /** Arm a citation highlight. Use-page-citation calls this when a
   *  chat-message chip with a quote payload is clicked; the layer
   *  picks it up and paints the temporary highlight on render. */
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
    // Mirror to the cloud (best-effort, fire-and-forget). The lib
    // layer swallows failures; an offline session keeps working
    // off the IndexedDB copy until the next online persist.
    void saveResumeState(docId, {
      page: doc.lastPosition,
      scrollOffset: doc.scrollOffset,
      cfi: doc.cfi,
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

    // Local IndexedDB read — works offline, populated from previous
    // sessions on this device.
    let stored: Awaited<ReturnType<typeof loadDocumentMeta>>;
    try {
      stored = await loadDocumentMeta(meta.id);
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
      if (typeof stored?.scrollOffset === "number") {
        scrollOffset = stored.scrollOffset;
      }
      if (typeof stored?.cfi === "string") cfi = stored.cfi;
    } catch {
      // ignore
    }

    // Cloud read — overrides local when newer. Best-effort; offline
    // or unauth'd sessions just skip this and use the local copy.
    try {
      const cloud = await fetchResumeState(meta.id);
      if (cloud) {
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
      // ignore — local copy already loaded above
    }

    // Auto-mode pre-fill: derive the initial AI page selection from
    // the resume position + the user's surrounding-pages setting so
    // the AI has working book context the moment chat opens. PDF
    // only — non-PDF formats have no extractable page text yet, so
    // the auto-fill would be a no-op semantic-wise.
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
      aiSelectedPages: initialAiPages,
      aiSelectionAnchor: null,
      aiSendPagesAsImage: false,
      aiPagesAutoMode: true,
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
    // Reset scrollOffset on imperative navigation so the next
    // scrollToPage lands at page top (TOC click, search jump,
    // bookmark — none of which mean "halfway down the page").
    // Natural scroll-driven page changes go through setCurrentPage,
    // which preserves scrollOffset.
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
      updateDoc(documents, id, {
        currentPage: next,
        scrollToPage: next,
        scrollOffset: 0,
        ...autoFollowUpdate(doc, next),
      }),
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
      updateDoc(documents, id, {
        currentPage: prev,
        scrollToPage: prev,
        scrollOffset: 0,
        ...autoFollowUpdate(doc, prev),
      }),
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

  rotatePage(direction, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc) return;
    // Wrap modulo 360 so the four-way cycle stays in the 0/90/180/270
    // domain regardless of how many CW/CCW presses the user stacks.
    const next = (((doc.pageRotation + direction * 90) % 360) + 360) %
      360 as 0 | 90 | 180 | 270;
    set({
      documents: updateDoc(get().documents, id, { pageRotation: next }),
    });
  },

  // (See updateDoc/autoFollowUpdate above — manual-selection ops drop
  // out of auto-mode, page-change ops keep it on and re-fill.)
  setCurrentPage(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
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
  },

  requestScrollToPage(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc) return;
    if (page >= 1 && page <= doc.totalPages) {
      // Reset the within-page offset alongside the page jump.
      // requestScrollToPage is for imperative navigation (search
      // next/prev, TOC click, AI citation jump) which should always
      // land at the top of the target page. Without this reset, the
      // PdfViewer's scroll effect reuses the user's last
      // scrollOffset (e.g. 0.7 = 70% down the previous page), which
      // visually places them mid-way down a page they never
      // requested — search lands on the *wrong* page entirely if
      // the offset is large enough that 70% of page N's height
      // overshoots page N's bottom and lands in N+1.
      // Resume-on-doc-open writes (page, offset) atomically in the
      // bookDocumentLoaded path; it doesn't go through here.
      set({
        documents: updateDoc(get().documents, id, {
          scrollToPage: page,
          scrollOffset: 0,
        }),
      });
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

  setScrollOffset(offset, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc) return;
    // Clamp and snap to 4 decimals to avoid an infinite stream of
    // "imperceptibly different" persists from sub-pixel scroll
    // jitter (e.g. trackpad inertia).
    const clamped = Math.max(0, Math.min(1, offset));
    const rounded = Math.round(clamped * 10000) / 10000;
    if (Math.abs(rounded - doc.scrollOffset) < 0.0001) return;
    set({ documents: updateDoc(documents, id, { scrollOffset: rounded }) });
    schedulePersistProgress(id);
  },

  setCfi(cfi, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const { documents } = get();
    const doc = documents.get(id);
    if (!doc || doc.cfi === cfi) return;
    set({ documents: updateDoc(documents, id, { cfi }) });
    schedulePersistProgress(id);
  },

  toggleAiPage(page, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc) return;
    if (page < 1 || page > doc.totalPages) return;
    const next = new Set(doc.aiSelectedPages);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    set({
      documents: updateDoc(get().documents, id, {
        aiSelectedPages: next,
        // Anchor follows the most recent toggle so the next shift+click
        // paints from here. The anchor remains valid even after a
        // delete; you can shift-click *out* of pages just as well.
        aiSelectionAnchor: page,
        // Manual edit → leave auto-mode so subsequent page navigation
        // doesn't overwrite the user's choice.
        aiPagesAutoMode: false,
      }),
    });
  },

  selectAiPageRange(from, to, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc) return;
    const lo = Math.max(1, Math.min(from, to));
    const hi = Math.min(doc.totalPages, Math.max(from, to));
    if (hi < lo) return;
    const next = new Set(doc.aiSelectedPages);
    for (let p = lo; p <= hi; p++) next.add(p);
    set({
      documents: updateDoc(get().documents, id, {
        aiSelectedPages: next,
        aiSelectionAnchor: to,
        aiPagesAutoMode: false,
      }),
    });
  },

  selectAllAiPages(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc || doc.totalPages <= 0) return;
    const next = new Set<number>();
    for (let p = 1; p <= doc.totalPages; p++) next.add(p);
    set({
      documents: updateDoc(get().documents, id, {
        aiSelectedPages: next,
        aiSelectionAnchor: doc.totalPages,
        aiPagesAutoMode: false,
      }),
    });
  },

  clearAiPages(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc || (doc.aiSelectedPages.size === 0 && !doc.aiPagesAutoMode)) return;
    set({
      documents: updateDoc(get().documents, id, {
        aiSelectedPages: new Set(),
        aiSelectionAnchor: null,
        aiPagesAutoMode: false,
      }),
    });
  },

  selectAiPagesAround(docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc || doc.totalPages <= 0) return;
    const center = doc.currentPage > 0 ? doc.currentPage : 1;
    const next = autoPagesAround(doc.meta.format, doc.totalPages, center);
    if (!next) return;
    set({
      documents: updateDoc(get().documents, id, {
        aiSelectedPages: next,
        aiSelectionAnchor: center,
        // Re-enter auto-mode — the user opted back into "follow my
        // reading", overwriting whatever manual edits they had.
        aiPagesAutoMode: true,
      }),
    });
  },

  setAiSendPagesAsImage(value, docId) {
    const id = docId ?? get().activeDocumentId;
    if (!id) return;
    const doc = get().documents.get(id);
    if (!doc || doc.aiSendPagesAsImage === value) return;
    set({
      documents: updateDoc(get().documents, id, {
        aiSendPagesAsImage: value,
      }),
    });
  },

  setActiveCitation(citation) {
    set({ activeCitation: citation });
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
