import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { DockviewApi, DockviewReadyEvent } from "dockview";
import i18n from "@/lib/i18n";
import { useNoteStore } from "@/stores/note-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import {
  useUIStore,
  saveDockviewLayout,
  loadDockviewLayout,
} from "@/stores/ui-store";
import { loadTocWidth, saveTocWidth } from "@/lib/annotation-storage";
import type { TocItem } from "@/types/document";

export interface ReaderDockPanels {
  openNote: (noteId: string) => void;
  createNote: () => void;
  openWhiteboard: (whiteboardId: string) => void;
  createWhiteboard: () => void;
  deleteNote: (noteId: string) => void;
  deleteWhiteboard: (whiteboardId: string) => void;
}

/**
 * Note / whiteboard dockview-panel open/create/delete logic, shared by
 * the reader's left TOC-panel launcher and the right tools-panel tabs.
 * Every editor opens as a panel to the right of the viewer; opening an
 * already-open note/whiteboard just re-activates its panel.
 */
export function useReaderDockPanels(
  // undefined on the mobile tools panel, which never renders the
  // note/whiteboard tabs, the handlers just no-op there.
  dockviewApi: DockviewApi | undefined,
): ReaderDockPanels {
  const openNote = useCallback(
    (noteId: string) => {
      if (!dockviewApi) return;
      const panelId = `note-${noteId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
        return;
      }
      dockviewApi.addPanel({
        id: panelId,
        component: "note",
        title: i18n.t("reader.page.panelNote"),
        params: { noteId },
        position: { direction: "right" },
      });
    },
    [dockviewApi],
  );

  const createNote = useCallback(() => {
    if (!dockviewApi) return;
    const noteId = useNoteStore.getState().createNote();
    const panelId = `note-${noteId}`;
    dockviewApi.addPanel({
      id: panelId,
      component: "note",
      title: i18n.t("reader.page.panelNewNote"),
      params: { noteId },
      position: { direction: "right" },
    });
  }, [dockviewApi]);

  const openWhiteboard = useCallback(
    (whiteboardId: string) => {
      if (!dockviewApi) return;
      const panelId = `whiteboard-${whiteboardId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
        return;
      }
      dockviewApi.addPanel({
        id: panelId,
        component: "whiteboard",
        title: i18n.t("reader.page.panelWhiteboard"),
        params: { whiteboardId },
        position: { direction: "right" },
      });
    },
    [dockviewApi],
  );

  const createWhiteboard = useCallback(() => {
    if (!dockviewApi) return;
    const activeDoc = useReaderStore.getState().getActiveDoc();
    const allowAll = useSettingsStore.getState()
      .experimental_allowWhiteboardForAllFormats;
    if (activeDoc && !activeDoc.meta.capabilities.paginated && !allowAll) {
      return;
    }
    // Tag the new whiteboard with the active doc so the reader can filter
    // to "this book only"; without it every reader-created whiteboard
    // would show up across every other book.
    const activeDocId = useReaderStore.getState().activeDocumentId ?? undefined;
    const whiteboardId = useWhiteboardStore
      .getState()
      .createWhiteboard({ bookId: activeDocId });
    const panelId = `whiteboard-${whiteboardId}`;
    dockviewApi.addPanel({
      id: panelId,
      component: "whiteboard",
      title: i18n.t("reader.page.panelNewWhiteboard"),
      params: { whiteboardId },
      position: { direction: "right" },
    });
  }, [dockviewApi]);

  const deleteNote = useCallback(
    (noteId: string) => {
      if (!dockviewApi) return;
      const existing = dockviewApi.getPanel(`note-${noteId}`);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  const deleteWhiteboard = useCallback(
    (whiteboardId: string) => {
      if (!dockviewApi) return;
      const existing = dockviewApi.getPanel(`whiteboard-${whiteboardId}`);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  return {
    openNote,
    createNote,
    openWhiteboard,
    createWhiteboard,
    deleteNote,
    deleteWhiteboard,
  };
}

// ---------------------------------------------------------------------------
// Reader page dockview layout: initial layout + persistence, and the
// toggles for the fixed panels (toc / comments / aiChat).
// ---------------------------------------------------------------------------

function flattenToc(items: TocItem[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    result.push(item.title);
    if (item.children.length) result.push(...flattenToc(item.children));
  }
  return result;
}

function computeTocWidth(toc: TocItem[]): number {
  const titles = flattenToc(toc);
  if (titles.length === 0) return 200;
  const sorted = titles.map((t) => t.length).sort((a, b) => b - a);
  const top3 = sorted.slice(0, 3);
  const avg = top3.reduce((sum, l) => sum + l, 0) / top3.length;
  const width = avg * 7.5 + 48;
  return Math.round(Math.min(Math.max(width, 180), 400));
}

export interface ReaderDockLayoutArgs {
  dockviewApiRef: RefObject<DockviewApi | null>;
  isMobile: boolean;
  /** Called when a restored layout already has the draw-mode whiteboard active. */
  onRestoredDrawMode: () => void;
}

export interface ReaderDockLayout {
  handleDockviewReady: (event: DockviewReadyEvent) => void;
  toggleSidebar: () => void;
  toggleComments: () => void;
  toggleAiChat: () => void;
}

export function useReaderDockLayout({
  dockviewApiRef,
  isMobile,
  onRestoredDrawMode,
}: ReaderDockLayoutArgs): ReaderDockLayout {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tocWidthRef = useRef<number>(256);
  // Default AI chat panel width, remembered across close/reopen. Small screens
  // take ~42% of viewport (capped 300-500); wide monitors get 320.
  const aiChatWidthRef = useRef<number>(
    typeof window !== "undefined" && window.innerWidth < 1280
      ? Math.max(300, Math.min(500, Math.floor(window.innerWidth * 0.42)))
      : 320,
  );

  const toggleSidebar = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    // Snapshot the AI-chat width first. Dockview redistributes freed space
    // proportionally, so pin the chat and let the viewer absorb the TOC's space.
    const aiChatBefore = api.getPanel("aiChat");
    const aiChatW = aiChatBefore?.api.width ?? null;

    const tocPanel = api.getPanel("toc");
    if (tocPanel) {
      api.removePanel(tocPanel);
    } else {
      api.addPanel({
        id: "toc",
        component: "toc",
        title: i18n.t("reader.page.panelToc"),
        position: { direction: "left" },
        initialWidth: tocWidthRef.current,
        minimumWidth: 180,
        maximumWidth: 400,
      });
    }

    // Restore chat width once dockview settles; the delta comes from the viewer sibling.
    if (aiChatW != null && aiChatW > 0) {
      requestAnimationFrame(() => {
        const c = api.getPanel("aiChat");
        if (c && Math.abs(c.api.width - aiChatW) > 1) {
          c.api.setSize({ width: aiChatW });
        }
      });
    }
  }, [dockviewApiRef]);

  // Pin the AI chat width while the sidebar collapse/expand animates the <main>
  // margin and resizes the dockview container, else the chat visibly jumps.
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const chat = api.getPanel("aiChat");
    if (!chat) return;
    const target = chat.api.width;
    if (target <= 0) return;
    let raf = 0;
    let cancelled = false;
    const startedAt = performance.now();
    const pin = () => {
      if (cancelled) return;
      const c = api.getPanel("aiChat");
      if (c && Math.abs(c.api.width - target) > 1) {
        c.api.setSize({ width: target });
      }
      // re-pin across the whole margin transition
      if (performance.now() - startedAt < 320) {
        raf = requestAnimationFrame(pin);
      }
    };
    raf = requestAnimationFrame(pin);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sidebarCollapsed, dockviewApiRef]);

  const toggleComments = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panel = api.getPanel("comments");
    if (panel) {
      api.removePanel(panel);
    } else {
      api.addPanel({
        id: "comments",
        component: "comments",
        title: i18n.t("reader.page.panelComments"),
        position: { direction: "right" },
        initialWidth: 280,
      });
    }
  }, [dockviewApiRef]);

  const toggleAiChat = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panel = api.getPanel("aiChat");
    if (panel) {
      // capture width before removal so reopen restores it
      const currentWidth = panel.api.width;
      if (currentWidth > 0) aiChatWidthRef.current = currentWidth;
      api.removePanel(panel);
    } else {
      api.addPanel({
        id: "aiChat",
        component: "aiChat",
        title: i18n.t("reader.page.panelAiChat"),
        position: { direction: "right" },
        initialWidth: aiChatWidthRef.current,
      });
    }
  }, [dockviewApiRef]);

  // Open-only entry point in the UI store so "Send to AI" can ensure the panel
  // is on screen without toggling it closed. Cleared on unmount so callers
  // outside the reader fall back to /chat.
  useEffect(() => {
    const open = () => {
      if (isMobile) {
        useUIStore.getState().setMobileReaderPanel("aiChat");
        return;
      }
      const api = dockviewApiRef.current;
      if (!api) return;
      if (api.getPanel("aiChat")) return; // already open
      api.addPanel({
        id: "aiChat",
        component: "aiChat",
        title: i18n.t("reader.page.panelAiChat"),
        position: { direction: "right" },
        initialWidth: aiChatWidthRef.current,
      });
    };
    useUIStore.getState().setOpenReaderAiChat(open);
    return () => {
      useUIStore.getState().setOpenReaderAiChat(null);
    };
  }, [isMobile, dockviewApiRef]);

  // Runs once per DockviewReact mount; the initial isMobile / restore
  // callback are captured on purpose, the layout is only built once.
  const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    dockviewApiRef.current = api;

    api.onDidActivePanelChange((e) => {
      if (!e) return;
      const panelId = e.id;
      if (panelId.startsWith("viewer-")) {
        const docId = panelId.replace("viewer-", "");
        useReaderStore.getState().setActiveDocument(docId);
      } else if (panelId === "pdfViewer") {
        // The default viewer keeps one panel id regardless of which doc it
        // shows; the active doc lives in the store. Guard against snapping back
        // to the first doc when toggling the toc panel re-fires this.
        const state = useReaderStore.getState();
        if (state.activeDocumentId) return;
        if (state.documents.size > 0) {
          state.setActiveDocument(Array.from(state.documents.keys())[0]);
        }
      }
    });

    const activeDoc = useReaderStore.getState().getActiveDoc();
    const dynamicWidth = activeDoc ? computeTocWidth(activeDoc.toc) : 256;
    tocWidthRef.current = dynamicWidth;

    const docId = useReaderStore.getState().activeDocumentId;
    const setupLayout = (resolvedWidth: number) => {
      tocWidthRef.current = resolvedWidth;

      // Dockview redistributes space equally on add/remove; defer setSize to
      // next frame so it runs after that settles.
      const restoreTocWidth = () => {
        requestAnimationFrame(() => {
          try {
            const tocPanel = api.getPanel("toc");
            if (tocPanel) {
              tocPanel.api.setSize({ width: tocWidthRef.current });
            }
          } catch {
            // panel may not exist
          }
        });
      };
      api.onDidRemovePanel((removed) => {
        if (removed.id === "toc") return;
        restoreTocWidth();
      });
      api.onDidAddPanel((added) => {
        if (added.id === "toc") return;
        restoreTocWidth();
      });

      const saved = loadDockviewLayout();
      if (saved) {
        try {
          api.fromJSON(saved as ReturnType<typeof api.toJSON>);
          restoreTocWidth();
          // Saved layout may have the whiteboard active (reader closed in draw
          // mode); reflect it so the draw button doesn't add a duplicate.
          if (api.getPanel("pdfCanvasWhiteboard")) {
            onRestoredDrawMode();
          }
          setupLayoutPersistence();
          return;
        } catch {
          // corrupted layout, fall through to default
        }
      }

      // Default layout: viewer + AI chat. The book-scoped chat is one of
      // the app's headline features, so it opens by default (desktop side
      // panel) to remove a click of friction; the user can close it and the
      // layout persists. TOC is opened on demand via the floating toggle.
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
      });
      if (!isMobile) {
        api.addPanel({
          id: "aiChat",
          component: "aiChat",
          title: i18n.t("reader.page.panelAiChat"),
          position: { direction: "right" },
          initialWidth: aiChatWidthRef.current,
        });
      }

      // keep `resolvedWidth` referenced for the lint gate; toggleSidebar reads it via tocWidthRef
      void resolvedWidth;

      setupLayoutPersistence();
    };

    // Debounced layout + TOC width persistence
    const setupLayoutPersistence = () => {
      api.onDidLayoutChange(() => {
        if (layoutSaveTimerRef.current) {
          clearTimeout(layoutSaveTimerRef.current);
        }
        layoutSaveTimerRef.current = setTimeout(() => {
          saveDockviewLayout(api.toJSON());

          // persist TOC width per document
          const currentDocId = useReaderStore.getState().activeDocumentId;
          if (currentDocId) {
            try {
              const tocPanel = api.getPanel("toc");
              if (tocPanel) {
                const width = tocPanel.api.width;
                if (width > 0) {
                  tocWidthRef.current = width;
                  saveTocWidth(currentDocId, width);
                }
              }
            } catch {
              // panel may not exist
            }
          }
        }, 500);
      });
    };

    if (docId) {
      loadTocWidth(docId).then((savedWidth) => {
        setupLayout(savedWidth ?? dynamicWidth);
      });
    } else {
      setupLayout(dynamicWidth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { handleDockviewReady, toggleSidebar, toggleComments, toggleAiChat };
}
