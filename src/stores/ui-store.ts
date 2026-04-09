import { create } from "zustand";

const DOCKVIEW_LAYOUT_KEY = "pnyxy-reader:dockview-layout";

interface UIState {
  sidebarCollapsed: boolean;
  readerSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  toggleReaderSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  readerSidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleReaderSidebar: () =>
    set((state) => ({ readerSidebarCollapsed: !state.readerSidebarCollapsed })),
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
