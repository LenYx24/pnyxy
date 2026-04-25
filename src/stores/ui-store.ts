import { create } from "zustand";

const DOCKVIEW_LAYOUT_KEY = "pnyxy-reader:dockview-layout";

type MobileReaderPanel = "none" | "toc" | "comments" | "aiChat";

interface UIState {
  sidebarCollapsed: boolean;
  readerSidebarCollapsed: boolean;
  isLoadingDocument: boolean;
  loadingMessage: string;
  mobileSidebarOpen: boolean;
  mobileReaderPanel: MobileReaderPanel;
  /** Reader-only "zen" mode: hides toolbar, dockview panels, and all
   *  surrounding chrome. The active viewer fills the screen. */
  zenMode: boolean;
  /** Mobile reader: when true, the toolbar slides out of view so the
   *  PDF takes the full screen. A tap on the viewer area toggles it
   *  back — ReadEra / Apple Books pattern. Session-only; not
   *  persisted (always resets to visible on a fresh open). */
  mobileChromeHidden: boolean;
  /** Reader's "open from library" picker modal. */
  libraryPickerOpen: boolean;
  setLibraryPickerOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleReaderSidebar: () => void;
  setLoading: (loading: boolean, message?: string) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setMobileReaderPanel: (panel: MobileReaderPanel) => void;
  toggleZenMode: () => void;
  setZenMode: (on: boolean) => void;
  toggleMobileChromeHidden: () => void;
  setMobileChromeHidden: (hidden: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  readerSidebarCollapsed: false,
  isLoadingDocument: false,
  loadingMessage: "",
  mobileSidebarOpen: false,
  mobileReaderPanel: "none",
  zenMode: false,
  mobileChromeHidden: false,
  libraryPickerOpen: false,
  setLibraryPickerOpen: (open) => set({ libraryPickerOpen: open }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleReaderSidebar: () =>
    set((state) => ({ readerSidebarCollapsed: !state.readerSidebarCollapsed })),
  setLoading: (loading, message = "") =>
    set({ isLoadingDocument: loading, loadingMessage: message }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
  setMobileReaderPanel: (panel) => set({ mobileReaderPanel: panel }),
  toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode })),
  setZenMode: (on) => set({ zenMode: on }),
  toggleMobileChromeHidden: () =>
    set((s) => ({ mobileChromeHidden: !s.mobileChromeHidden })),
  setMobileChromeHidden: (hidden) => set({ mobileChromeHidden: hidden }),
}));

export function saveDockviewLayout(layout: object) {
  try {
    localStorage.setItem(DOCKVIEW_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Strip panels that no longer exist (e.g. the old `search` dockview
 * panel, replaced by the floating SearchOverlay) from a persisted
 * layout so dockview doesn't choke on unregistered components.
 */
function sanitizeDockviewLayout(layout: unknown): object | null {
  if (!layout || typeof layout !== "object") return null;
  const root = layout as {
    panels?: Record<string, unknown>;
    grid?: { root?: unknown };
  };

  if (root.panels && typeof root.panels === "object") {
    for (const key of Object.keys(root.panels)) {
      if (key === "search") {
        delete root.panels[key];
      }
    }
  }

  const stripGridNode = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      data?: unknown;
      activeView?: string;
      views?: unknown;
    };
    if (n.type === "branch" && Array.isArray(n.data)) {
      for (const child of n.data) stripGridNode(child);
    } else if (n.type === "leaf" && n.data && typeof n.data === "object") {
      const leaf = n.data as {
        views?: unknown[];
        activeView?: string;
      };
      if (Array.isArray(leaf.views)) {
        leaf.views = leaf.views.filter((v) => v !== "search");
        if (leaf.activeView === "search") leaf.activeView = leaf.views[0] as string | undefined;
      }
    }
  };
  if (root.grid && typeof root.grid === "object") {
    stripGridNode((root.grid as { root?: unknown }).root);
  }

  return root;
}

export function loadDockviewLayout(): object | null {
  try {
    const raw = localStorage.getItem(DOCKVIEW_LAYOUT_KEY);
    if (raw) return sanitizeDockviewLayout(JSON.parse(raw));
  } catch {
    // corrupted data
  }
  return null;
}
