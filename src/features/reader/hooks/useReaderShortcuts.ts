import { useCallback, useEffect } from "react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useReaderStore } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useUndoStore } from "@/stores/undo-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getFeatures } from "@/lib/use-features";
import type { TextSelection } from "@/types/annotation";

export interface ReaderShortcutHandlers {
  triggerFilePicker: () => void;
  toggleSidebar: () => void;
  toggleFullscreen: () => void;
  toggleZenMode: () => void;
  /** Ctrl+Shift+C: stash the current selection for the comment prompt. */
  onAddComment: (selection: TextSelection) => void;
  handlePrint: () => void;
  handleScreenshot: () => void | Promise<void>;
  toggleSearch: () => void;
  toggleReplace: () => void;
  toggleComments: () => void;
  toggleAiChat: () => void;
}

// Arrow up/down scroll the active PDF viewer one line.
const LINE_SCROLL_PX = 60;

// vim hjkl and single-key bindings skip editable elements. Also covers
// contenteditable (EPUB iframe, inline-edit pills) that the shortcut module skips.
const isEditableFocused = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
};

/**
 * Every reader keyboard binding, registered in one place. The shortcut
 * registry is first-match-wins in registration order, so keep the order
 * here stable.
 */
export function useReaderShortcuts({
  triggerFilePicker,
  toggleSidebar,
  toggleFullscreen,
  toggleZenMode,
  onAddComment,
  handlePrint,
  handleScreenshot,
  toggleSearch,
  toggleReplace,
  toggleComments,
  toggleAiChat,
}: ReaderShortcutHandlers): void {
  const goToPage = useReaderStore((s) => s.goToPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);

  useKeyboardShortcut({
    id: "reader:open-file",
    key: "o",
    ctrl: true,
    description: "Open PDF file",
    handler: triggerFilePicker,
  });

  useKeyboardShortcut({
    id: "reader:zoom-in",
    key: "=",
    ctrl: true,
    description: "Zoom in",
    handler: useCallback(() => zoomIn(), [zoomIn]),
  });

  useKeyboardShortcut({
    id: "reader:zoom-out",
    key: "-",
    ctrl: true,
    description: "Zoom out",
    handler: useCallback(() => zoomOut(), [zoomOut]),
  });

  useKeyboardShortcut({
    id: "reader:zoom-reset",
    key: "0",
    ctrl: true,
    description: "Reset zoom to fit width",
    handler: useCallback(() => setZoomMode("fit-width"), [setZoomMode]),
  });

  // Ctrl/Cmd + wheel zoom for non-PDF viewers only. PdfViewer has its own
  // pivot-anchored handler; a second one racing it causes page jumps.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-active-viewer]")) return;
      if (target.closest("[data-pdf-viewer]")) return;
      e.preventDefault();
      const store = useReaderStore.getState();
      if (e.deltaY < 0) store.zoomIn();
      else store.zoomOut();
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  const prevPageHandler = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (activeDoc && activeDoc.currentPage > 1) goToPage(activeDoc.currentPage - 1);
  }, [goToPage]);

  const nextPageHandler = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (activeDoc && activeDoc.currentPage < activeDoc.totalPages) goToPage(activeDoc.currentPage + 1);
  }, [goToPage]);

  // PdfViewer lives in a separate dockview subtree, so find it by marker attrs
  // instead of sharing a ref.
  const getActivePdfViewerEl = useCallback(
    (): HTMLElement | null =>
      document.querySelector<HTMLElement>(
        "[data-pdf-viewer][data-active-viewer]",
      ),
    [],
  );
  const lineScroll = useCallback(
    (dy: number) => {
      getActivePdfViewerEl()?.scrollBy({ top: dy, behavior: "smooth" });
    },
    [getActivePdfViewerEl],
  );
  const horizScroll = useCallback(
    (dx: number) => {
      getActivePdfViewerEl()?.scrollBy({ left: dx, behavior: "smooth" });
    },
    [getActivePdfViewerEl],
  );

  // With a horizontal scrollbar, Left/Right pan instead of paging.
  const hasHorizontalOverflow = useCallback(() => {
    const el = getActivePdfViewerEl();
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + 1;
  }, [getActivePdfViewerEl]);

  const arrowLeftHandler = useCallback(() => {
    if (hasHorizontalOverflow()) {
      horizScroll(-LINE_SCROLL_PX);
      return;
    }
    prevPageHandler();
  }, [hasHorizontalOverflow, horizScroll, prevPageHandler]);

  const arrowRightHandler = useCallback(() => {
    if (hasHorizontalOverflow()) {
      horizScroll(LINE_SCROLL_PX);
      return;
    }
    nextPageHandler();
  }, [hasHorizontalOverflow, horizScroll, nextPageHandler]);

  useKeyboardShortcut({
    id: "reader:prev-page",
    key: "ArrowLeft",
    description: "Previous page (pan when zoomed in)",
    handler: arrowLeftHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:next-page",
    key: "ArrowRight",
    description: "Next page (pan when zoomed in)",
    handler: arrowRightHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:line-up",
    key: "ArrowUp",
    description: "Scroll up one line",
    handler: useCallback(() => lineScroll(-LINE_SCROLL_PX), [lineScroll]),
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:line-down",
    key: "ArrowDown",
    description: "Scroll down one line",
    handler: useCallback(() => lineScroll(LINE_SCROLL_PX), [lineScroll]),
    preventDefault: false,
  });

  // vim hjkl: h=prev page, l=next page, j=line down, k=line up. Skip when an
  // editable element is focused.
  useKeyboardShortcut({
    id: "reader:vim-h",
    key: "h",
    description: "Previous page (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      prevPageHandler();
    }, [prevPageHandler]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:vim-l",
    key: "l",
    description: "Next page (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      nextPageHandler();
    }, [nextPageHandler]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:vim-j",
    key: "j",
    description: "Scroll down one line (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      lineScroll(LINE_SCROLL_PX);
    }, [lineScroll]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:vim-k",
    key: "k",
    description: "Scroll up one line (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      lineScroll(-LINE_SCROLL_PX);
    }, [lineScroll]),
    preventDefault: false,
  });

  // PageUp / PageDown: scroll the active viewer by roughly a screenful.
  const pageScroll = useCallback(
    (dir: 1 | -1) => {
      const el = getActivePdfViewerEl();
      if (!el) return;
      el.scrollBy({ top: dir * el.clientHeight * 0.9, behavior: "smooth" });
    },
    [getActivePdfViewerEl],
  );
  useKeyboardShortcut({
    id: "reader:page-down",
    key: "PageDown",
    description: "Scroll down one screen",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      pageScroll(1);
    }, [pageScroll]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:page-up",
    key: "PageUp",
    description: "Scroll up one screen",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      pageScroll(-1);
    }, [pageScroll]),
    preventDefault: false,
  });

  // 1-5: set the active highlight color.
  const setActiveHighlightColor = useAnnotationStore(
    (s) => s.setActiveHighlightColor,
  );
  useKeyboardShortcut({
    id: "reader:highlight-yellow",
    key: "1",
    description: "Set highlight color: yellow",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("yellow");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-green",
    key: "2",
    description: "Set highlight color: green",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("green");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-blue",
    key: "3",
    description: "Set highlight color: blue",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("blue");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-pink",
    key: "4",
    description: "Set highlight color: pink",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("pink");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-orange",
    key: "5",
    description: "Set highlight color: orange",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("orange");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });

  // n / Shift+N: jump between search matches.
  useKeyboardShortcut({
    id: "reader:search-next",
    key: "n",
    description: "Next search match",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      useSearchStore.getState().next();
    }, []),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:search-prev",
    key: "n",
    shift: true,
    description: "Previous search match",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      useSearchStore.getState().prev();
    }, []),
    preventDefault: false,
  });

  // Space / Shift+Space: page advance / back. Bound explicitly since focus
  // may be on the toolbar or sidebar, not the viewer.
  useKeyboardShortcut({
    id: "reader:space-next",
    key: " ",
    description: "Next page",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      nextPageHandler();
    }, [nextPageHandler]),
  });
  useKeyboardShortcut({
    id: "reader:space-prev",
    key: " ",
    shift: true,
    description: "Previous page",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      prevPageHandler();
    }, [prevPageHandler]),
  });

  // Home / End: scroll to top / bottom of the active viewer.
  const getActiveViewerEl = useCallback(
    (): HTMLElement | null =>
      document.querySelector<HTMLElement>("[data-active-viewer]"),
    [],
  );
  useKeyboardShortcut({
    id: "reader:home",
    key: "Home",
    description: "Jump to start of document",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      const el = getActiveViewerEl();
      el?.scrollTo({ top: 0, behavior: "smooth" });
    }, [getActiveViewerEl]),
  });
  useKeyboardShortcut({
    id: "reader:end",
    key: "End",
    description: "Jump to end of document",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      const el = getActiveViewerEl();
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, [getActiveViewerEl]),
  });

  // Ctrl+Shift+T: cycle reader theme. Shift because Ctrl+T is browser new-tab.
  useKeyboardShortcut({
    id: "reader:cycle-theme",
    key: "t",
    ctrl: true,
    shift: true,
    description: "Cycle reader theme",
    handler: useCallback(() => {
      const { readerTheme, setReaderTheme } = useSettingsStore.getState();
      setReaderTheme(
        readerTheme === "light"
          ? "dark"
          : readerTheme === "dark"
            ? "sepia"
            : "light",
      );
    }, []),
  });

  useKeyboardShortcut({
    id: "reader:toggle-toc",
    key: "\\",
    ctrl: true,
    description: "Toggle table of contents",
    handler: toggleSidebar,
  });

  useKeyboardShortcut({
    id: "reader:go-to-page",
    key: "g",
    ctrl: true,
    description: "Go to page",
    handler: useCallback(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-page-input]',
      );
      input?.focus();
      input?.select();
    }, []),
  });

  useKeyboardShortcut({
    id: "reader:fullscreen",
    key: "f",
    description: "Toggle fullscreen",
    handler: toggleFullscreen,
  });

  useKeyboardShortcut({
    id: "reader:zen-mode",
    key: ".",
    ctrl: true,
    description: "Toggle zen reading mode",
    handler: toggleZenMode,
  });

  useKeyboardShortcut({
    id: "reader:add-comment",
    key: "c",
    ctrl: true,
    shift: true,
    description: "Add comment to selection",
    handler: useCallback(() => {
      const { contextMenu } = useAnnotationStore.getState();
      if (contextMenu.visible && contextMenu.selection) {
        onAddComment(contextMenu.selection);
      }
    }, [onAddComment]),
  });

  useKeyboardShortcut({
    id: "reader:print",
    key: "p",
    ctrl: true,
    description: "Print document",
    handler: handlePrint,
  });

  useKeyboardShortcut({
    id: "reader:screenshot",
    key: "s",
    ctrl: true,
    shift: true,
    description: "Screenshot viewport",
    handler: handleScreenshot,
  });

  useKeyboardShortcut({
    id: "reader:search",
    key: "f",
    ctrl: true,
    description: "Find in document",
    handler: toggleSearch,
  });

  useKeyboardShortcut({
    id: "reader:replace",
    key: "h",
    ctrl: true,
    description: "Find and replace in document",
    handler: toggleReplace,
  });

  useKeyboardShortcut({
    id: "reader:toggle-comments",
    key: "m",
    ctrl: true,
    description: "Toggle comments panel",
    handler: toggleComments,
  });

  useKeyboardShortcut({
    id: "reader:toggle-ai-chat",
    key: "i",
    ctrl: true,
    description: "Toggle AI chat panel",
    handler: toggleAiChat,
  });

  useKeyboardShortcut({
    id: "reader:bookmark-page",
    key: "b",
    ctrl: true,
    description: "Bookmark current page",
    handler: useCallback(() => {
      if (!getFeatures().bookmarks) return;
      const store = useReaderStore.getState();
      const docId = store.activeDocumentId;
      const doc = docId ? store.documents.get(docId) : null;
      if (doc) {
        useBookmarkStore.getState().addBookmark(doc.currentPage);
      }
    }, []),
  });

  useKeyboardShortcut({
    id: "reader:undo",
    key: "z",
    ctrl: true,
    description: "Undo last annotation action",
    handler: useCallback(() => {
      useUndoStore.getState().performUndo();
    }, []),
  });
}
