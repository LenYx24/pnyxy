import { create } from "zustand";
import type {
  WhiteboardElement,
  WhiteboardBackground,
  WhiteboardTool,
  WhiteboardData,
  Point,
} from "@/types/whiteboard";
import {
  loadAllWhiteboards,
  saveWhiteboard as dbSaveWhiteboard,
  deleteWhiteboard as dbDeleteWhiteboard,
  loadWhiteboard,
} from "@/lib/whiteboard-storage";
import {
  pushWhiteboard,
  deleteWhiteboardCloud,
  pullAllWhiteboards,
} from "@/lib/whiteboard-sync";
import { logError } from "@/lib/logger";
import { pdfjs } from "react-pdf";
import {
  loadPdfDocument,
  getPageLayouts,
  renderSinglePage,
} from "@/features/whiteboard/lib/pdf-renderer";

interface UndoEntry {
  elements: WhiteboardElement[];
  background: WhiteboardBackground;
}

// --- Lazy PDF background state (module scope: heavy, non-serializable) ---
// The whole document is laid out up front but only pages near the viewport are
// rasterized, and far ones evicted, so a 100+ page book never holds 100 full-
// res bitmaps at once.
let pdfDocRef: pdfjs.PDFDocumentProxy | null = null;
let pdfScaleRef = 1.5;
const pdfRenderInFlight = new Set<number>();
const MAX_RENDERED_PAGES = 12;

// Debounced persistence: dragging fires updateElement on every pointer-move,
// and saving the whole board to IndexedDB + Supabase each time saturated the
// write path. Coalesce those into one save shortly after the last change.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 400;

const MAX_UNDO = 60;

export interface PdfBackgroundPage {
  pageNum: number;
  /** null until the page is rasterized on demand (lazy windowing). */
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  /** Y position in world space */
  y: number;
}

interface WhiteboardState {
  // Sidebar listing
  whiteboards: WhiteboardData[];

  // Active whiteboard
  activeWhiteboardId: string | null;
  elements: WhiteboardElement[];
  background: WhiteboardBackground;

  // PDF background pages (transient, not persisted)
  pdfPages: PdfBackgroundPage[];
  pdfLoading: boolean;
  pdfLoadProgress: string | null;

  // Drawing settings
  activeTool: WhiteboardTool;
  strokeColor: string;
  strokeWidth: number;

  // Selection
  selectedElementIds: Set<string>;

  // Viewport
  panX: number;
  panY: number;
  zoom: number;

