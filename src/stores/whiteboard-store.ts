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
import { renderPdfPages } from "@/features/whiteboard/lib/pdf-renderer";

interface UndoEntry {
  elements: WhiteboardElement[];
  background: WhiteboardBackground;
}

export interface PdfBackgroundPage {
  bitmap: ImageBitmap;
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
  createWhiteboard: (opts?: { bookId?: string; title?: string }) => string;
  /** Most recent cloud-sync error (quota, network). Cleared by the
   *  UI when acknowledged. */
  lastSyncError: string | null;
  deleteWhiteboard: (id: string) => void;
  loadWhiteboardData: (id: string) => Promise<void>;
  saveCurrentWhiteboard: () => void;

  addElement: (el: WhiteboardElement) => void;
  updateElement: (id: string, patch: Partial<WhiteboardElement>) => void;
  removeElements: (ids: string[]) => void;

  setActiveTool: (tool: WhiteboardTool) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setBackground: (bg: WhiteboardBackground) => void;

  setSelection: (ids: Set<string>) => void;
  clearSelection: () => void;

  setPan: (x: number, y: number) => void;
  setZoom: (zoom: number, focalPoint?: Point) => void;

  loadPdfBackground: (fileUrl: string) => Promise<void>;
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

  createWhiteboard(opts?: { bookId?: string; title?: string }) {
    const wb: WhiteboardData = {
      id: crypto.randomUUID(),
      title: opts?.title ?? "Untitled Whiteboard",
      elements: [],
      background: "solid",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      bookId: opts?.bookId,
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

  async loadWhiteboardData(id) {
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
      title: existing?.title ?? "Untitled Whiteboard",
      elements,
      background,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
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

  pushUndo() {
    const { elements, background, undoStack } = get();
    set({
      undoStack: [...undoStack, { elements: [...elements], background }],
      redoStack: [],
    });
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
    get().saveCurrentWhiteboard();
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
      const pages = await renderPdfPages(fileUrl, 1.5, (loaded, total) => {
        set({ pdfLoadProgress: `Rendering page ${loaded}/${total}...` });
      });

      // Layout pages vertically with gap
      const PAGE_GAP = 20;
      let yOffset = 0;
      const pdfPages: PdfBackgroundPage[] = pages.map((p) => {
        const page: PdfBackgroundPage = {
          bitmap: p.bitmap,
          width: p.width,
          height: p.height,
          y: yOffset,
        };
        yOffset += p.height + PAGE_GAP;
        return page;
      });

      set({ pdfPages, pdfLoading: false, pdfLoadProgress: null });
    } catch (err) {
      logError("whiteboard-store:loadPdfBackground", err);
      set({ pdfLoading: false, pdfLoadProgress: null });
    }
  },

  clearPdfBackground() {
    const { pdfPages } = get();
    for (const p of pdfPages) {
      p.bitmap.close();
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
