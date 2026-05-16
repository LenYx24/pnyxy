import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { BookOpen, FilePlus, Loader2, PanelLeft, X } from "lucide-react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview";
import { PromptModal } from "@/components/ui";
import type { TextSelection } from "@/types/annotation";
import { ReaderSidebarContent } from "./ReaderSidebar";
import { ReaderToolbar } from "./ReaderToolbar";
import { DocumentTabs } from "./DocumentTabs";
import { LibraryPickerModal } from "./LibraryPickerModal";
import { MobileReaderBottomBar } from "./MobileReaderBottomBar";
import { InlineDrawToolbar } from "./InlineDrawToolbar";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { PdfViewer } from "./PdfViewer";
import { PdfReflowView } from "./PdfReflowView";
import { TextViewer } from "./TextViewer";
import { EpubViewer } from "./EpubViewer";
import { CommentsSidebar } from "./CommentsSidebar";
import { SearchOverlay } from "./SearchOverlay";
import { AiChatPanel, AiChatPanelContent } from "./AiChatPanel";
import {
  useMobileReaderGestures,
  type PinchEvent,
  type TapEvent,
} from "./use-mobile-reader-gestures";
import { getZoomControls } from "./pinch-zoom-controller";
import {
  ScreenshotRectSelector,
  type ScreenshotRect,
} from "./ScreenshotRectSelector";
import { FocusSessionBadge } from "./FocusSessionBadge";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { WhiteboardPanelWrapper } from "@/features/whiteboard/WhiteboardPanel";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useUndoStore } from "@/stores/undo-store";
import { useUIStore } from "@/stores/ui-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useStreakStore } from "@/stores/streak-store";
import { getFile, registerFile } from "@/lib/file-store";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { createAdapterForFile } from "./adapters";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { useIsMobile, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { saveDockviewLayout, loadDockviewLayout } from "@/stores/ui-store";
import { loadTocWidth, saveTocWidth } from "@/lib/annotation-storage";
import type { TocItem } from "@/types/document";

function TocPanel(props: IDockviewPanelProps) {
  const dockviewApi = props.containerApi;
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

  const handleOpenFile = useCallback(() => {
    triggerFilePicker();
  }, [triggerFilePicker]);

  const handleOpenNote = useCallback(
    (noteId: string) => {
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

  const handleCreateNote = useCallback(() => {
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

  const handleOpenWhiteboard = useCallback(
    (whiteboardId: string) => {
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

  const handleCreateWhiteboard = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    const allowAll = useSettingsStore.getState()
      .experimental_allowWhiteboardForAllFormats;
    if (
      activeDoc &&
      !activeDoc.meta.capabilities.paginated &&
      !allowAll
    ) {
      return;
    }
    // Tag the new whiteboard with the active doc so the reader sidebar
    // can filter to "this book only" — without it, every reader-created
    // whiteboard would still show up across every other book.
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

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      const panelId = `note-${noteId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  const handleDeleteWhiteboard = useCallback(
    (whiteboardId: string) => {
      const panelId = `whiteboard-${whiteboardId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  return (
    <>
      <ReaderSidebarContent
        onOpenFile={handleOpenFile}
        onOpenNote={handleOpenNote}
        onCreateNote={handleCreateNote}
        onOpenWhiteboard={handleOpenWhiteboard}
        onCreateWhiteboard={handleCreateWhiteboard}
        onDeleteNote={handleDeleteNote}
        onDeleteWhiteboard={handleDeleteWhiteboard}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />
    </>
  );
}

/**
 * Dispatches to the format-appropriate viewer for a given document id,
 * defaulting to the active document.
 */
function ActiveViewer({ documentId }: { documentId?: string }) {
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const resolvedId = documentId ?? activeDocumentId ?? undefined;
  const doc = useDocumentState(resolvedId ?? "");
  const format = doc?.meta.format;
  const pdfReflowMode = useSettingsStore((s) => s.pdfReflowMode);

  if (!resolvedId || !doc) return <PdfViewer documentId={resolvedId} />;

  switch (format) {
    case "pdf":
      return pdfReflowMode ? (
        <PdfReflowView documentId={resolvedId} />
      ) : (
        <PdfViewer documentId={resolvedId} />
      );
    case "text":
    case "markdown":
      return <TextViewer documentId={resolvedId} />;
    case "epub":
      return <EpubViewer documentId={resolvedId} />;
    default:
      return <PdfViewer documentId={resolvedId} />;
  }
}

function ViewerPanel(props: IDockviewPanelProps<{ documentId?: string }>) {
  // Wrap the viewer in a `relative` container and mount the floating
  // search overlay HERE — inside the Dockview panel that holds the
  // PDF. Previously the desktop SearchOverlay sat at the outer
  // Dockview container, so its `absolute right-4` pinned to the right
  // edge of the WHOLE dockview area (viewer + AI chat + TOC), which
  // made the overlay visually cover the AI chat panel when that was
  // open. Scoping it to ViewerPanel keeps the right edge aligned with
  // the viewer itself regardless of which other panels are open.
  return (
    <div className="relative h-full w-full">
      <ActiveViewer documentId={props.params?.documentId} />
      <SearchOverlay />
    </div>
  );
}

function CommentsPanel(_props: IDockviewPanelProps) {
  return <CommentsSidebar />;
}

function NotePanelWrapper(props: IDockviewPanelProps<{ noteId?: string }>) {
  const noteId = props.params?.noteId;
  if (!noteId) return null;
  return <NoteEditor noteId={noteId} />;
}

const dockviewComponents = {
  toc: TocPanel,
  pdfViewer: ViewerPanel,
  comments: CommentsPanel,
  aiChat: AiChatPanel,
  note: NotePanelWrapper,
  whiteboard: WhiteboardPanelWrapper,
};

interface MobileReaderLayoutProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isDrawMode: boolean;
  onToggleDrawMode: () => void;
  onScreenshot: () => void;
  onScreenshotRect: () => void;
  onRectToAi: () => void;
  onPrint: () => void;
  onToggleZenMode: () => void;
}

function MobileReaderLayout({
  isFullscreen,
  onToggleFullscreen,
  isDrawMode,
  onToggleDrawMode,
  onScreenshot,
  onScreenshotRect,
  onRectToAi,
  onPrint,
  onToggleZenMode,
}: MobileReaderLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mobileReaderPanel = useUIStore((s) => s.mobileReaderPanel);
  const setMobileReaderPanel = useUIStore((s) => s.setMobileReaderPanel);

  const handleToggleComments = useCallback(() => {
    setMobileReaderPanel(mobileReaderPanel === "comments" ? "none" : "comments");
  }, [mobileReaderPanel, setMobileReaderPanel]);

  const handleToggleSearch = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen) store.close();
    else store.open("find");
  }, []);

  const handleToggleAiChat = useCallback(() => {
    setMobileReaderPanel(mobileReaderPanel === "aiChat" ? "none" : "aiChat");
  }, [mobileReaderPanel, setMobileReaderPanel]);

  // On mobile we don't have Dockview, so a whiteboard opens as a full
  // page via the standalone /whiteboards/:id route. Closing the panel
  // first prevents the slide-over from being stuck open after navigate.
  const handleCreateWhiteboard = useCallback(() => {
    const activeDocId = useReaderStore.getState().activeDocumentId ?? undefined;
    const id = useWhiteboardStore
      .getState()
      .createWhiteboard({ bookId: activeDocId });
    setMobileReaderPanel("none");
    navigate(`/whiteboards/${id}`);
  }, [navigate, setMobileReaderPanel]);

  const handleOpenWhiteboard = useCallback(
    (whiteboardId: string) => {
      setMobileReaderPanel("none");
      navigate(`/whiteboards/${whiteboardId}`);
    },
    [navigate, setMobileReaderPanel],
  );

  const handleOpenContents = useCallback(() => {
    setMobileReaderPanel(mobileReaderPanel === "toc" ? "none" : "toc");
  }, [mobileReaderPanel, setMobileReaderPanel]);

  const handleBookmark = useCallback(() => {
    const doc = useReaderStore.getState().getActiveDoc();
    if (!doc) return;
    useBookmarkStore.getState().addBookmark(doc.currentPage);
  }, []);

  // Page-jump prompt — surfaces the desktop toolbar's "page X / Y"
  // input on mobile, where the toolbar is hidden by default. Tapping
  // the bottom bar's "X / Y" item opens this; the user types a page
  // number and the prompt's onSubmit jumps the active doc. Two
  // primitive selectors instead of one object selector — Zustand
  // would otherwise see a fresh literal on every render and loop.
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const currentPage = useReaderStore(
    (s) => s.getActiveDoc()?.currentPage ?? 0,
  );
  const totalPages = useReaderStore(
    (s) => s.getActiveDoc()?.totalPages ?? 0,
  );
  const handleJumpToPage = useCallback(() => {
    setPageJumpOpen(true);
  }, []);
  const handleJumpToPageSubmit = useCallback((value: string) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const doc = useReaderStore.getState().getActiveDoc();
    if (!doc) return;
    const clamped = Math.max(1, Math.min(doc.totalPages, n));
    useReaderStore.getState().goToPage(clamped);
  }, []);

  // Close panels with ESC. On mobile this matters for iPad/Android
  // users with an external keyboard; on phone it's cheap insurance.
  useEffect(() => {
    if (mobileReaderPanel === "none") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileReaderPanel("none");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileReaderPanel, setMobileReaderPanel]);

  // Android hardware back / system back gesture closes the active
  // mobile sliding panel (TOC / comments / AI chat) before falling
  // through to the browser's default. Without this, pressing back
  // while a panel is open would navigate the user out of the reader
  // entirely.
  useBackToClose(
    mobileReaderPanel !== "none",
    useCallback(() => setMobileReaderPanel("none"), [setMobileReaderPanel]),
  );

  // Tap-to-toggle chrome (ReadEra pattern). A click on the viewer
  // area that isn't on an interactive element, isn't the tail of a
  // selection drag, and isn't during an open context menu toggles the
  // toolbar visibility. onClick fires only on completed taps — drags
  // and scrolls don't trigger it — so this is safe for PDF.js's text
  // selection + highlight flows.
  const toggleMobileChromeHidden = useUIStore(
    (s) => s.toggleMobileChromeHidden,
  );
  const setMobileChromeHidden = useUIStore((s) => s.setMobileChromeHidden);
  const mobileChromeHidden = useUIStore((s) => s.mobileChromeHidden);
  const chromeVisible = !mobileChromeHidden || mobileReaderPanel !== "none";
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);

  // Start each reader session with chrome hidden — the user opens a
  // book to read, not to stare at the toolbar. Resets on every new
  // document so an explicit reveal doesn't persist across books.
  useEffect(() => {
    setMobileChromeHidden(true);
  }, [activeDocumentId, setMobileChromeHidden]);

  // Touch gestures: horizontal swipe → page turn (PDF only), pinch →
  // zoom. Swipe disabled on EPUB/markdown/text since they don't have
  // discrete pages in the same sense.
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  // Subscribe to the two primitives we actually use. Subscribing to
  // `getActiveDoc()` would re-render this component on every pinch
  // frame.
  const isPaginated = useReaderStore(
    (s) => s.getActiveDoc()?.meta.capabilities.paginated ?? false,
  );
  // Once the user has zoomed in past ~110%, they want to pan
  // horizontally like a map; swipe-to-turn-page would fight that.
  // Read it from the persisted zoomLevel + mode (live tray scale isn't
  // mirrored to the store mid-gesture, but we only need this signal
  // for swipe-vs-pan arbitration which is fine on stable scale).
  const isZoomedIn = useReaderStore(
    (s) => (s.getActiveDoc()?.zoomMode === "custom" &&
      (s.getActiveDoc()?.zoomLevel ?? 100) > 110) ||
      s.getActiveDoc()?.zoomMode === "fit-page",
  );

  const viewerRef = useRef<HTMLDivElement>(null);

  // Single-tap toggles the chrome (toolbar / bottom bar). Skipped on
  // taps that landed on an interactive child (buttons, links,
  // annotation popovers, contenteditable nodes) and on taps that
  // happen while the user has a text selection — pdf.js's selection
  // handles can otherwise dismiss themselves before the user can
  // interact with them.
  const handleSingleTap = useCallback(
    ({ target }: TapEvent) => {
      if (mobileReaderPanel !== "none") return;
      const el = target as HTMLElement | null;
      if (
        el?.closest?.(
          "button, a, input, textarea, select, [role='button'], [contenteditable]",
        )
      ) {
        return;
      }
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      if (document.querySelector("[data-annotation-context-menu]")) return;
      toggleMobileChromeHidden();
    },
    [mobileReaderPanel, toggleMobileChromeHidden],
  );

  // Double-tap toggles between 1× (fit-width) and 2× zoom anchored at
  // the tap point. Drives the live tray controller directly — no
  // intermediate React state, the visual lands in one paint frame.
  const handleDoubleTap = useCallback(
    ({ x, y, target }: TapEvent) => {
      if (mobileReaderPanel !== "none") return;
      const el = target as HTMLElement | null;
      if (
        el?.closest?.(
          "button, a, input, textarea, select, [role='button'], [contenteditable]",
        )
      ) {
        return;
      }
      const controls = getZoomControls();
      if (!controls) return;
      const current = controls.getScale();
      const target2x = current > 1.1 ? 1 : 2;
      controls.setAbsolute(target2x, { pivotX: x, pivotY: y });
    },
    [mobileReaderPanel],
  );

  useMobileReaderGestures({
    targetRef: viewerRef,
    enableSwipe:
      isPaginated && mobileReaderPanel === "none" && !isZoomedIn,
    enablePinch: mobileReaderPanel === "none",
    onSwipeLeft: nextPage,
    onSwipeRight: prevPage,
    onSingleTap: handleSingleTap,
    onDoubleTap: handleDoubleTap,
    // Pinch passes through to the live tray controller. Each phase is
    // a thin call: PdfViewer mutates DOM, no React renders during the
    // gesture, and the final scale gets debounced into the store ~250
    // ms after the user lifts their fingers — so React renders exactly
    // once per gesture and only after the visual has already settled.
    onPinch: useCallback(({ phase, scale, midX, midY }: PinchEvent) => {
      const controls = getZoomControls();
      if (!controls) return;
      if (phase === "start") controls.begin(midX, midY);
      else if (phase === "move") controls.update(scale);
      else controls.end();
    }, []),
  });

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {/* Toolbar is an absolute overlay so the viewer keeps the full
          screen even while chrome is visible. Slides off-screen when
          the user hides chrome. Always visible while a panel is open
          (so the user has orientation). */}
      <div
        className={cn(
          "absolute left-0 right-0 top-0 z-20 transition-transform duration-200 ease-out",
          chromeVisible ? "translate-y-0" : "-translate-y-full",
        )}
      >
        <ReaderToolbar
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          onToggleComments={handleToggleComments}
          isDrawMode={isDrawMode}
          onToggleDrawMode={onToggleDrawMode}
          onScreenshot={onScreenshot}
          onScreenshotRect={onScreenshotRect}
          onRectToAi={onRectToAi}
          onPrint={onPrint}
          onToggleSearch={handleToggleSearch}
          onToggleAiChat={handleToggleAiChat}
          onToggleZenMode={onToggleZenMode}
        />
      </div>
      <div
        ref={viewerRef}
        className="relative flex-1 overflow-hidden touch-pan-y"
      >
        <ActiveViewer />
        <SearchOverlay />
      </div>

      <MobileReaderBottomBar
        visible={chromeVisible}
        activePanel={mobileReaderPanel}
        onOpenContents={handleOpenContents}
        onToggleSearch={handleToggleSearch}
        onBookmark={handleBookmark}
        onToggleComments={handleToggleComments}
        onToggleAiChat={handleToggleAiChat}
        pageCurrent={currentPage > 0 ? currentPage : undefined}
        pageTotal={totalPages > 0 ? totalPages : undefined}
        onJumpToPage={totalPages > 0 ? handleJumpToPage : undefined}
      />

      {/* Backdrop for overlay panels — covers the full viewport
          (including the safe-inset strip at the top) so taps anywhere
          outside the panel dismiss it. */}
      {mobileReaderPanel !== "none" && (
        <div
          className="absolute inset-0 z-30 bg-black/40"
          onClick={() => setMobileReaderPanel("none")}
        />
      )}

      {/* Mobile overlay panels. The wrappers are always mounted so
          CSS can animate the slide; the contents are mounted only
          while the corresponding panel is active. That keeps side
          effects (scroll-into-view, textarea resize, visualViewport
          listeners in AiChatPanelContent) from firing on every reader
          render — previously those leaked onto the main view on
          Android WebView. `pointer-events-none` on closed wrappers
          is belt-and-braces to stop an off-screen wrapper from
          eating taps at its edge. */}

      {/* TOC panel - slides from left */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 z-40 flex w-full flex-col border-r border-glass-border bg-bg-secondary/95 backdrop-blur-xl transition-transform duration-300 pt-safe-top pb-safe-bottom pl-safe-left",
          mobileReaderPanel === "toc"
            ? "translate-x-0"
            : "-translate-x-full pointer-events-none",
        )}
      >
        {mobileReaderPanel === "toc" && (
          <>
            <div className="flex items-center justify-between border-b border-glass-border pl-3 pr-1 py-1">
              <span className="text-sm font-medium text-text-primary">
                {t("reader.page.mobilePanelContents")}
              </span>
              <button
                onClick={() => setMobileReaderPanel("none")}
                aria-label={t("reader.page.closeContents")}
                className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ReaderSidebarContent
                onOpenFile={() => {}}
                onOpenNote={() => {}}
                onCreateNote={() => {}}
                onOpenWhiteboard={handleOpenWhiteboard}
                onCreateWhiteboard={handleCreateWhiteboard}
              />
            </div>
          </>
        )}
      </div>

      {/* Comments panel - slides from right */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 z-40 flex w-full flex-col border-l border-glass-border bg-bg-secondary/95 backdrop-blur-xl transition-transform duration-300 pt-safe-top pb-safe-bottom pr-safe-right",
          mobileReaderPanel === "comments"
            ? "translate-x-0"
            : "translate-x-full pointer-events-none",
        )}
      >
        {mobileReaderPanel === "comments" && (
          <>
            <div className="flex items-center justify-between border-b border-glass-border pl-3 pr-1 py-1">
              <span className="text-sm font-medium text-text-primary">
                {t("reader.page.mobilePanelComments")}
              </span>
              <button
                onClick={() => setMobileReaderPanel("none")}
                aria-label={t("reader.page.closeComments")}
                className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CommentsSidebar />
            </div>
          </>
        )}
      </div>

      {/* AI Chat panel - slides from right */}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 z-40 flex w-full flex-col border-l border-glass-border bg-bg-secondary/95 backdrop-blur-xl transition-transform duration-300 pt-safe-top pb-safe-bottom pr-safe-right",
          mobileReaderPanel === "aiChat"
            ? "translate-x-0"
            : "translate-x-full pointer-events-none",
        )}
      >
        {mobileReaderPanel === "aiChat" && (
          <AiChatPanelContent onClose={() => setMobileReaderPanel("none")} />
        )}
      </div>

      <PromptModal
        open={pageJumpOpen}
        title={t("reader.toolbar.jumpToPageTitle")}
        body={t("reader.toolbar.jumpToPageBody", { total: totalPages })}
        defaultValue={String(currentPage)}
        placeholder={String(totalPages)}
        confirmLabel={t("reader.toolbar.jumpToPageConfirm")}
        onClose={() => setPageJumpOpen(false)}
        onSubmit={handleJumpToPageSubmit}
      />
    </div>
  );
}

