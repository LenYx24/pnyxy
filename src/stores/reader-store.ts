import { create } from "zustand";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";

export type ZoomMode = "fit-width" | "fit-page" | "custom";

const ZOOM_STEP = 15;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;

interface ReaderState {
  adapter: DocumentAdapter | null;
  meta: DocumentMeta | null;
  toc: TocItem[];
  currentPage: number;
  totalPages: number;
  zoomMode: ZoomMode;
  zoomLevel: number;
  scrollToPage: number | null;

  openDocument: (adapter: DocumentAdapter, file: File) => Promise<void>;
  closeDocument: () => void;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoomMode: (mode: ZoomMode) => void;
  setZoomLevel: (level: number) => void;
  setCurrentPage: (page: number) => void;
  requestScrollToPage: (page: number) => void;
  clearScrollRequest: () => void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  adapter: null,
  meta: null,
  toc: [],
  currentPage: 1,
  totalPages: 0,
  zoomMode: "fit-width",
  zoomLevel: 100,
  scrollToPage: null,

  async openDocument(adapter, file) {
    const prev = get().adapter;
    if (prev) prev.dispose();

    const meta = await adapter.load(file);
    const toc = await adapter.extractToc();

    set({
      adapter,
      meta,
      toc,
      currentPage: 1,
      totalPages: meta.totalPages,
      zoomMode: "fit-width",
      zoomLevel: 100,
      scrollToPage: null,
    });
  },

  closeDocument() {
    const { adapter } = get();
    if (adapter) adapter.dispose();
    set({
      adapter: null,
      meta: null,
      toc: [],
      currentPage: 1,
      totalPages: 0,
      zoomMode: "fit-width",
      zoomLevel: 100,
      scrollToPage: null,
    });
  },

  goToPage(page) {
    const { totalPages } = get();
    const clamped = Math.min(Math.max(page, 1), totalPages);
    if (totalPages > 0) {
      set({ currentPage: clamped, scrollToPage: clamped });
    }
  },

  nextPage() {
    const { currentPage, totalPages } = get();
    const next = Math.min(currentPage + 1, totalPages);
    if (next !== currentPage) {
      set({ currentPage: next, scrollToPage: next });
    }
  },

  prevPage() {
    const { currentPage } = get();
    const prev = Math.max(currentPage - 1, 1);
    if (prev !== currentPage) {
      set({ currentPage: prev, scrollToPage: prev });
    }
  },

  zoomIn() {
    const { zoomLevel } = get();
    const next = Math.min(zoomLevel + ZOOM_STEP, ZOOM_MAX);
    set({ zoomLevel: next, zoomMode: "custom" });
  },

  zoomOut() {
    const { zoomLevel } = get();
    const next = Math.max(zoomLevel - ZOOM_STEP, ZOOM_MIN);
    set({ zoomLevel: next, zoomMode: "custom" });
  },

  setZoomMode(mode) {
    set({ zoomMode: mode });
  },

  setZoomLevel(level) {
    set({ zoomLevel: Math.min(Math.max(level, ZOOM_MIN), ZOOM_MAX), zoomMode: "custom" });
  },

  setCurrentPage(page) {
    set({ currentPage: page });
  },

  requestScrollToPage(page) {
    const { totalPages } = get();
    if (page >= 1 && page <= totalPages) {
      set({ scrollToPage: page });
    }
  },

  clearScrollRequest() {
    set({ scrollToPage: null });
  },
}));
