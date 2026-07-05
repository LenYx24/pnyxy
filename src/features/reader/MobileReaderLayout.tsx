import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useSearchStore } from "@/stores/search-store";
import { useReaderStore } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useBackToClose } from "@/hooks/use-back-to-close";
import { ReaderSidebarContent } from "./ReaderSidebar";
import { ReaderToolbar } from "./ReaderToolbar";
import { MobileReaderBottomBar } from "./MobileReaderBottomBar";
import { ActiveViewer } from "./viewers/ActiveViewer";
import { SearchOverlay } from "./popovers/SearchOverlay";
import { CommentsSidebar } from "./panels/CommentsSidebar";
import { ReaderToolsPanelContent } from "./panels/ReaderToolsPanel";
import {
  useMobileReaderGestures,
  type PinchEvent,
  type TapEvent,
} from "./gestures/use-mobile-reader-gestures";
import { getZoomControls } from "./gestures/pinch-zoom-controller";

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

/** Mobile reader layout: overlay toolbar, bottom bar, sliding panels, touch gestures. Desktop uses Dockview. */
export function MobileReaderLayout({
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

  // whiteboard opens as a full page route on mobile; close panel first so the slide-over isn't stuck open
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

  // ESC closes panels (external keyboards on tablets)
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

  // Android back gesture closes the open panel instead of leaving the reader
  useBackToClose(
    mobileReaderPanel !== "none",
    useCallback(() => setMobileReaderPanel("none"), [setMobileReaderPanel]),
  );

  const toggleMobileChromeHidden = useUIStore(
    (s) => s.toggleMobileChromeHidden,
  );
  const setMobileChromeHidden = useUIStore((s) => s.setMobileChromeHidden);
  const mobileChromeHidden = useUIStore((s) => s.mobileChromeHidden);
  const chromeVisible = !mobileChromeHidden || mobileReaderPanel !== "none";
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);

  // start each doc with chrome hidden
  useEffect(() => {
    setMobileChromeHidden(true);
  }, [activeDocumentId, setMobileChromeHidden]);

  // swipe page-turns are PDF-only; EPUB/markdown/text lack discrete pages
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  const isPaginated = useReaderStore(
    (s) => s.getActiveDoc()?.meta.capabilities.paginated ?? false,
  );
  // past ~110% zoom, horizontal drag should pan not turn pages
  const isZoomedIn = useReaderStore(
    (s) =>
      (s.getActiveDoc()?.zoomMode === "custom" &&
        (s.getActiveDoc()?.zoomLevel ?? 100) > 110) ||
      s.getActiveDoc()?.zoomMode === "fit-page",
  );

  const viewerRef = useRef<HTMLDivElement>(null);

  // single-tap toggles chrome; skip interactive targets and active text selections (pdf.js selection handles)
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
      // don't toggle chrome while the annotation context menu is up
      if (useAnnotationStore.getState().contextMenu.visible) return;
      toggleMobileChromeHidden();
    },
    [mobileReaderPanel, toggleMobileChromeHidden],
  );

  // double-tap toggles 1x/2x zoom anchored at tap point, driving the tray controller directly
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
    enableSwipe: isPaginated && mobileReaderPanel === "none" && !isZoomedIn,
    enablePinch: mobileReaderPanel === "none",
    onSwipeLeft: nextPage,
    onSwipeRight: prevPage,
    onSingleTap: handleSingleTap,
    onDoubleTap: handleDoubleTap,
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
      {/* absolute overlay so the viewer keeps full screen; slides off when chrome hidden */}
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
      />

      {/* backdrop: covers full viewport incl. top safe-inset so any outside tap dismisses */}
      {mobileReaderPanel !== "none" && (
        <div
          className="absolute inset-0 z-30 bg-black/40"
          onClick={() => setMobileReaderPanel("none")}
        />
      )}

      {/* Wrappers stay mounted so CSS animates the slide; contents mount only when active,
          keeping their side effects (scroll-into-view, textarea resize, visualViewport listeners)
          off every reader render. */}

      {/* TOC panel - slides from left */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 z-40 flex w-full flex-col border-r border-glass-border bg-bg-secondary transition-transform duration-300 pt-safe-top pb-safe-bottom pl-safe-left",
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
          // opaque (no backdrop-blur): a full-viewport blur repaints on every
          // keyboard-driven visualViewport resize, which made the composer lag
          "absolute right-0 top-0 bottom-0 z-40 flex w-full flex-col border-l border-glass-border bg-bg-secondary transition-transform duration-300 pt-safe-top pb-safe-bottom pr-safe-right",
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
          // opaque (no backdrop-blur): a full-viewport blur repaints on every
          // keyboard-driven visualViewport resize, which made the composer lag
          "absolute right-0 top-0 bottom-0 z-40 flex w-full flex-col border-l border-glass-border bg-bg-secondary transition-transform duration-300 pt-safe-top pb-safe-bottom pr-safe-right",
          mobileReaderPanel === "aiChat"
            ? "translate-x-0"
            : "translate-x-full pointer-events-none",
        )}
      >
        {mobileReaderPanel === "aiChat" && (
          <ReaderToolsPanelContent onClose={() => setMobileReaderPanel("none")} />
        )}
      </div>

    </div>
  );
}
