import { create } from "zustand";
import type { ChatMessageAttachment } from "@/types/chat";

// v2 suffix invalidates old layouts where the TOC was saved as a tab inside the viewer group.
const DOCKVIEW_LAYOUT_KEY = "pnyxy-reader:dockview-layout:v2";

type MobileReaderPanel = "none" | "toc" | "comments" | "aiChat";

interface UIState {
  sidebarCollapsed: boolean;
  readerSidebarCollapsed: boolean;
  isLoadingDocument: boolean;
  loadingMessage: string;
  mobileSidebarOpen: boolean;
  mobileReaderPanel: MobileReaderPanel;
  /** Reader zen mode: hide toolbar, panels, and all surrounding chrome. */
  zenMode: boolean;
  /** Mobile reader: toolbar slides out so the PDF fills the screen; tap toggles back. Session-only. */
  mobileChromeHidden: boolean;
  libraryPickerOpen: boolean;
  setLibraryPickerOpen: (open: boolean) => void;
  /** Opener the reader registers so other components can open the in-reader AI chat panel. Null when no reader is mounted. */
  openReaderAiChat: (() => void) | null;
  setOpenReaderAiChat: (open: (() => void) | null) => void;
  /** Opener that jumps to the thumbnail-TOC with page-selection mode on, for the AI chat's "Customize context". */
  openAiContextEditor: (() => void) | null;
  setOpenAiContextEditor: (open: (() => void) | null) => void;
  /** Whether ThumbnailToc is in page-selection mode; lifted here so the AI chat panel can flip it remotely. */
  aiContextSelectionMode: boolean;
  setAiContextSelectionMode: (on: boolean) => void;
  /** Reader mounts a rect selector while true; on capture the bitmap lands in pendingChatAttachments and this flips false. */
  aiRectCaptureActive: boolean;
  setAiRectCaptureActive: (on: boolean) => void;
  /** Queue for images to attach to the chat composer; consumePendingChatAttachments drains it so nothing gets injected twice. */
  pendingChatAttachments: ChatMessageAttachment[];
  pushChatAttachment: (att: ChatMessageAttachment) => void;
  consumePendingChatAttachments: () => ChatMessageAttachment[];
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleReaderSidebar: () => void;
  setReaderSidebarCollapsed: (collapsed: boolean) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setMobileReaderPanel: (panel: MobileReaderPanel) => void;
  toggleZenMode: () => void;
  setZenMode: (on: boolean) => void;
  toggleMobileChromeHidden: () => void;
  setMobileChromeHidden: (hidden: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  // nav rail starts expanded so new users can read the labels and learn
  // the app's surfaces; not persisted, so every load opens expanded
  // (the reader route still auto-collapses it via AppLayout).
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
  openReaderAiChat: null,
  setOpenReaderAiChat: (open) => set({ openReaderAiChat: open }),
  openAiContextEditor: null,
  setOpenAiContextEditor: (open) => set({ openAiContextEditor: open }),
  aiContextSelectionMode: false,
  setAiContextSelectionMode: (on) => set({ aiContextSelectionMode: on }),
  aiRectCaptureActive: false,
  setAiRectCaptureActive: (on) => set({ aiRectCaptureActive: on }),
  pendingChatAttachments: [],
  pushChatAttachment: (att) =>
    set((s) => ({ pendingChatAttachments: [...s.pendingChatAttachments, att] })),
  consumePendingChatAttachments: () => {
    const queue = get().pendingChatAttachments;
    if (queue.length === 0) return [];
    set({ pendingChatAttachments: [] });
    return queue;
  },
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleReaderSidebar: () =>
    set((state) => ({ readerSidebarCollapsed: !state.readerSidebarCollapsed })),
  setReaderSidebarCollapsed: (collapsed) =>
    set({ readerSidebarCollapsed: collapsed }),
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

// Drop panels dockview no longer has components for (the old `search` panel) so restore doesn't choke.
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
  // clear the legacy v1 key so it doesn't linger in localStorage.
  try {
    localStorage.removeItem("pnyxy-reader:dockview-layout");
  } catch {
    // ignore
  }
  try {
    const raw = localStorage.getItem(DOCKVIEW_LAYOUT_KEY);
    if (raw) return sanitizeDockviewLayout(JSON.parse(raw));
  } catch {
    // corrupted data
  }
  return null;
}
