import { create } from "zustand";
import type { ChatMessageAttachment } from "@/types/chat";

// Bumped key suffix when the dockview swap semantics changed (the
// "draw mode" toggle bug fix). Old saved layouts could have the TOC
// living as a tab inside the viewer's group instead of its own
// left-side panel — restoring that JSON would re-create the bug. The
// version bump invalidates those layouts so users get a clean
// default on first load after the upgrade.
const DOCKVIEW_LAYOUT_KEY = "pnyxy-reader:dockview-layout:v2";

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
  /**
   * Function the reader registers on mount so other components
   * (currently the annotation context menu's "Send to AI") can open
   * the in-reader AI chat side panel without coupling to the reader's
   * internals (Dockview API on desktop, mobile slide-over state on
   * mobile). Null when no reader is mounted, in which case callers
   * should fall back to navigating to /chat.
   */
  openReaderAiChat: (() => void) | null;
  setOpenReaderAiChat: (open: (() => void) | null) => void;
  /**
   * Sibling of `openReaderAiChat` for the inverse direction — the AI
   * chat panel registers nothing here; the reader's sidebar mounts
   * an opener that navigates to the thumbnail-TOC view with page-
   * selection mode pre-enabled. Lets the AI chat panel surface a
   * "Customize context" button without depending on dockview /
   * mobile-panel state directly.
   */
  openAiContextEditor: (() => void) | null;
  setOpenAiContextEditor: (open: (() => void) | null) => void;
  /**
   * Whether the ThumbnailToc is in page-selection mode. Lifted out
   * of ThumbnailToc's local state so the "Customize context" button
   * in the AI chat panel can flip it on remotely, and so a future
   * "edit context from here" link from any surface can land the
   * user in the right place without prop-drilling.
   */
  aiContextSelectionMode: boolean;
  setAiContextSelectionMode: (on: boolean) => void;
  /**
   * "Capture a rectangle from the page and send it to the AI."
   * The reader watches this flag and mounts the rect selector when
   * true; on a successful capture the bitmap goes into
   * `pendingChatAttachments` and the flag flips back to false. The
   * existing download-style rect screenshot stays on its own flag —
   * the same selector overlay would be confusing if both modes
   * shared one trigger.
   */
  aiRectCaptureActive: boolean;
  setAiRectCaptureActive: (on: boolean) => void;
  /**
   * Cross-component drop point for "an image is ready, please
   * attach it to the chat composer." ReaderPage's rect-to-AI flow
   * pushes here; AiChatPanel reads this and forwards into the
   * composer's imperative `addAttachments` handle. Acts as a queue —
   * `consumePendingChatAttachments` drains and returns the list so
   * the same attachment never gets injected twice.
   */
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
  // Start collapsed by default — the nav rail spends most of its time
  // out of the way; users expand it (Menu button / Ctrl+B) when they
  // need labels. Not persisted, so every load opens collapsed.
  sidebarCollapsed: true,
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
  // Sweep the legacy key one time so users on the v1 layout don't
  // keep a stale entry hanging around in localStorage forever.
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
