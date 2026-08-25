import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { DockviewReact, type DockviewApi } from "dockview";
import { PromptModal } from "@/components/ui";
import type { TextSelection } from "@/types/annotation";
import { ReaderToolbar } from "./ReaderToolbar";
import { DocumentTabs } from "./DocumentTabs";
import { ReaderEmptyState } from "./ReaderEmptyState";
import { LibraryPickerModal } from "./popovers/LibraryPickerModal";
import { InlineDrawToolbar } from "./controls/InlineDrawToolbar";
import { MobileReaderLayout } from "./MobileReaderLayout";
import { dockviewComponents } from "./dockview-components";
import { ActiveViewer } from "./viewers/ActiveViewer";
import { SearchOverlay } from "./popovers/SearchOverlay";
import {
  useMobileReaderGestures,
  type PinchEvent,
} from "./gestures/use-mobile-reader-gestures";
import { getZoomControls } from "./gestures/pinch-zoom-controller";
import { ScreenshotRectSelector } from "./popovers/ScreenshotRectSelector";
import { FocusSessionBadge } from "./controls/FocusSessionBadge";
import { useReaderStore } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useUIStore } from "@/stores/ui-store";
import { useSearchStore } from "@/stores/search-store";
import { useFeatures } from "@/lib/use-features";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useIsMobile, useMediaQuery } from "@/hooks/use-media-query";
import { useReaderDockLayout } from "./use-reader-dock-panels";
import { useReaderDocumentLoad } from "./hooks/useReaderDocumentLoad";
import { useReaderFullscreen } from "./hooks/useReaderFullscreen";
import { useReaderScreenshots } from "./hooks/useReaderScreenshots";
import { useReaderShortcuts } from "./hooks/useReaderShortcuts";
import { useReaderDrawMode } from "./hooks/useReaderDrawMode";
import { useReaderPrint } from "./hooks/useReaderPrint";
import { useReaderStreakTimer } from "./hooks/useReaderStreakTimer";
import { useReaderTint } from "./hooks/useReaderTint";