  // Undo/redo
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];

  // Actions
  loadWhiteboards: () => Promise<void>;
  /** Pull whiteboards from Supabase, merge into local IDB + in-memory
   *  list. Called after sign-in. Cloud wins on conflict. */
  syncFromCloud: () => Promise<void>;
  /** Drop the in-memory listing on sign-out so the next account never
   *  sees the previous user's whiteboards. IDB is wiped separately. */
  clearLocal: () => void;
  createWhiteboard: (opts?: { bookId?: string; title?: string; folderId?: string | null }) => string;
  /** Most recent cloud-sync error (quota, network). Cleared by the
   *  UI when acknowledged. */
  lastSyncError: string | null;
  deleteWhiteboard: (id: string) => void;
  /** Move a whiteboard into a library folder (or null for root).
   *  Updates the jsonb blob locally + pushes to the cloud. */
  moveWhiteboardToFolder: (id: string, folderId: string | null) => void;
  loadWhiteboardData: (id: string) => Promise<void>;
  saveCurrentWhiteboard: () => void;
  /** Debounced save (coalesces rapid drag updates). */
  scheduleSave: () => void;
  /** Cancel any pending debounced save and persist immediately. */
  flushSave: () => void;

  addElement: (el: WhiteboardElement) => void;
  updateElement: (id: string, patch: Partial<WhiteboardElement>) => void;
  removeElements: (ids: string[]) => void;
  /** Delete elements WITHOUT snapshotting undo. The smart eraser calls
   *  this repeatedly across one drag and pushes a single undo entry
   *  itself, so the whole sweep undoes in one step. */
  eraseElements: (ids: string[]) => void;

  setActiveTool: (tool: WhiteboardTool) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setBackground: (bg: WhiteboardBackground) => void;

  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;

  setPan: (x: number, y: number) => void;
  setZoom: (zoom: number, focalPoint?: Point) => void;

  loadPdfBackground: (fileUrl: string) => Promise<void>;
  /** Rasterize the given (visible + margin) pages and evict far ones. */
  ensurePdfPages: (pageNums: number[]) => void;
  clearPdfBackground: () => void;

  undo: () => void;
  redo: () => void;
  pushUndo: () => void;
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  whiteboards: [],
  activeWhiteboardId: null,
  elements: [],
  background: "solid",

  pdfPages: [],
  pdfLoading: false,
  pdfLoadProgress: null,

  activeTool: "pen",
  // Default to black: nearly every PDF has a white-ish background,
  // so a white stroke would be invisible on the common case. Users
  // can pick any other color from the toolbar palette for dark scans.
  strokeColor: "#000000",
  strokeWidth: 2,

  selectedElementIds: new Set(),

  panX: 0,
  panY: 0,
  zoom: 1,

  undoStack: [],
  redoStack: [],
  lastSyncError: null,

  async loadWhiteboards() {
    const wbs = await loadAllWhiteboards();
    wbs.sort((a, b) => b.updatedAt - a.updatedAt);
    set({ whiteboards: wbs });
  },

  async syncFromCloud() {
    try {
      const cloud = await pullAllWhiteboards();
      if (cloud.length === 0) return;
      // Cloud wins on id collision. Write each to IDB so local stays
      // the cache of record, then refresh the in-memory list from
      // the merged IDB state.
      for (const wb of cloud) {
        dbSaveWhiteboard(wb);
      }
      const merged = await loadAllWhiteboards();
      merged.sort((a, b) => b.updatedAt - a.updatedAt);
      set({ whiteboards: merged });
    } catch (err) {
      logError("whiteboard-store:syncFromCloud", err);
    }
  },

  clearLocal() {
    set({ whiteboards: [], activeWhiteboardId: null, elements: [] });
  },

  createWhiteboard(opts?: { bookId?: string; title?: string; folderId?: string | null }) {
    const wb: WhiteboardData = {
      id: crypto.randomUUID(),
      // Left blank on purpose: the display name is derived from the
      // first text element on the canvas (or a date stamp) by
      // whiteboardDisplayTitle, so identical placeholders never pile
      // up in the library. Whiteboards have no rename UI, so nothing
      // relies on this being non-empty.
      title: opts?.title ?? "",
      elements: [],
      background: "solid",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      bookId: opts?.bookId,
      folderId: opts?.folderId ?? null,
    };
    set((s) => ({ whiteboards: [wb, ...s.whiteboards] }));
    dbSaveWhiteboard(wb);
    // Fire-and-forget cloud push. Quota errors surface on
    // `lastSyncError` so the UI can tell the user.
    pushWhiteboard(wb).then((err) => {
      if (err?.kind === "quota") {
        set({ lastSyncError: "quota" });
      }
    });
    return wb.id;
  },

  deleteWhiteboard(id) {
    set((s) => ({
      whiteboards: s.whiteboards.filter((w) => w.id !== id),
      ...(s.activeWhiteboardId === id
        ? { activeWhiteboardId: null, elements: [], undoStack: [], redoStack: [] }
        : {}),
    }));
    dbDeleteWhiteboard(id);
    deleteWhiteboardCloud(id);
  },

  moveWhiteboardToFolder(id, folderId) {
    const existing = get().whiteboards.find((w) => w.id === id);
    if (!existing || (existing.folderId ?? null) === folderId) return;
    const wb: WhiteboardData = {
      ...existing,
      folderId,
      updatedAt: Date.now(),
    };
    set((s) => ({
      whiteboards: s.whiteboards.map((w) => (w.id === id ? wb : w)),
    }));
    dbSaveWhiteboard(wb);
    // Fire-and-forget cloud push, folder placement is a metadata
    // edit, so it can't trip the insert-only quota trigger.
    void pushWhiteboard(wb);
  },

  async loadWhiteboardData(id) {
    // Persist any pending debounced changes to the previous board first.
    get().flushSave();
    const wb = await loadWhiteboard(id);
    if (wb) {
      set({
        activeWhiteboardId: id,
        elements: wb.elements,
        background: wb.background,
        selectedElementIds: new Set(),
        panX: 0,
        panY: 0,
        zoom: 1,
        undoStack: [],
        redoStack: [],
      });
    }
  },

  saveCurrentWhiteboard() {
    const { activeWhiteboardId, elements, background, whiteboards } = get();
    if (!activeWhiteboardId) return;

    const existing = whiteboards.find((w) => w.id === activeWhiteboardId);
    const wb: WhiteboardData = {
      id: activeWhiteboardId,
      title: existing?.title ?? "",
      elements,
      background,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      // Preserve scope: dropping bookId here would orphan a
      // book-scoped whiteboard back into the global workspace list
      // on the very next save. Same for folderId, a save mustn't
      // bounce the whiteboard out of its library folder.
      bookId: existing?.bookId,
      folderId: existing?.folderId ?? null,
    };
    dbSaveWhiteboard(wb);
    // Fire-and-forget cloud push. Quota errors can fire on the very
    // first save of a new whiteboard (the upsert hits INSERT); later
    // saves are UPDATEs which skip the quota trigger.
    pushWhiteboard(wb).then((err) => {
      if (err?.kind === "quota") {
        set({ lastSyncError: "quota" });
      }
    });

    set((s) => ({
      whiteboards: s.whiteboards.map((w) =>
        w.id === activeWhiteboardId ? wb : w,
      ),
    }));
  },

  scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      get().saveCurrentWhiteboard();
    }, SAVE_DEBOUNCE_MS);
  },

  flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    get().saveCurrentWhiteboard();
  },

  pushUndo() {
    const { elements, background, undoStack } = get();
    const next = [...undoStack, { elements: [...elements], background }];
    // Cap history so a long editing session can't grow memory unbounded.
    if (next.length > MAX_UNDO) next.splice(0, next.length - MAX_UNDO);
    set({ undoStack: next, redoStack: [] });
  },

  addElement(el) {
    get().pushUndo();
    set((s) => ({ elements: [...s.elements, el] }));
    get().saveCurrentWhiteboard();
  },

  updateElement(id, patch) {
    set((s) => ({
      elements: s.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as WhiteboardElement) : el,
      ),
    }));
    // Debounced: updateElement fires on every pointer-move during a drag.
    get().scheduleSave();
  },

  removeElements(ids) {
    if (ids.length === 0) return;
    get().pushUndo();
    const idSet = new Set(ids);
    set((s) => ({
      elements: s.elements.filter((el) => !idSet.has(el.id)),
      selectedElementIds: new Set(
        [...s.selectedElementIds].filter((id) => !idSet.has(id)),
      ),
    }));
    get().saveCurrentWhiteboard();
  },

  eraseElements(ids) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    set((s) => ({
      elements: s.elements.filter((el) => !idSet.has(el.id)),
      selectedElementIds: new Set(
        [...s.selectedElementIds].filter((id) => !idSet.has(id)),
      ),
    }));
    get().scheduleSave();
  },

  setActiveTool(tool) {
    set({ activeTool: tool, selectedElementIds: new Set() });
  },

  setStrokeColor(color) {
    set({ strokeColor: color });
  },

  setStrokeWidth(width) {
    set({ strokeWidth: width });
  },

  setBackground(bg) {
    get().pushUndo();
    set({ background: bg });
    get().saveCurrentWhiteboard();
  },

  setSelection(ids) {
    set({ selectedElementIds: ids });
  },

  clearSelection() {
    set({ selectedElementIds: new Set() });
  },

  setPan(x, y) {
    set({ panX: x, panY: y });
  },

  setZoom(newZoom, focalPoint) {
    const clamped = Math.max(0.1, Math.min(5, newZoom));
    if (focalPoint) {
      const { panX, panY, zoom } = get();
      // World point under cursor stays fixed
      const worldX = (focalPoint.x - panX) / zoom;
      const worldY = (focalPoint.y - panY) / zoom;
      set({
        zoom: clamped,
        panX: focalPoint.x - worldX * clamped,
        panY: focalPoint.y - worldY * clamped,
      });
    } else {
      set({ zoom: clamped });
    }
  },

  async loadPdfBackground(fileUrl) {
    set({ pdfLoading: true, pdfLoadProgress: "Loading PDF..." });
    try {
      const doc = await loadPdfDocument(fileUrl);
      pdfDocRef = doc;
      // Downscale long books a touch; combined with lazy windowing this keeps
      // memory roughly flat regardless of page count.
      pdfScaleRef = doc.numPages > 40 ? 1.0 : 1.5;

      // Lay out every page up front from cheap geometry (no rasterization).
      const layouts = await getPageLayouts(doc, pdfScaleRef);
      const PAGE_GAP = 20;
      let yOffset = 0;
      const pdfPages: PdfBackgroundPage[] = layouts.map((l) => {
        const page: PdfBackgroundPage = {
          pageNum: l.pageNum,
          bitmap: null,
          width: l.width,
          height: l.height,
          y: yOffset,
        };
        yOffset += l.height + PAGE_GAP;
        return page;
      });

      set({ pdfPages, pdfLoading: false, pdfLoadProgress: null });
    } catch (err) {
      logError("whiteboard-store:loadPdfBackground", err);
      set({ pdfLoading: false, pdfLoadProgress: null });
    }
  },

  ensurePdfPages(pageNums) {
    const doc = pdfDocRef;
    if (!doc) return;
    const keep = new Set(pageNums);
    const pages = get().pdfPages;

    // Rasterize requested pages that aren't ready (or already in flight).
    for (const n of pageNums) {
      const page = pages.find((p) => p.pageNum === n);
      if (!page || page.bitmap || pdfRenderInFlight.has(n)) continue;
      pdfRenderInFlight.add(n);
      renderSinglePage(doc, n, pdfScaleRef)
        .then((bitmap) => {
          pdfRenderInFlight.delete(n);
          // Board switched/closed mid-render, drop the orphan bitmap.
          if (pdfDocRef !== doc) {
            bitmap.close();
            return;
          }
          set((s) => ({
            pdfPages: s.pdfPages.map((p) =>
              p.pageNum === n ? { ...p, bitmap } : p,
            ),
          }));
        })
        .catch(() => pdfRenderInFlight.delete(n));
    }

    // Evict rasterized pages outside the window once we exceed the cap.
    const renderedCount = pages.filter((p) => p.bitmap).length;
    if (renderedCount > MAX_RENDERED_PAGES) {
      const evictable = pages.filter((p) => p.bitmap && !keep.has(p.pageNum));
      if (evictable.length > 0) {
        for (const p of evictable) p.bitmap?.close();
        const evict = new Set(evictable.map((p) => p.pageNum));
        set((s) => ({
          pdfPages: s.pdfPages.map((p) =>
            evict.has(p.pageNum) ? { ...p, bitmap: null } : p,
          ),
        }));
      }
    }
  },

  clearPdfBackground() {
    for (const p of get().pdfPages) p.bitmap?.close();
    pdfRenderInFlight.clear();
    if (pdfDocRef) {
      void pdfDocRef.destroy();
      pdfDocRef = null;
    }
    set({ pdfPages: [] });
  },

  undo() {
    const { undoStack, elements, background } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, { elements: [...elements], background }],
      elements: prev.elements,
      background: prev.background,
      selectedElementIds: new Set(),
    }));
    get().saveCurrentWhiteboard();
  },

  redo() {
    const { redoStack, elements, background } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, { elements: [...elements], background }],
      elements: next.elements,
      background: next.background,
      selectedElementIds: new Set(),
    }));
    get().saveCurrentWhiteboard();
  },
}));
