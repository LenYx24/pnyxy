import { create } from "zustand";

const DOCKVIEW_LAYOUT_KEY = "pnyxy-reader:dockview-layout";

interface UIState {
  sidebarCollapsed: boolean;
  readerSidebarCollapsed: boolean;
  isLoadingDocument: boolean;
  loadingMessage: string;
  toggleSidebar: () => void;
  toggleReaderSidebar: () => void;
  setLoading: (loading: boolean, message?: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  readerSidebarCollapsed: false,
  isLoadingDocument: false,
  loadingMessage: "",
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleReaderSidebar: () =>
    set((state) => ({ readerSidebarCollapsed: !state.readerSidebarCollapsed })),
  setLoading: (loading, message = "") =>
    set({ isLoadingDocument: loading, loadingMessage: message }),
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
