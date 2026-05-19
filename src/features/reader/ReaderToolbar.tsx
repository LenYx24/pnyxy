import { useRef, useState, useCallback } from "react";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { getZoomControls } from "./gestures/pinch-zoom-controller";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Columns2,
  Maximize,
  Minimize,
  Focus,
  Highlighter,
  MessageSquare,
  Undo2,
  PenTool,
  Pencil,
  Camera,
  Crop,
  Printer,
  Search,
  MoreHorizontal,
  BotMessageSquare,
  BookmarkPlus,
  PanelLeft,
  Menu,
  AlignLeft,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { useReaderStore, useActiveDocument, type ZoomMode } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useUndoStore } from "@/stores/undo-store";
import { useIsMobile, useIsDesktop } from "@/hooks/use-media-query";
import { ReadingTrackerControl } from "./controls/ReadingTrackerControl";
import { FocusSessionControl } from "./controls/FocusSessionControl";
import type { HighlightColor } from "@/types/annotation";

const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "orange"];
const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

function ZoomInput({
  zoomMode,
  zoomLevel,
  onSubmit,
  onCycleMode,
}: {
  zoomMode: ZoomMode;
  zoomLevel: number;
  onSubmit: (level: number) => void;
  onCycleMode: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Round for display only — the store keeps zoomLevel as a float so
  // gesture commits round-trip exactly, but the toolbar shows whole
  // percentages.
  const displayText =
    zoomMode === "custom"
      ? `${Math.round(zoomLevel)}%`
      : zoomMode === "fit-width"
        ? t("reader.toolbar.fitWidth")
        : t("reader.toolbar.fitPage");

  const handleStartEdit = useCallback(() => {
    setInputValue(String(Math.round(zoomLevel)));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [zoomLevel]);

  const handleSubmit = useCallback(() => {
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed) && parsed >= 25 && parsed <= 400) {
      onSubmit(parsed);
    }
    setEditing(false);
  }, [inputValue, onSubmit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-12 rounded border border-glass-border bg-glass-bg px-1 py-0.5 text-center text-xs text-text-primary outline-none focus:border-accent-purple"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={handleStartEdit}
      onDoubleClick={(e) => {
        e.preventDefault();
        onCycleMode();
      }}
      className="min-w-[3rem] rounded px-1 py-0.5 text-center text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      title={t("reader.toolbar.zoomCustomTitle")}
    >
      {displayText}
    </button>
  );
}

interface ReaderToolbarProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleComments?: () => void;
  isDrawMode?: boolean;
  onToggleDrawMode?: () => void;
  onScreenshot?: () => void;
  onScreenshotRect?: () => void;
  /** "Crop a region from the page and send it to the AI chat as
   *  an image attachment" — the rect equivalent of the OCR /
   *  send-to-chat flow for when text selection isn't viable. */
  onRectToAi?: () => void;
  onPrint?: () => void;
  onToggleSearch?: () => void;
  onToggleAiChat?: () => void;
  onToggleZenMode?: () => void;
  onToggleSidebar?: () => void;
}