function EmptyState() {
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-glass-bg">
        <BookOpen size={32} className="text-text-muted" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-text-primary">
        No book open
      </h2>
      <p className="mb-6 max-w-sm text-sm text-text-secondary">
        Select a book from your library to start reading, or open a PDF,
        EPUB, or text file directly.
      </p>
      <Button variant="secondary" onClick={triggerFilePicker}>
        <FilePlus size={18} />
        Open file
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}

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

/** Re-fetch a book's binary after the user refreshes /reader/<id> —
 *  the in-memory file-store Map is wiped on refresh, but the URL still
 *  identifies which book to open. Tries two paths:
 *
 *  1. Uploaded library: addDocument keys docs by `meta.id` (file
 *     hash for PDFs), and the books table stores that as `file_hash`.
 *     So `WHERE file_hash = bookId` returns the row whose
 *     `book_files.storage_path` we then download from.
 *  2. Catalog: catalog books are routed at `/reader/<catalog_book.id>`
 *     directly (no addDocument-derived hash). Look up by id, fetch
 *     the public download_url, fall back to the catalog-fetch edge
 *     function on CORS failure (same logic as use-open-catalog-book).
 *
 *  Returns the File on success, null on every failure path. The
 *  caller renders the existing "no document open" state on null —
 *  the user lands on the same UX they had before this recovery
 *  existed, so failure modes regress gracefully. */
