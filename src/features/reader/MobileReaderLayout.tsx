import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { PromptModal } from "@/components/ui";
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
import { AiChatPanelContent } from "./panels/AiChatPanel";
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

/**
 * Mobile-only reader layout. Owns the overlay toolbar, the bottom
 * action bar, the sliding panels (TOC / comments / AI chat), and the
 * touch-gesture wiring (swipe to turn pages, pinch to zoom, single-
 * tap to toggle chrome, double-tap to zoom). The desktop / tablet
 * surface uses Dockview instead and is rendered from ReaderPage.
 */
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
  const isPaginated = useReaderStore(
    (s) => s.getActiveDoc()?.meta.capabilities.paginated ?? false,
  );
  // Once the user has zoomed in past ~110%, they want to pan
  // horizontally like a map; swipe-to-turn-page would fight that.
  const isZoomedIn = useReaderStore(
    (s) =>
      (s.getActiveDoc()?.zoomMode === "custom" &&
        (s.getActiveDoc()?.zoomLevel ?? 100) > 110) ||
      s.getActiveDoc()?.zoomMode === "fit-page",
  );

  const viewerRef = useRef<HTMLDivElement>(null);

  // Single-tap toggles the chrome (toolbar / bottom bar). Skipped on
  // taps that landed on an interactive child and on taps that happen
  // while the user has a text selection — pdf.js's selection handles
  // can otherwise dismiss themselves before the user can interact
  // with them.
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
      // Skip when the annotation context menu is up — tapping
      // outside it should dismiss the menu (handled elsewhere), not
      // also toggle the reader chrome.
      if (useAnnotationStore.getState().contextMenu.visible) return;
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
          Android WebView. */}

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