export function ReaderToolbar({
  isFullscreen,
  onToggleFullscreen,
  onToggleComments,
  isDrawMode,
  onToggleDrawMode,
  onScreenshot,
  onScreenshotRect,
  onRectToAi,
  onPrint,
  onToggleSearch,
  onToggleAiChat,
  onToggleZenMode,
  onToggleSidebar,
}: ReaderToolbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // The opener (book detail, library, bookmarks, etc.) stashes its
  // path in `location.state.from` when navigating to /reader.
  // - state.from set → step back via history so we land on the exact
  //   entry the user came from without leaving a duplicate in the
  //   stack (otherwise browser-back would yo-yo back into /reader).
  // - no state → user landed here from a direct URL or external link,
  //   fall back to /library which was the old unconditional behavior.
  const fromPath = (location.state as { from?: string } | null)?.from ?? null;
  const handleBack = useCallback(() => {
    if (fromPath) navigate(-1);
    else navigate("/library");
  }, [fromPath, navigate]);
  const activeDoc = useActiveDocument();
  const inlineDrawActive = useInlineDrawStore((s) => s.active);
  const toggleInlineDraw = useInlineDrawStore((s) => s.toggleActive);
  const goToPage = useReaderStore((s) => s.goToPage);
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);
  const setZoomLevel = useReaderStore((s) => s.setZoomLevel);

  // Zoom buttons base their step off the LIVE visual scale rather
  // than `doc.zoomLevel` from the store. Reason: when a page first
  // mounts at fit-to-width the actual rendered scale can be e.g.
  // 150% while the store still reads its initial 100%, so the
  // first tap on zoom-in would jump back to 115%. Reading from the
  // pinch-zoom-controller (which the PdfViewer mutates synchronously
  // on every gesture / fit change) is the only source that's
  // always in lockstep with what's on screen. Falls back to the
  // store value when no viewer is mounted (e.g. EPUB/text reader).
  const handleZoomIn = useCallback(() => {
    const controls = getZoomControls();
    if (controls) {
      const current = controls.getScale() * 100;
      setZoomLevel(current + 15);
    } else {
      zoomIn();
    }
  }, [setZoomLevel, zoomIn]);

  const handleZoomOut = useCallback(() => {
    const controls = getZoomControls();
    if (controls) {
      const current = controls.getScale() * 100;
      setZoomLevel(current - 15);
    } else {
      zoomOut();
    }
  }, [setZoomLevel, zoomOut]);
  const setCustomTitle = useReaderStore((s) => s.setCustomTitle);
  const getDisplayTitle = useReaderStore((s) => s.getDisplayTitle);
  const rotatePage = useReaderStore((s) => s.rotatePage);
  const pdfInvertColors = useSettingsStore((s) => s.pdfInvertColors);
  const setPdfInvertColors = useSettingsStore((s) => s.setPdfInvertColors);
  const pdfReflowMode = useSettingsStore((s) => s.pdfReflowMode);
  const setPdfReflowMode = useSettingsStore((s) => s.setPdfReflowMode);
  const isPdf = activeDoc?.meta.format === "pdf";

  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const activeHighlightColor = useAnnotationStore((s) => s.activeHighlightColor);
  const setActiveHighlightColor = useAnnotationStore((s) => s.setActiveHighlightColor);
  const canUndo = useUndoStore((s) => s.stack.length > 0);
  const performUndo = useUndoStore((s) => s.performUndo);
  const [pageInput, setPageInput] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  // Shared anchor for the highlight-color picker across all three
  // breakpoint variants. The toolbar's outer wrapper is `z-20` and
  // creates its own stacking context, so an `absolute` popover
  // inside it can't beat anything the dockview area puts above z-20.
  // Portaling via FloatingMenu (z-[100] at the body level) bypasses
  // that trap. Only one of the three highlight-color buttons is
  // mounted per breakpoint, so a single shared ref is enough — the
  // last button to render wins, which matches what's actually
  // visible on screen.
  const highlightAnchorRef = useRef<HTMLButtonElement>(null);

  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();
  // The hamburger toggles different drawers per breakpoint: on
  // desktop/tablet it expands the persistent app sidebar back into
  // view (collapsed for reading by default), on mobile it slides in
  // the global nav drawer instead. The global BottomNav is hidden on
  // the reader route, so this button is the user's one path back to
  // every other surface from inside a book.
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const showAppSidebarToggle = isMobile || sidebarCollapsed;

  if (!activeDoc) return null;

  const { currentPage, totalPages, zoomMode, zoomLevel } = activeDoc;

  const submitPageInput = () => {
    const page = parseInt(pageInput, 10);
    if (!isNaN(page)) {
      goToPage(page);
    }
    setPageInput("");
  };

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitPageInput();
  };

  const handleBookmarkPage = () => {
    if (!activeDoc) return;
    addBookmark(activeDoc.currentPage);
  };

  const overflowActions = [
    { label: t("reader.toolbar.bookmarkPage"), icon: BookmarkPlus, onClick: handleBookmarkPage },
    { label: t("reader.toolbar.zoomIn"), icon: ZoomIn, onClick: handleZoomIn },
    { label: t("reader.toolbar.zoomOut"), icon: ZoomOut, onClick: handleZoomOut },
    { label: t("reader.toolbar.fitMode"), icon: Columns2, onClick: () => setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width") },
    // PDF-only actions: rotation cycles through 0/90/180/270 in 90°
    // CW steps, night mode flips invert-colors. EPUB/markdown/text
    // use their own theme tokens and don't have a rasterized canvas
    // to rotate.
    ...(isPdf
      ? [
          {
            label: t("reader.toolbar.rotate"),
            icon: RotateCw,
            onClick: () => rotatePage(1),
          },
          {
            label: pdfInvertColors
              ? t("reader.toolbar.nightModeOff")
              : t("reader.toolbar.nightModeOn"),
            icon: pdfInvertColors ? Sun : Moon,
            onClick: () => setPdfInvertColors(!pdfInvertColors),
          },
          {
            label: pdfReflowMode
              ? t("reader.toolbar.reflowOff")
              : t("reader.toolbar.reflowOn"),
            icon: AlignLeft,
            onClick: () => setPdfReflowMode(!pdfReflowMode),
          },
        ]
      : []),
    { label: t("reader.toolbar.highlight"), icon: Highlighter, onClick: () => { setShowOverflowMenu(false); setShowColorPicker(!showColorPicker); } },
    {
      label: inlineDrawActive
        ? t("reader.toolbar.inlineDrawOff", { defaultValue: "Stop drawing" })
        : t("reader.toolbar.inlineDrawOn", {
            defaultValue: "Quick draw on page",
          }),
      icon: Pencil,
      onClick: () => {
        setShowOverflowMenu(false);
        toggleInlineDraw();
      },
    },
    ...(onToggleDrawMode ? [{ label: isDrawMode ? t("reader.toolbar.exitDraw") : t("reader.toolbar.draw"), icon: PenTool, onClick: onToggleDrawMode }] : []),
    { label: t("reader.toolbar.undo"), icon: Undo2, onClick: performUndo, disabled: !canUndo },
    { label: t("reader.toolbar.screenshot"), icon: Camera, onClick: onScreenshot },
    { label: t("reader.toolbar.screenshotArea"), icon: Crop, onClick: onScreenshotRect },
    ...(onRectToAi
      ? [{ label: t("reader.toolbar.rectToAi", { defaultValue: "Crop to AI" }), icon: BotMessageSquare, onClick: onRectToAi }]
      : []),
    { label: t("reader.toolbar.print"), icon: Printer, onClick: onPrint },
    { label: t("reader.toolbar.search"), icon: Search, onClick: onToggleSearch },
    { label: t("reader.toolbar.comments"), icon: MessageSquare, onClick: onToggleComments },
    { label: t("reader.toolbar.aiChat"), icon: BotMessageSquare, onClick: onToggleAiChat },
    ...(onToggleSidebar ? [{ label: t("reader.toolbar.toggleSidebar"), icon: PanelLeft, onClick: onToggleSidebar }] : []),
    { label: t("reader.toolbar.zenMode"), icon: Focus, onClick: onToggleZenMode },
    { label: isFullscreen ? t("reader.toolbar.exitFullscreen") : t("reader.toolbar.fullscreen"), icon: isFullscreen ? Minimize : Maximize, onClick: onToggleFullscreen },
  ];

  const tabletOverflowActions = [
    { label: t("reader.toolbar.screenshot"), icon: Camera, onClick: onScreenshot },
    { label: t("reader.toolbar.screenshotArea"), icon: Crop, onClick: onScreenshotRect },
    ...(onRectToAi
      ? [{ label: t("reader.toolbar.rectToAi", { defaultValue: "Crop to AI" }), icon: BotMessageSquare, onClick: onRectToAi }]
      : []),
    { label: t("reader.toolbar.print"), icon: Printer, onClick: onPrint },
    // PDF-only view-mode toggles. Same items as the desktop inline
    // buttons added below — kept here so tablet users can find them
    // without a separate inline slot in the tablet header (tight
    // horizontal budget at this breakpoint).
    ...(isPdf
      ? [
          {
            label: pdfReflowMode
              ? t("reader.toolbar.reflowOff")
              : t("reader.toolbar.reflowOn"),
            icon: AlignLeft,
            onClick: () => setPdfReflowMode(!pdfReflowMode),
          },
        ]
      : []),
  ];

  // Mobile shrinks the toolbar's vertical footprint: smaller height,
  // smaller icon set, tighter button padding, and a compact page
  // input. Desktop keeps the original generous chrome. One source of
  // truth so the three breakpoint branches below don't drift.
  const iconSize = isMobile ? 14 : 16;
  const btnPad = isMobile ? "p-1" : "p-1.5";

  return (
    <div className="border-b border-glass-border bg-bg-secondary/60 backdrop-blur-md pt-safe-top pl-safe-left pr-safe-right">
    <div className={cn(
      "flex items-center justify-between px-2 sm:px-4",
      isMobile ? "h-9" : "h-11",
    )}>
      {/* Left: hamburger (only when sidebar is hidden — toggles the
          global app sidebar back into view), back button, title
          (click to edit) */}
      <div className="flex flex-1 min-w-0 items-center gap-1">
        {showAppSidebarToggle && (
          <button
            onClick={() => {
              if (isMobile) {
                setMobileSidebarOpen(true);
              } else {
                useUIStore.getState().toggleSidebar();
              }
            }}
            className={cn(
              "rounded-md text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer shrink-0",
              btnPad,
            )}
            title={t("reader.toolbar.toggleAppSidebar")}
          >
            <Menu size={iconSize} />
          </button>
        )}
        <button
          onClick={handleBack}
          className={cn(
            "rounded-md text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer shrink-0",
            btnPad,
          )}
          title={t("reader.toolbar.backToLibrary")}
        >
          <ArrowLeft size={iconSize} />
        </button>
        <div className="min-w-0 flex-1">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={() => {
              const trimmed = titleInput.trim();
              setCustomTitle(trimmed || null);
              setIsEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = titleInput.trim();
                setCustomTitle(trimmed || null);
                setIsEditingTitle(false);
              } else if (e.key === "Escape") {
                setIsEditingTitle(false);
              }
            }}
            className="w-full bg-glass-bg border border-glass-border rounded px-2 py-0.5 text-sm text-text-primary outline-none focus:border-accent-purple"
            autoFocus
          />
        ) : (
          <span
            className="text-sm text-text-secondary truncate block cursor-pointer hover:text-text-primary transition-colors"
            onClick={() => {
              setTitleInput(getDisplayTitle());
              setIsEditingTitle(true);
            }}
            title={t("reader.toolbar.renameTitle")}
          >
            {getDisplayTitle()}
          </span>
        )}
        </div>
      </div>

      {/* Center: page navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => prevPage()}
          disabled={currentPage <= 1}
          className={cn(
            "rounded-md transition-colors cursor-pointer touch-target",
            btnPad,
            "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            "disabled:opacity-30 disabled:cursor-not-allowed",
          )}
        >
          <ChevronLeft size={iconSize} />
        </button>

        <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
          <input
            data-page-input
            type="text"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            // Belt-and-braces: rely on form's implicit-submit-on-Enter
            // for the desktop happy path, but also handle Enter on
            // keydown directly. Some embedded webviews (Tauri / iOS
            // PWA in standalone mode) swallow the synthetic Enter on
            // single-input forms when the input is rendered inside a
            // flex/grid container nested deep enough; the keydown
            // listener guarantees the jump fires regardless.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitPageInput();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder={String(currentPage)}
            className={cn(
              "rounded border border-glass-border bg-glass-bg px-1.5 py-0.5 text-center font-semibold text-text-primary outline-none focus:border-accent-purple",
              isMobile ? "w-10 text-xs" : "w-12 text-sm",
            )}
          />
          <span className={cn(
            "font-medium text-text-secondary",
            isMobile ? "text-xs" : "text-sm",
          )}>/ {totalPages}</span>
        </form>

        <button
          onClick={() => nextPage()}
          disabled={currentPage >= totalPages}
          className={cn(
            "rounded-md transition-colors cursor-pointer touch-target",
            btnPad,
            "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            "disabled:opacity-30 disabled:cursor-not-allowed",
          )}
        >
          <ChevronRight size={iconSize} />
        </button>

        {/* Lookup actions — Search and AI chat sit next to page nav
            because they're "interrupt my reading to find / ask
            something" actions, not toolbar tools. Mobile keeps them
            in the overflow menu (this center block stays compact). */}
        {!isMobile && (
          <>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <button
              onClick={onToggleSearch}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.searchTitle")}
            >
              <Search size={16} />
            </button>
            <button
              onClick={onToggleAiChat}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.aiChatTitle")}
            >
              <BotMessageSquare size={16} />
            </button>
          </>
        )}
      </div>

      {/* Right section */}
      <div className="flex flex-1 items-center justify-end gap-1">
        {/* MOBILE: tracker + overflow */}
        {isMobile && (
          <>
            <ReadingTrackerControl compact />
            <FocusSessionControl compact />
          <div className="relative" ref={overflowRef}>
            <button
              onClick={() => setShowOverflowMenu(!showOverflowMenu)}
              className={cn(
                "rounded-md text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer touch-target",
                btnPad,
              )}
            >
              <MoreHorizontal size={iconSize} />
            </button>
            {showOverflowMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                {/* Cap the menu to ~70% of the dynamic viewport and
                    overflow-y-auto so the long action list (highlight,
                    screenshot, reflow, invert, …) can be scrolled
                    instead of being clipped against the bottom of the
                    screen on short phones. */}
                <div className="absolute right-0 top-full z-50 mt-1 w-48 max-h-[70dvh] overflow-y-auto rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl py-1">
                  {overflowActions.map(({ label, icon: Icon, onClick, disabled }) => (
                    <button
                      key={label}
                      onClick={() => {
                        if (onClick) onClick();
                        setShowOverflowMenu(false);
                      }}
                      disabled={disabled}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 cursor-pointer"
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          </>
        )}

        {/* TABLET: most buttons visible, screenshot/print in overflow */}
        {!isMobile && !isDesktop && (
          <>
            <button
              onClick={handleZoomOut}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ZoomOut size={16} />
            </button>
            <ZoomInput
              zoomMode={zoomMode}
              zoomLevel={zoomLevel}
              onSubmit={(level) => setZoomLevel(level)}
              onCycleMode={() => setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width")}
            />
            <button
              onClick={handleZoomIn}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={() => setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width")}
              className={cn(
                "rounded-md p-1.5 transition-colors cursor-pointer",
                zoomMode !== "custom"
                  ? "text-accent-purple bg-accent-purple/10"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
              title={t("reader.toolbar.toggleFitMode")}
            >
              <Columns2 size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <button
              onClick={performUndo}
              disabled={!canUndo}
              className={cn(
                "rounded-md p-1.5 transition-colors cursor-pointer",
                "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                "disabled:opacity-30 disabled:cursor-not-allowed",
              )}
              title={t("reader.toolbar.undoTitle")}
            >
              <Undo2 size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Highlight color trigger (tablet). The picker itself
                is portaled at the bottom of the file — see
                FloatingMenu mount below. */}
            <button
              ref={highlightAnchorRef}
              onClick={() => setShowColorPicker((v) => !v)}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer flex items-center gap-1"
              title={t("reader.toolbar.highlightColor")}
            >
              <Highlighter size={16} />
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: COLOR_HEX[activeHighlightColor] }}
              />
            </button>
            {onToggleDrawMode && (
              <button
                onClick={onToggleDrawMode}
                className={cn(
                  "rounded-md p-1.5 transition-colors cursor-pointer",
                  isDrawMode
                    ? "text-accent-purple bg-accent-purple/10"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
                title={isDrawMode ? t("reader.toolbar.backToPdf") : t("reader.toolbar.drawOnPdf")}
              >
                <PenTool size={16} />
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <button
              onClick={onToggleComments}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.commentsTitle")}
            >
              <MessageSquare size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <ReadingTrackerControl />
            <FocusSessionControl />
            <button
              onClick={onToggleZenMode}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.zenMode")}
            >
              <Focus size={16} />
            </button>
            <button
              onClick={onToggleFullscreen}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={isFullscreen ? t("reader.toolbar.exitFullscreen") : t("reader.toolbar.fullscreen")}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
            {/* Overflow for screenshot/print */}
            <div className="relative">
              <button
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <MoreHorizontal size={16} />
              </button>
              {showOverflowMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-40 max-h-[70dvh] overflow-y-auto rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl py-1">
                    {tabletOverflowActions.map(({ label, icon: Icon, onClick }) => (
                      <button
                        key={label}
                        onClick={() => {
                          if (onClick) onClick();
                          setShowOverflowMenu(false);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                      >
                        <Icon size={16} />
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* DESKTOP: full toolbar (original layout) */}
        {isDesktop && (
          <>
            <button
              onClick={handleZoomOut}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ZoomOut size={16} />
            </button>
            <ZoomInput
              zoomMode={zoomMode}
              zoomLevel={zoomLevel}
              onSubmit={(level) => setZoomLevel(level)}
              onCycleMode={() => setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width")}
            />
            <button
              onClick={handleZoomIn}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={() =>
                setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width")
              }
              className={cn(
                "rounded-md p-1.5 transition-colors cursor-pointer",
                zoomMode !== "custom"
                  ? "text-accent-purple bg-accent-purple/10"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
              title={t("reader.toolbar.toggleFitMode")}
            >
              <Columns2 size={16} />
            </button>
            {/* PDF mobile-reflow toggle. Active state mirrors how the
                fit-mode toggle highlights itself when on, so the user
                can spot at a glance which view they're in. */}
            {isPdf && (
              <button
                onClick={() => setPdfReflowMode(!pdfReflowMode)}
                className={cn(
                  "rounded-md p-1.5 transition-colors cursor-pointer",
                  pdfReflowMode
                    ? "text-accent-purple bg-accent-purple/10"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
                title={
                  pdfReflowMode
                    ? t("reader.toolbar.reflowOff")
                    : t("reader.toolbar.reflowOn")
                }
                aria-label={
                  pdfReflowMode
                    ? t("reader.toolbar.reflowOff")
                    : t("reader.toolbar.reflowOn")
                }
              >
                <AlignLeft size={16} />
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Undo button */}
            <button
              onClick={performUndo}
              disabled={!canUndo}
              className={cn(
                "rounded-md p-1.5 transition-colors cursor-pointer",
                "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                "disabled:opacity-30 disabled:cursor-not-allowed",
              )}
              title={t("reader.toolbar.undoTitle")}
            >
              <Undo2 size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Highlight color trigger (desktop). Picker portaled
                via FloatingMenu at the end of the toolbar. */}
            <button
              ref={highlightAnchorRef}
              onClick={() => setShowColorPicker((v) => !v)}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer flex items-center gap-1"
              title={t("reader.toolbar.highlightColor")}
            >
              <Highlighter size={16} />
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: COLOR_HEX[activeHighlightColor] }}
              />
            </button>
            {/* Toggle draw mode on PDF */}
            {onToggleDrawMode && (
              <button
                onClick={onToggleDrawMode}
                className={cn(
                  "rounded-md p-1.5 transition-colors cursor-pointer",
                  isDrawMode
                    ? "text-accent-purple bg-accent-purple/10"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
                title={isDrawMode ? t("reader.toolbar.backToPdf") : t("reader.toolbar.drawOnPdf")}
              >
                <PenTool size={16} />
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Screenshot */}
            <button
              onClick={onScreenshot}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.screenshotTitle")}
            >
              <Camera size={16} />
            </button>
            {/* Area (rectangle) screenshot */}
            <button
              onClick={onScreenshotRect}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.screenshotAreaTitle")}
            >
              <Crop size={16} />
            </button>
            {/* Crop a region and send it to the AI chat as an
                image attachment — useful when text selection isn't
                viable (scanned PDFs, math, image-only pages). */}
            {onRectToAi && (
              <button
                onClick={onRectToAi}
                className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                title={t("reader.toolbar.rectToAiTitle", {
                  defaultValue: "Crop region and send to AI chat",
                })}
                aria-label={t("reader.toolbar.rectToAiTitle", {
                  defaultValue: "Crop region and send to AI chat",
                })}
              >
                <BotMessageSquare size={16} />
              </button>
            )}
            {/* Print */}
            <button
              onClick={onPrint}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.printTitle")}
            >
              <Printer size={16} />
            </button>
            {/* Comments panel toggle */}
            <button
              onClick={onToggleComments}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.commentsTitle")}
            >
              <MessageSquare size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <ReadingTrackerControl />
            <FocusSessionControl />
            <button
              onClick={onToggleZenMode}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("reader.toolbar.zenMode")}
            >
              <Focus size={16} />
            </button>
            <button
              onClick={onToggleFullscreen}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={isFullscreen ? t("reader.toolbar.exitFullscreen") : t("reader.toolbar.fullscreen")}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </>
        )}
      </div>

      {/* Highlight-color picker — portaled to the body via
          FloatingMenu so it escapes the toolbar wrapper's z-20
          stacking context (the PDF viewer in the dockview area
          was painting over the inline popover otherwise). One
          mount serves all three breakpoints; the anchor switches
          to the mobile overflow button when on phones since
          that's where the picker is triggered from. */}
      <FloatingMenu
        open={showColorPicker}
        anchorRef={isMobile ? overflowRef : highlightAnchorRef}
        onClose={() => setShowColorPicker(false)}
        className="!min-w-0 flex gap-1 p-2"
      >
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            className={cn(
              "rounded-full border-2 transition-colors cursor-pointer hover:scale-110",
              isMobile ? "h-7 w-7 touch-target" : "h-5 w-5",
              activeHighlightColor === color
                ? "border-white/60"
                : "border-transparent",
            )}
            style={{ backgroundColor: COLOR_HEX[color] }}
            onClick={() => {
              setActiveHighlightColor(color);
              setShowColorPicker(false);
            }}
          />
        ))}
      </FloatingMenu>
    </div>
    </div>
  );
}