export function ReaderPage() {
  const { t } = useTranslation();
  const { bookId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  // Landscape phones dodge the 767px breakpoint but are too cramped for the
  // Dockview split-view, so treat short + touch as compact.
  const isMobilePortrait = useIsMobile();
  const isLandscapePhone = useMediaQuery(
    "(max-height: 500px) and (pointer: coarse)",
  );
  const isMobile = isMobilePortrait || isLandscapePhone;
  // Subscribe to derived booleans, not the documents Map: it churns a new
  // ref every pinch frame and would re-render the reader 60x/sec.
  const hasDocuments = useReaderStore((s) => s.documents.size > 0);
  const bookDocumentLoaded = useReaderStore((s) =>
    bookId ? s.documents.has(bookId) : false,
  );
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const features = useFeatures();
  const goToPage = useReaderStore((s) => s.goToPage);

  const libraryPickerOpen = useUIStore((s) => s.libraryPickerOpen);
  const setLibraryPickerOpen = useUIStore((s) => s.setLibraryPickerOpen);

  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const readerContainerRef = useRef<HTMLDivElement>(null);

  // Comment-via-shortcut: stash the selection, render PromptModal, commit on submit.
  const [commentPromptSelection, setCommentPromptSelection] =
    useState<TextSelection | null>(null);

  const { isDrawMode, setIsDrawMode, toggleDrawMode } = useReaderDrawMode(
    dockviewApiRef,
    activeDocumentId,
  );
  const onRestoredDrawMode = useCallback(() => setIsDrawMode(true), [setIsDrawMode]);
  const { handleDockviewReady, toggleSidebar, toggleComments, toggleAiChat } =
    useReaderDockLayout({ dockviewApiRef, isMobile, onRestoredDrawMode });

  // Pinch-zoom for touch tablets/laptops outside `isMobile` (iPad landscape,
  // Surface). Swipe off here to avoid double-firing the mobile gesture suite.
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

  useReaderDocumentLoad(bookId, bookDocumentLoaded);

  // Load annotations + bookmarks for the active document
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

  // Jump to ?page= once the right doc is loaded, then consume the param. Guard
  // on activeDocumentId matching bookId or a stale doc from /chat gets the jump.
  useEffect(() => {
    if (!activeDocumentId) return;
    if (bookId && activeDocumentId !== bookId) return;
    const pageParam = searchParams.get("page");
    if (!pageParam) return;
    const pageNum = Number.parseInt(pageParam, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    goToPage(pageNum);
    // Companion `q=` from citation chips: arm the citation slot so
    // CitationQuoteHighlightLayer picks it up when the page renders.
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

  useEffect(() => {
    useNoteStore.getState().loadNotes();
    useWhiteboardStore.getState().loadWhiteboards();
  }, []);

  const { isFullscreen, toggleFullscreen, zenMode, setZenMode, toggleZenMode } =
    useReaderFullscreen(readerContainerRef);

  const handlePrint = useReaderPrint();

  const {
    handleScreenshot,
    rectScreenshotActive,
    handleRectScreenshotStart,
    handleRectScreenshotCapture,
    cancelRectScreenshot,
    rectToAiActive,
    handleRectToAiStart,
    handleRectToAiCapture,
    cancelRectToAi,
  } = useReaderScreenshots();

  const toggleSearch = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen && store.mode === "find") store.close();
    else store.open("find");
  }, []);

  const toggleReplace = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen && store.mode === "replace") store.close();
    else store.open("replace");
  }, []);

  useReaderShortcuts({
    triggerFilePicker,
    toggleSidebar,
    toggleFullscreen,
    toggleZenMode,
    onAddComment: setCommentPromptSelection,
    handlePrint,
    handleScreenshot,
    toggleSearch,
    toggleReplace,
    toggleComments,
    toggleAiChat,
  });

  useReaderStreakTimer(hasDocuments);

  // 6% cover tint over the desk colour (see dockview-theme.css / .reader-shell)
  const readerTint = useReaderTint(activeDocumentId);

  return (
    <div
      ref={readerContainerRef}
      // Full dynamic viewport on every breakpoint. `100dvh` accounts for the
      // URL-bar shrink/grow on mobile Safari; the bottom bar pads safe-area itself.
      className="reader-shell relative flex h-[100dvh] flex-col md:h-screen"
      style={
        readerTint
          ? ({ "--reader-tint": readerTint } as React.CSSProperties)
          : undefined
      }
    >
      {hasDocuments && zenMode ? (
        <div className="relative flex-1 overflow-hidden">
          <ActiveViewer />
          <SearchOverlay />
          <button
            onClick={() => setZenMode(false)}
            className="group fixed right-4 top-4 z-50 rounded-full bg-bg-tertiary p-2 text-text-muted opacity-30 shadow-page transition-opacity hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
            title={t("reader.page.exitZenTitle")}
            aria-label={t("reader.page.exitZen")}
          >
            <X size={16} strokeWidth={1.5} />
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
            {features.multiDoc && <DocumentTabs />}
            <div className="relative flex-1 overflow-hidden">
              <DockviewReact
                className="pnyxy-dockview-theme h-full w-full"
                onReady={handleDockviewReady}
                components={dockviewComponents}
              />
              {/* The TOC toggle lives in the header (next to the back
                  chevron) and in the kebab; Ctrl+\\ binds the same. */}
              {/* SearchOverlay lives inside ViewerPanel, not here: its `right-4`
                  would pin to the dockview edge and overlap the open AI chat panel. */}
            </div>
          </>
        )
      ) : (
        <ReaderEmptyState />
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
          onCancel={cancelRectScreenshot}
        />
      )}
      {rectToAiActive && (
        <ScreenshotRectSelector
          onCapture={handleRectToAiCapture}
          onCancel={cancelRectToAi}
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
