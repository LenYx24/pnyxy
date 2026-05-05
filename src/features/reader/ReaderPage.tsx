import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { BookOpen, FilePlus, Loader2, X } from "lucide-react";
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
import { PdfViewer } from "./PdfViewer";
import { TextViewer } from "./TextViewer";
import { EpubViewer } from "./EpubViewer";
import { CommentsSidebar } from "./CommentsSidebar";
import { SearchOverlay } from "./SearchOverlay";
import { AiChatPanel, AiChatPanelContent } from "./AiChatPanel";
import { useMobileReaderGestures } from "./use-mobile-reader-gestures";
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
import { getFile } from "@/lib/file-store";
import { createAdapterForFile } from "./adapters";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useIsMobile } from "@/hooks/use-media-query";
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
    const whiteboardId = useWhiteboardStore.getState().createWhiteboard();
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

  if (!resolvedId || !doc) return <PdfViewer documentId={resolvedId} />;

  switch (format) {
    case "pdf":
      return <PdfViewer documentId={resolvedId} />;
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
  return <ActiveViewer documentId={props.params?.documentId} />;
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
    const id = useWhiteboardStore.getState().createWhiteboard();
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
  const setLiveZoomScale = useReaderStore((s) => s.setLiveZoomScale);
  const commitLiveZoom = useReaderStore((s) => s.commitLiveZoom);
  // Subscribe to the two primitives we actually use. Subscribing to
  // `getActiveDoc()` would re-render this component on every pinch
  // frame because setLiveZoomScale rebuilds the documents Map.
  const isPaginated = useReaderStore(
    (s) => s.getActiveDoc()?.meta.capabilities.paginated ?? false,
  );
  // Once the user picks a custom zoom (pinch-in past fit-width
  // typically), the page is wider than the viewport and they want
  // to pan with their finger like a map. Swipe-to-turn-page would
  // fight that, so we silence it for the custom-zoom case. At
  // fit-width / fit-page (the default modes) horizontal swipes
  // still flip pages — natural for at-a-glance reading.
  const isZoomedIn = useReaderStore(
    (s) => s.getActiveDoc()?.zoomMode === "custom",
  );

  const viewerRef = useRef<HTMLDivElement>(null);

  const { wasJustGestureRef } = useMobileReaderGestures({
    targetRef: viewerRef,
    enableSwipe:
      isPaginated && mobileReaderPanel === "none" && !isZoomedIn,
    enablePinch: mobileReaderPanel === "none",
    onSwipeLeft: nextPage,
    onSwipeRight: prevPage,
    // Pinch updates a CSS-only multiplier on every move — no
    // canvas re-rasterisation while the fingers are still down.
    // The actual zoomLevel is committed once on touchend below.
    onPinch: useCallback(
      (scale: number) => {
        setLiveZoomScale(scale);
      },
      [setLiveZoomScale],
    ),
  });

  // On gesture end, roll the live CSS scale into the real
  // zoomLevel — triggers exactly one canvas re-render at the
  // final resolution. Without this commit step the user would
  // see a blurry preview indefinitely.
  useEffect(() => {
    const commit = () => commitLiveZoom();
    window.addEventListener("touchend", commit);
    window.addEventListener("touchcancel", commit);
    return () => {
      window.removeEventListener("touchend", commit);
      window.removeEventListener("touchcancel", commit);
    };
  }, [commitLiveZoom]);

  const handleViewerTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mobileReaderPanel !== "none") return; // backdrop handles it
      if (wasJustGestureRef.current) return; // swipe/pinch just ended
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
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
    [mobileReaderPanel, toggleMobileChromeHidden, wasJustGestureRef],
  );

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
          onPrint={onPrint}
          onToggleSearch={handleToggleSearch}
          onToggleAiChat={handleToggleAiChat}
          onToggleZenMode={onToggleZenMode}
        />
      </div>
      <div
        ref={viewerRef}
        className="relative flex-1 overflow-hidden touch-pan-y"
        onClick={handleViewerTap}
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
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

  // Load document from file registry if navigated directly
  useEffect(() => {
    if (bookId && !bookDocumentLoaded) {
      const file = getFile(bookId);
      if (file) {
        const adapter = createAdapterForFile(file);
        addDocument(adapter, file);
      }
    }
  }, [bookId, bookDocumentLoaded, addDocument]);

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

  // Jump to ?page= once the doc is loaded — used by bookmark and
  // deep-links from the book page. Consumes the param on read so a
  // refresh doesn't re-snap the user back.
  useEffect(() => {
    if (!activeDocumentId) return;
    const pageParam = searchParams.get("page");
    if (!pageParam) return;
    const pageNum = Number.parseInt(pageParam, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    goToPage(pageNum);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [activeDocumentId, searchParams, setSearchParams, goToPage]);

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

  useKeyboardShortcut({
    id: "reader:prev-page",
    key: "ArrowLeft",
    description: "Previous page",
    handler: prevPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:next-page",
    key: "ArrowRight",
    description: "Next page",
    handler: nextPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:prev-page-up",
    key: "ArrowUp",
    description: "Previous page",
    handler: prevPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:next-page-down",
    key: "ArrowDown",
    description: "Next page",
    handler: nextPageHandler,
    preventDefault: false,
  });

  const toggleSidebar = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
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
        drawWhiteboardIdRef.current = useWhiteboardStore.getState().createWhiteboard();
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
      api.removePanel(panel);
    } else {
      api.addPanel({
        id: "aiChat",
        component: "aiChat",
        title: i18n.t("reader.page.panelAiChat"),
        position: { direction: "right" },
        initialWidth: 360,
      });
    }
  }, []);

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

      // Default layout: TOC left, PDF viewer center
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
      });

      api.addPanel({
        id: "toc",
        component: "toc",
        title: i18n.t("reader.page.panelToc"),
        position: { direction: "left", referencePanel: "pdfViewer" },
        initialWidth: resolvedWidth,
        minimumWidth: 180,
        maximumWidth: 400,
      });

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
      className="relative flex h-screen flex-col bg-bg-primary"
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
              <SearchOverlay />
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
    </div>
  );
}
