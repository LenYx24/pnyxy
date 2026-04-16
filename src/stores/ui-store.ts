import { create } from "zustand";

const DOCKVIEW_LAYOUT_KEY = "pnyxy-reader:dockview-layout";

type MobileReaderPanel = "none" | "toc" | "comments" | "search" | "aiChat";

interface UIState {
  sidebarCollapsed: boolean;
  readerSidebarCollapsed: boolean;
  isLoadingDocument: boolean;
  loadingMessage: string;
  mobileSidebarOpen: boolean;
  mobileReaderPanel: MobileReaderPanel;
  toggleSidebar: () => void;
  toggleReaderSidebar: () => void;
  setLoading: (loading: boolean, message?: string) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setMobileReaderPanel: (panel: MobileReaderPanel) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  readerSidebarCollapsed: false,
  isLoadingDocument: false,
  loadingMessage: "",
  mobileSidebarOpen: false,
  mobileReaderPanel: "none",
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleReaderSidebar: () =>
    set((state) => ({ readerSidebarCollapsed: !state.readerSidebarCollapsed })),
  setLoading: (loading, message = "") =>
    set({ isLoadingDocument: loading, loadingMessage: message }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setMobileReaderPanel: (panel) => set({ mobileReaderPanel: panel }),
}));

export function saveDockviewLayout(layout: object) {
  try {
    localStorage.setItem(DOCKVIEW_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // localStorage full or unavailable
  }
}

export function loadDockviewLayout(): object | null {
  try {
    const raw = localStorage.getItem(DOCKVIEW_LAYOUT_KEY);
    if (raw) return JSON.parse(raw) as object;
  } catch {
    // corrupted data
  }
  return null;
}