async function recoverBookFile(bookId: string): Promise<File | null> {
  // 1. Uploaded books — by file_hash. Joining `book_files` gets us
  // the storage path + filename in one round-trip; LIMIT 1 because
  // file_hash is supposed to be unique per (user, file).
  try {
    const { data: uploaded, error } = await supabase
      .from("books")
      .select("title, file_hash, book_files(storage_path, file_name)")
      .eq("file_hash", bookId)
      .limit(1)
      .maybeSingle();
    if (!error && uploaded) {
      const fileMeta = (
        uploaded.book_files as
          | { storage_path: string; file_name: string }[]
          | { storage_path: string; file_name: string }
          | null
      );
      const first = Array.isArray(fileMeta) ? fileMeta[0] : fileMeta;
      if (first?.storage_path) {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("book-files")
          .download(first.storage_path);
        if (!dlErr && blob) {
          return new File([blob], first.file_name ?? "document");
        }
      }
    }
  } catch (err) {
    logError("reader:recover:uploaded", err);
  }

  // 2. Catalog books — by id. download_url is a public link; try
  // direct fetch first (works for hosts with permissive CORS) and
  // fall back to the catalog-fetch edge function (auth-gated server
  // proxy) for hosts that block the browser request. Same two-step
  // strategy use-open-catalog-book uses on first open.
  try {
    const { data: catalog, error } = await supabase
      .from("catalog_books")
      .select("title, download_url")
      .eq("id", bookId)
      .limit(1)
      .maybeSingle();
    if (error || !catalog?.download_url) return null;
    const url = catalog.download_url as string;
    let res: Response;
    try {
      res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (directErr) {
      logError("reader:recover:catalog:direct", directErr);
      // Server-side proxy fallback for hosts that block CORS.
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) return null;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-fetch?url=${encodeURIComponent(url)}`;
      try {
        res = await fetch(fnUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (!res.ok) return null;
      } catch (proxyErr) {
        logError("reader:recover:catalog:proxy", proxyErr);
        return null;
      }
    }
    const blob = await res.blob();
    // Re-derive a filename from the URL — the catalog row doesn't
    // store one and the user never sees this string anyway, the
    // adapter cares about the bytes + extension. Strip any query
    // string and fall back to the book title if the URL is opaque.
    const urlPath = url.toLowerCase().split("?")[0];
    const ext = urlPath.endsWith(".epub")
      ? ".epub"
      : urlPath.endsWith(".pdf")
        ? ".pdf"
        : urlPath.endsWith(".txt")
          ? ".txt"
          : "";
    const filename =
      ((catalog.title as string | null) ?? "document").replace(/[^\w.-]+/g, "_") +
      ext;
    return new File([blob], filename, { type: blob.type });
  } catch (err) {
    logError("reader:recover:catalog", err);
    return null;
  }
}

export function ReaderPage() {
  const { t } = useTranslation();
  const { bookId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  // Subscribe to derived booleans, not the documents Map itself —
  // the Map gets a new reference on every pinch frame (live-zoom)
  // and would re-render the whole reader 60×/sec.
  const hasDocuments = useReaderStore((s) => s.documents.size > 0);
  const bookDocumentLoaded = useReaderStore((s) =>
    bookId ? s.documents.has(bookId) : false,
  );
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const addDocument = useReaderStore((s) => s.addDocument);
  const goToPage = useReaderStore((s) => s.goToPage);
  // Bind the inline-draw store to the active doc so its localStorage
  // strokes load on book-open and unload on close. Auto-deactivate
  // when switching books to avoid the previous book's draw mode
  // sticking around for the next one.
  const setInlineDrawBook = useInlineDrawStore((s) => s.setBook);
  const setInlineDrawActive = useInlineDrawStore((s) => s.setActive);
  useEffect(() => {
    setInlineDrawBook(activeDocumentId ?? null);
    if (!activeDocumentId) setInlineDrawActive(false);
  }, [activeDocumentId, setInlineDrawBook, setInlineDrawActive]);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);

  const isLoadingDocument = useUIStore((s) => s.isLoadingDocument);
  const loadingMessage = useUIStore((s) => s.loadingMessage);
  const zenMode = useUIStore((s) => s.zenMode);
  const setZenMode = useUIStore((s) => s.setZenMode);
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);
  const libraryPickerOpen = useUIStore((s) => s.libraryPickerOpen);
  const setLibraryPickerOpen = useUIStore((s) => s.setLibraryPickerOpen);


  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Comment-via-shortcut state. The Ctrl+Shift+M shortcut used to
  // call window.prompt() inline; we now stash the active selection
  // here and render a styled PromptModal at the bottom of the
  // page, then commit the comment on submit.
  const [commentPromptSelection, setCommentPromptSelection] =
    useState<TextSelection | null>(null);
  const tocWidthRef = useRef<number>(256);
  // Remembers the AI chat panel's width across close/reopen within
  // the current ReaderPage mount. Reset to 360 on full reader unmount
  // (i.e. closing and reopening the book) — that's the agreed scope:
  // session-local memory, not per-doc persistence.
  // Default chat panel width. On laptop/desktop the 360 px baseline
  // leaves the PDF plenty of room; on a tablet in landscape (~1024–
  // 1280 px) it leaves the chat itself cramped. Compute a width that
  // claims roughly half the viewport on smaller screens, capped so a
  // 1920+ px monitor still gets the slim 360 default. Refs survive
  // panel close/reopen within the session — the user can drag the
  // splitter and that lands back here on close (see line ~1564).
  const aiChatWidthRef = useRef<number>(
    typeof window !== "undefined" && window.innerWidth < 1280
      ? Math.max(360, Math.min(620, Math.floor(window.innerWidth * 0.5)))
      : 360,
  );
  // Monotonically-increasing token bumped at the start of every
  // cold-path recovery. The async finally only clears the global
  // spinner when the token still matches — that way a successful
  // load (which flips bookDocumentLoaded → effect cleanup → cancelled
  // = true) still clears the spinner, while a cross-book navigation
  // mid-recovery (new effect already setLoading(true) for the new
  // book) keeps the new effect's spinner state. Replaces the
  // cancelled-gated clear, which had the side-effect of leaving the
  // spinner spinning forever after a normal post-refresh recovery.
  const loadingTokenRef = useRef(0);
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Pinch-zoom on touch tablets/laptops that fall outside `isMobile`
  // (iPad in landscape, Surface, etc.). MobileReaderLayout owns the
  // full mobile gesture suite — swipe, tap-to-chrome, pinch — and we
  // don't want to double-fire those on phones. The desktop branch
  // here attaches gestures to the whole reader container with swipe
  // disabled, leaving only pinch active and only when the device is
  // touch-capable. `(pointer: coarse)` is the standard probe for
  // "the user is touching, not mousing".
  const isTouch = useMediaQuery("(pointer: coarse)");
  useMobileReaderGestures({
    targetRef: readerContainerRef,
    enableSwipe: false,
    enablePinch: !isMobile && isTouch,
    onSwipeLeft: () => {},
    onSwipeRight: () => {},
    onSingleTap: () => {},
    onDoubleTap: () => {},
    onPinch: useCallback(({ phase, scale, midX, midY }: PinchEvent) => {
      const controls = getZoomControls();
      if (!controls) return;
      if (phase === "start") controls.begin(midX, midY);
      else if (phase === "move") controls.update(scale);
      else controls.end();
    }, []),
  });
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

  // Load document from file registry if navigated directly. The
  // registry is an in-memory Map so a hard refresh wipes it — in
  // that case the bookId in the URL still tells us *which* book the
  // user wanted, and we can re-fetch it from Supabase. Try the
  // uploaded library first (books.file_hash = bookId, since
  // addDocument's docId is the file hash), then fall back to the
  // catalog (catalog_books.id = bookId, the catalog UUID).
  useEffect(() => {
    if (!bookId || bookDocumentLoaded) return;
    let cancelled = false;
    const file = getFile(bookId);
    if (file) {
      // Hot-path: navigated from elsewhere in the app; file is
      // already in memory.
      const adapter = createAdapterForFile(file);
      void addDocument(adapter, file);
      return;
    }
    // Cold-path: post-refresh recovery. Run async; `cancelled` gates
    // applying the loaded document so a fast bookId change doesn't
    // race two opens to completion. Spinner clearing uses a separate
    // token gate (loadingTokenRef): a newer cold-path bumps the token
    // and "owns" the spinner; older paths skip the clear so they
    // can't wipe a fresh load's spinner.
    const setLoading = useUIStore.getState().setLoading;
    const token = ++loadingTokenRef.current;
    setLoading(true, t("reader.page.loadingDocumentMessage"));
    void (async () => {
      try {
        const recovered = await recoverBookFile(bookId);
        if (cancelled || !recovered) return;
        registerFile(bookId, recovered);
        const adapter = createAdapterForFile(recovered);
        await addDocument(adapter, recovered);
      } finally {
        if (loadingTokenRef.current === token) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, bookDocumentLoaded, addDocument, t]);

  // Load annotations + bookmarks when active document changes
  useEffect(() => {
    if (activeDocumentId) {
      useAnnotationStore.getState().loadAnnotations(activeDocumentId);
      useBookmarkStore.getState().loadForDocument(activeDocumentId);
    }
    return () => {
      useAnnotationStore.getState().clearAll();
      useBookmarkStore.getState().clear();
    };
  }, [activeDocumentId]);

  // Jump to ?page= once the *right* doc is loaded — used by bookmarks,
  // book-page deep-links, and chat citation "Open in reader" buttons.
  // Consumes the param on read so a refresh doesn't re-snap the user
  // back. Critical guard: only fire when the active doc actually
  // matches the URL's bookId. Without this, navigating from /chat
  // (where a previous reader visit left a different doc active) would
  // call goToPage on the *previous* doc and then clear the param
  // before the new one finishes loading — that's why a "Book p3" link
  // used to land on p1.
  useEffect(() => {
    if (!activeDocumentId) return;
    if (bookId && activeDocumentId !== bookId) return;
    const pageParam = searchParams.get("page");
    if (!pageParam) return;
    const pageNum = Number.parseInt(pageParam, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    goToPage(pageNum);
    // Companion `q=` payload from LLM citation chips with a quote.
    // Arm the citation slot so CitationQuoteHighlightLayer picks it
    // up once the page renders. In-reader clicks already armed it
    // synchronously via use-page-citation; this branch handles the
    // cross-page navigation case (clicking a citation from /chat
    // when the reader wasn't mounted).
    const quote = searchParams.get("q");
    if (quote) {
      useReaderStore.getState().setActiveCitation({
        docId: activeDocumentId,
        page: pageNum,
        quote,
        createdAt: Date.now(),
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("page");
        next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [activeDocumentId, bookId, searchParams, setSearchParams, goToPage]);

  // Load notes and whiteboards on mount
  useEffect(() => {
    useNoteStore.getState().loadNotes();
    useWhiteboardStore.getState().loadWhiteboards();
  }, []);

  // Listen for fullscreen changes (e.g. user pressing Esc)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = readerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  // Keyboard shortcuts
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

  // Ctrl/Cmd + mouse-wheel zooms the PDF instead of the whole page.
  // Document-level listener with passive: false so we can
  // preventDefault and stop the browser's native page-zoom. Scoped
  // by hit-testing the event target — only triggers when the wheel
  // event happened over the active viewer, otherwise normal page
  // zoom is preserved (e.g., on the sidebar or a Dockview header).
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-active-viewer], [data-pdf-viewer]")) return;
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

  // Arrow up/down scroll the active PDF viewer by one line (~60 px).
  // Left/Right binding moved below (depends on arrowLeftHandler /
  // arrowRightHandler which read LINE_SCROLL_PX + horizScroll
  // declared in this block). Native smooth-scroll is good enough
  // here — no need to plumb through smoothScrollBy.
  // Tuning dial: change LINE_SCROLL_PX below.
  const LINE_SCROLL_PX = 60;
  const lineScroll = useCallback((dy: number) => {
    const el = document.querySelector<HTMLElement>(
      "[data-pdf-viewer][data-active-viewer]",
    );
    if (!el) return;
    el.scrollBy({ top: dy, behavior: "smooth" });
  }, []);
  const horizScroll = useCallback((dx: number) => {
    const el = document.querySelector<HTMLElement>(
      "[data-pdf-viewer][data-active-viewer]",
    );
    if (!el) return;
    el.scrollBy({ left: dx, behavior: "smooth" });
  }, []);

  // When the page is zoomed enough that the viewer has a horizontal
  // scrollbar, repurpose Left/Right arrows to pan the viewer
  // horizontally instead of paging. Otherwise the user's natural
  // "look at the rest of this page" gesture (tap right arrow)
  // jumps them to the next page mid-paragraph. We probe the active
  // viewer's scrollWidth/clientWidth at the moment of the key press
  // — cheap and always in sync with current zoom — and only fall
  // back to page navigation when there's no horizontal overflow.
  const hasHorizontalOverflow = useCallback(() => {
    const el = document.querySelector<HTMLElement>(
      "[data-pdf-viewer][data-active-viewer]",
    );
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + 1;
  }, []);

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

  // vim-style hjkl mirrors the arrow keys: h=prev page, l=next page,
  // j=line down, k=line up. Skip when an editable element is focused
  // so typing into inputs / contenteditable doesn't trigger nav.
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
  // Suppress unused-var warning when only horizontal vim keys aren't
  // wired yet — keeps the helper available for future tuning.
  void horizScroll;

  const toggleSidebar = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    // Snapshot the viewer ↔ AI-chat ratio BEFORE the toggle.
    // Dockview's add/removePanel redistributes the freed/required
    // space proportionally across remaining siblings, but in some
    // configurations the redistribution lands on a 50/50 split
    // instead of preserving the prior ratio — that was the bug: a
    // 60/40 reader-to-chat layout collapsed to 50/50 every time the
    // user toggled the submenu. We capture the widths up front and
    // restore the ratio in an rAF after the dockview commit.
    const viewerBefore = api.getPanel("viewer");
    const aiChatBefore = api.getPanel("aiChat");
    const viewerW = viewerBefore?.api.width ?? null;
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

    // Restore the viewer/aiChat ratio after dockview has settled.
    // Only proceed if both panels existed before and after — when
    // the user has the chat closed, there's nothing to balance.
    if (viewerW != null && aiChatW != null && viewerW + aiChatW > 0) {
      const prevRatio = viewerW / (viewerW + aiChatW);
      requestAnimationFrame(() => {
        const v = api.getPanel("viewer");
        const c = api.getPanel("aiChat");
        if (!v || !c) return;
        const available = v.api.width + c.api.width;
        if (available <= 0) return;
        const targetViewer = Math.round(available * prevRatio);
        // setSize on the viewer panel — dockview pulls the
        // complementary delta from its splitview sibling (the
        // AI chat), which is exactly what we want.
        v.api.setSize({ width: targetViewer });
      });
    }
  }, []);

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

  // Esc exits zen mode regardless of whether anything else is focused.
  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZenMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenMode, setZenMode]);

  useKeyboardShortcut({
    id: "reader:add-comment",
    key: "c",
    ctrl: true,
    shift: true,
    description: "Add comment to selection",
    handler: useCallback(() => {
      const { contextMenu } = useAnnotationStore.getState();
      if (contextMenu.visible && contextMenu.selection) {
        setCommentPromptSelection(contextMenu.selection);
      }
    }, []),
  });

  const [isDrawMode, setIsDrawMode] = useState(false);
  const drawWhiteboardIdRef = useRef<string | null>(null);

  const toggleDrawMode = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;

    // Swap pattern: ADD the replacement panel into the SAME group as
    // the panel we're replacing (`direction: "within"`), THEN remove
    // the original. Doing the add first means the destination group
    // keeps its existing proportions — dockview only redistributes
    // space when a group becomes empty, which never happens here.
    //
    // This fixes two symptoms the old "remove first, then add" code
    // produced:
    //   1. Toggling on shrunk the reader area while the chat panel
    //      took over its space (because the viewer's group went away,
    //      then the new whiteboard was added with no position hint
    //      and dockview picked a default tiny slot).
    //   2. Toggling off collapsed the TOC into the top tab-bar
    //      (because by the time the new pdfViewer was added, the TOC
    //      group was the only target left and dockview slotted the
    //      viewer in as a tab there).

    if (isDrawMode) {
      const wbPanel = api.getPanel("pdfCanvasWhiteboard");
      if (!wbPanel) {
        setIsDrawMode(false);
        return;
      }
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
        position: { referencePanel: "pdfCanvasWhiteboard", direction: "within" },
      });
      api.removePanel(wbPanel);
      setIsDrawMode(false);
    } else {
      const activeDoc = useReaderStore.getState().getActiveDoc();
      if (!activeDoc?.meta?.fileUrl) return;

      // Gate: whiteboard-on-document requires a paginated format unless
      // the user has opted into the experimental multi-format toggle.
      const allowAll = useSettingsStore.getState()
        .experimental_allowWhiteboardForAllFormats;
      if (!activeDoc.meta.capabilities.paginated && !allowAll) return;

      const viewerPanel = api.getPanel("pdfViewer");
      if (!viewerPanel) return;

      // Reuse existing whiteboard or create a new one
      if (!drawWhiteboardIdRef.current) {
        const activeDocId =
          useReaderStore.getState().activeDocumentId ?? undefined;
        drawWhiteboardIdRef.current = useWhiteboardStore
          .getState()
          .createWhiteboard({ bookId: activeDocId });
      }

      api.addPanel({
        id: "pdfCanvasWhiteboard",
        component: "whiteboard",
        title: i18n.t("reader.page.panelPdfCanvas"),
        params: {
          whiteboardId: drawWhiteboardIdRef.current,
          pdfDocumentUrl: activeDoc.meta.fileUrl,
        },
        position: { referencePanel: "pdfViewer", direction: "within" },
      });
      api.removePanel(viewerPanel);
      setIsDrawMode(true);
    }
  }, [isDrawMode]);

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
  }, []);

  // Print handler — defers to the browser's native print pipeline.
  // Global @media print CSS (src/styles/index.css) hides everything
  // except [data-active-viewer], so the browser rasterizes the PDF
  // canvas + DOM overlays (highlights, comments, drawings) together.
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Screenshot handlers — full viewer + interactive rectangle.
  const [rectScreenshotActive, setRectScreenshotActive] = useState(false);
  // Same overlay UX but the captured PNG flows into the AI chat
  // composer as an attachment instead of downloading + clipboard.
  // Kept on its own flag (vs the download rect) so the two modes
  // don't accidentally cross-wire when one is cancelled mid-drag.
  const [rectToAiActive, setRectToAiActive] = useState(false);

  const saveCanvas = useCallback((canvas: HTMLCanvasElement) => {
    // Trigger the file download as before…
    const link = document.createElement("a");
    link.download = `screenshot-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    // …and also push the bitmap onto the clipboard so the user can
    // immediately paste into chat / notes / Slack without juggling
    // the saved file. ClipboardItem requires a Promise<Blob>, so we
    // pass the toBlob callback inside one. Fail silently — clipboard
    // permission may be denied (Safari < 13, http origins, focus
    // missing) and that's OK: the file still downloaded.
    try {
      canvas.toBlob((blob) => {
        if (!blob || !navigator.clipboard?.write) return;
        navigator.clipboard
          .write([new ClipboardItem({ "image/png": blob })])
          .catch(() => {});
      }, "image/png");
    } catch {
      // ClipboardItem missing or blocked — nothing else to do.
    }
  }, []);

  const handleScreenshot = useCallback(async () => {
    const viewer =
      document.querySelector<HTMLElement>("[data-active-viewer]") ??
      document.querySelector<HTMLElement>("[data-pdf-viewer]");
    if (!viewer) return;

    const { default: html2canvas } = await import("html2canvas-pro");
    const canvas = await html2canvas(viewer, {
      useCORS: true,
      allowTaint: true,
      scale: window.devicePixelRatio,
      backgroundColor: null,
    });
    saveCanvas(canvas);
  }, [saveCanvas]);

  const handleRectScreenshotStart = useCallback(() => {
    setRectScreenshotActive(true);
  }, []);

  const handleRectScreenshotCapture = useCallback(
    async (rect: ScreenshotRect) => {
      setRectScreenshotActive(false);
      // Let the overlay unmount before rasterizing so it isn't captured.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio,
        backgroundColor: null,
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      });
      saveCanvas(canvas);
    },
    [saveCanvas],
  );

  // "Crop area for AI" flow. Same overlay + same html2canvas, but
  // the resulting PNG goes into the chat composer's pending
  // attachments instead of the file system + clipboard. Used when
  // text selection isn't viable (scanned PDFs, math-heavy figures,
  // image-only pages) and the user wants to ask the AI about
  // something they're looking at right now.
  const handleRectToAiStart = useCallback(() => {
    setRectToAiActive(true);
  }, []);

  const handleRectToAiCapture = useCallback(async (rect: ScreenshotRect) => {
    setRectToAiActive(false);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const { default: html2canvas } = await import("html2canvas-pro");
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: window.devicePixelRatio,
      backgroundColor: null,
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    });
    // Encode as a base64 PNG — same shape as the user-uploaded
    // image attachments, so the chat composer + provider-side
    // multimodal converters render and ship it without any
    // special-casing.
    const dataUrl = canvas.toDataURL("image/png");
    const idx = dataUrl.indexOf(",");
    const data = idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
    useUIStore.getState().pushChatAttachment({
      kind: "image",
      media_type: "image/png",
      data,
      name: `page-${Date.now()}.png`,
    });
    // Open the AI chat panel so the user sees the attachment land.
    // openReaderAiChat is null on the standalone /chat page where
    // there's no reader to capture from, so this is harmless.
    useUIStore.getState().openReaderAiChat?.();
  }, []);

  // Search overlay toggle (VSCode-style find).
  const toggleSearch = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen && store.mode === "find") store.close();
    else store.open("find");
  }, []);

  // Replace overlay toggle (find+replace).
  const toggleReplace = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen && store.mode === "replace") store.close();
    else store.open("replace");
  }, []);

  // AI Chat toggle
  const toggleAiChat = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panel = api.getPanel("aiChat");
    if (panel) {
      // Capture the panel's current width before removal so the next
      // open restores it. dockview's `panel.api.width` is the live
      // measured width including any user drags on the splitter.
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
  }, []);

  // Expose an OPEN-ONLY (never-toggle) entry point in the UI store so
  // the annotation menu's "Send to AI" can ensure the panel is on
  // screen without accidentally closing it if the user already had
  // it open. Mobile and desktop have different chat surfaces, so the
  // function picks the right one at call time. Lifecycle: register
  // on mount, clear on unmount so callers outside the reader fall
  // back to navigating to /chat. Re-runs on `isMobile` change so a
  // mid-session resize swaps the implementation.
  useEffect(() => {
    const open = () => {
      if (isMobile) {
        useUIStore.getState().setMobileReaderPanel("aiChat");
        return;
      }
      const api = dockviewApiRef.current;
      if (!api) return;
      if (api.getPanel("aiChat")) return; // already open — no-op
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
  }, [isMobile]);

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

  // Dockview ready handler
  const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    dockviewApiRef.current = api;

    // Track active panel to update activeDocumentId
    api.onDidActivePanelChange((e) => {
      if (!e) return;
      const panelId = e.id;
      // If it's a viewer panel, extract the docId
      if (panelId.startsWith("viewer-")) {
        const docId = panelId.replace("viewer-", "");
        useReaderStore.getState().setActiveDocument(docId);
      } else if (panelId === "pdfViewer") {
        // Legacy default viewer panel — use the first/only document
        const docs = useReaderStore.getState().documents;
        if (docs.size > 0) {
          useReaderStore.getState().setActiveDocument(Array.from(docs.keys())[0]);
        }
      }
    });

    // Compute dynamic TOC width from active document's TOC entries
    const activeDoc = useReaderStore.getState().getActiveDoc();
    const dynamicWidth = activeDoc ? computeTocWidth(activeDoc.toc) : 256;
    tocWidthRef.current = dynamicWidth;

    // Try loading saved width for this document, then set up layout
    const docId = useReaderStore.getState().activeDocumentId;
    const setupLayout = (resolvedWidth: number) => {
      tocWidthRef.current = resolvedWidth;

      // Dockview distributes space equally when panels are added or removed.
      // Defer setSize to next frame so it runs after the distribute completes.
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

      // Try restoring saved layout
      const saved = loadDockviewLayout();
      if (saved) {
        try {
          api.fromJSON(saved as ReturnType<typeof api.toJSON>);
          // After restoring layout, apply the correct TOC width
          restoreTocWidth();
          // If the saved layout had the whiteboard active (the user
          // closed the reader while in draw mode), reflect that in
          // the local toggle state. Without this, the next press of
          // the draw button would think the user is in viewer mode
          // and try to add a duplicate whiteboard.
          if (api.getPanel("pdfCanvasWhiteboard")) {
            setIsDrawMode(true);
          }
          // Set up layout persistence after restoring
          setupLayoutPersistence();
          return;
        } catch {
          // corrupted layout, fall through to default
        }
      }

      // Default layout: viewer only. The TOC submenu lives behind the
      // floating-circle button at top-left of the reader area; users
      // who want it always-on can pin it via that toggle and the
      // saved layout persists across sessions.
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
      });

      // Keep `resolvedWidth` referenced so the lint gate doesn't trip;
      // it's still used by `toggleSidebar` via `tocWidthRef` when the
      // user opens the TOC for the first time in this session.
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

          // Persist TOC width per document
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
  }, []);

  // Reading timer for streaks. Respects the active tracker's enabled
  // flag so "shallow reading" (tracker toggled off) doesn't quietly
  // accumulate streak time — the user explicitly said they're browsing
  // casually and the streak shouldn't fill up.
  useEffect(() => {
    if (!hasDocuments) return;

    let lastTick = Date.now();
    let accumulated = 0;

    const flush = () => {
      const now = Date.now();
      accumulated += (now - lastTick) / 1000;
      lastTick = now;
      if (accumulated >= 1) {
        const whole = Math.floor(accumulated);
        // Shallow-reading guard: only credit time toward streak when
        // the active tracker considers itself enabled. For the toggle
        // tracker that's its own `enabled` flag; other trackers
        // default to always-credit.
        const settingsState = useSettingsStore.getState();
        const activeId = settingsState.activeTrackerId;
        const activeSettings = settingsState.trackerSettings[activeId];
        const tracking =
          activeId !== "toggle" ||
          (activeSettings as { enabled?: boolean } | undefined)?.enabled !== false;
        if (tracking) {
          useStreakStore.getState().addReadingTime(whole);
        }
        accumulated -= whole;
      }
    };

    const interval = setInterval(() => {
      if (!document.hidden) {
        flush();
      }
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        flush();
      } else {
        lastTick = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flush();
    };
  }, [hasDocuments]);

  return (
    <div
      ref={readerContainerRef}
      // Mobile: leave room for the global BottomNav (3.5rem + safe-area)
      // at the viewport bottom — the user wants persistent app
      // navigation while reading. Desktop: still full viewport since
      // the nav is hidden there. Using `100dvh` so the dynamic viewport
      // (mobile Safari chrome shrink/grow) reports correctly.
      className="relative flex h-[calc(100dvh-3.5rem-var(--spacing-safe-bottom,0px))] flex-col bg-bg-primary md:h-screen"
    >
      {isLoadingDocument && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-accent-purple mb-3" />
          <p className="text-sm text-text-secondary">{loadingMessage}</p>
        </div>
      )}
      {hasDocuments && zenMode ? (
        <div className="relative flex-1 overflow-hidden bg-bg-primary">
          <ActiveViewer />
          <SearchOverlay />
          <button
            onClick={() => setZenMode(false)}
            className="group fixed right-4 top-4 z-50 rounded-full border border-glass-border bg-bg-secondary/70 p-2 text-text-muted opacity-30 backdrop-blur-md transition-opacity hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
            title={t("reader.page.exitZenTitle")}
            aria-label={t("reader.page.exitZen")}
          >
            <X size={16} />
          </button>
        </div>
      ) : hasDocuments ? (
        isMobile ? (
          <MobileReaderLayout
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            isDrawMode={isDrawMode}
            onToggleDrawMode={toggleDrawMode}
            onScreenshot={handleScreenshot}
            onScreenshotRect={handleRectScreenshotStart}
            onRectToAi={handleRectToAiStart}
            onPrint={handlePrint}
            onToggleZenMode={toggleZenMode}
          />
        ) : (
          <>
            <ReaderToolbar
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onToggleComments={toggleComments}
              isDrawMode={isDrawMode}
              onToggleDrawMode={toggleDrawMode}
              onScreenshot={handleScreenshot}
              onScreenshotRect={handleRectScreenshotStart}
              onRectToAi={handleRectToAiStart}
              onPrint={handlePrint}
              onToggleSearch={toggleSearch}
              onToggleAiChat={toggleAiChat}
              onToggleZenMode={toggleZenMode}
              onToggleSidebar={toggleSidebar}
            />
            <DocumentTabs />
            <div className="relative flex-1 overflow-hidden">
              <DockviewReact
                className="pnyxy-dockview-theme h-full w-full"
                onReady={handleDockviewReady}
                components={dockviewComponents}
              />
              {/* Floating-circle button for the reader's own submenu
                  (TOC / bookmarks / comments / AI chat). Sits below
                  the toolbar's hamburger so the two are visually
                  distinct: top-bar hamburger = global app sidebar,
                  this circle = reading-context panel. Toggles the
                  same Dockview "toc" panel that Ctrl+\\ binds. */}
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t("reader.toolbar.toggleSidebar")}
                title={t("reader.toolbar.toggleSidebar")}
                className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-glass-border bg-bg-secondary/80 text-text-secondary shadow-md backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <PanelLeft size={16} />
              </button>
              {/* SearchOverlay used to live here, at the Dockview
                  outer container — but its `right-4` pinned to the
                  whole-dockview right edge, overlapping the AI chat
                  panel when open. It now lives inside ViewerPanel so
                  the right edge stays aligned with the PDF viewer
                  panel itself. */}
            </div>
          </>
        )
      ) : (
        <EmptyState />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />
      {rectScreenshotActive && (
        <ScreenshotRectSelector
          onCapture={handleRectScreenshotCapture}
          onCancel={() => setRectScreenshotActive(false)}
        />
      )}
      {rectToAiActive && (
        <ScreenshotRectSelector
          onCapture={handleRectToAiCapture}
          onCancel={() => setRectToAiActive(false)}
        />
      )}
      {libraryPickerOpen && (
        <LibraryPickerModal
          onClose={() => setLibraryPickerOpen(false)}
        />
      )}
      <FocusSessionBadge />
      <PromptModal
        open={commentPromptSelection !== null}
        title={t("reader.addCommentTitle")}
        placeholder={t("reader.addCommentPlaceholder")}
        confirmLabel={t("reader.addCommentSubmit")}
        onClose={() => setCommentPromptSelection(null)}
        onSubmit={(text) => {
          if (commentPromptSelection) {
            useAnnotationStore
              .getState()
              .addComment(commentPromptSelection, text);
          }
        }}
      />
      <InlineDrawToolbar />
    </div>
  );
}
