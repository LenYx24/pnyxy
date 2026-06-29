import { useEffect, useRef, useState, useCallback, Fragment, type ReactNode } from "react";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { getZoomControls } from "./gestures/pinch-zoom-controller";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Sun,
  Moon,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Columns2,
  Minus,
  Plus,
  MoreVertical,
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
  BotMessageSquare,
  BookmarkPlus,
  PanelLeft,
  Menu,
  AlignLeft,
  Palette,
  FileDown,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { useReaderStore, useActiveDocument, type ZoomMode } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import {
  annotationsToJson,
  annotationsToMarkdown,
  downloadTextFile,
} from "@/lib/export-highlights";
import { useUndoStore } from "@/stores/undo-store";
import { useIsMobile } from "@/hooks/use-media-query";
import { ReadingTrackerControl } from "./controls/ReadingTrackerControl";
import { FocusSessionControl } from "./controls/FocusSessionControl";
import type { HighlightColor } from "@/types/annotation";
import type { LucideIcon } from "lucide-react";
import {
  useToolbarLayout,
  isSeparator,
  type ToolbarZone,
} from "./toolbar/toolbar-config";

function nextReaderTheme(t: "light" | "dark" | "sepia"): "light" | "dark" | "sepia" {
  return t === "light" ? "dark" : t === "dark" ? "sepia" : "light";
}

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
        : zoomMode === "fit-page"
          ? t("reader.toolbar.fitPage")
          : zoomMode === "auto"
            ? t("reader.toolbar.zoomAutoShort", { defaultValue: "Auto" })
            : t("reader.toolbar.zoomActualShort", { defaultValue: "100%" });

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
        className="w-12 rounded border border-glass-border bg-glass-bg px-1 py-0.5 text-center text-xs text-text-primary outline-none focus:border-accent"
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

// Zoom control = the editable % box + a chevron that opens a list of
// human-language presets, mirroring Chrome / Google's PDF viewer. The
// box still accepts a typed custom %; the dropdown sets a named mode.
function ZoomSelect({
  zoomMode,
  zoomLevel,
  setZoomMode,
  setZoomLevel,
}: {
  zoomMode: ZoomMode;
  zoomLevel: number;
  setZoomMode: (mode: ZoomMode) => void;
  setZoomLevel: (level: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const presets: { mode: ZoomMode; label: string }[] = [
    { mode: "auto", label: t("reader.toolbar.zoomPresetAuto", { defaultValue: "Automatic Zoom" }) },
    { mode: "actual", label: t("reader.toolbar.zoomPresetActual", { defaultValue: "Actual Size" }) },
    { mode: "fit-page", label: t("reader.toolbar.zoomPresetFitPage", { defaultValue: "Page Fit" }) },
    { mode: "fit-width", label: t("reader.toolbar.zoomPresetFitWidth", { defaultValue: "Page Width" }) },
  ];

  // Common zoom levels, ascending, à la Chrome's PDF viewer.
  const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];

  const rowCls = (active: boolean) =>
    cn(
      "flex w-full items-center rounded px-2 py-1 text-xs transition-colors cursor-pointer",
      active
        ? "bg-accent/15 text-accent"
        : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
    );

  return (
    <div className="flex items-center rounded-md border border-glass-border bg-glass-bg">
      <ZoomInput
        zoomMode={zoomMode}
        zoomLevel={zoomLevel}
        onSubmit={(level) => setZoomLevel(level)}
        onCycleMode={() =>
          setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width")
        }
      />
      <button
        ref={anchorRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center rounded-r-md px-0.5 py-1 transition-colors cursor-pointer",
          open
            ? "text-accent"
            : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
        )}
        title={t("reader.toolbar.zoomPresets", { defaultValue: "Zoom presets" })}
        aria-expanded={open}
      >
        <ChevronDown size={14} />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="w-44 p-1"
      >
        {presets.map((p) => (
          <button
            key={p.mode}
            onClick={() => {
              setZoomMode(p.mode);
              setOpen(false);
            }}
            className={rowCls(zoomMode === p.mode)}
          >
            {p.label}
          </button>
        ))}
        <div className="my-1 h-px bg-glass-border" />
        {ZOOM_LEVELS.map((lvl) => (
          <button
            key={lvl}
            onClick={() => {
              setZoomLevel(lvl);
              setOpen(false);
            }}
            className={rowCls(
              zoomMode === "custom" && Math.round(zoomLevel) === lvl,
            )}
          >
            {lvl}%
          </button>
        ))}
      </FloatingMenu>
    </div>
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
  const getDisplayTitle = useReaderStore((s) => s.getDisplayTitle);
  const rotatePage = useReaderStore((s) => s.rotatePage);
  const pdfInvertColors = useSettingsStore((s) => s.pdfInvertColors);
  const setPdfInvertColors = useSettingsStore((s) => s.setPdfInvertColors);
  const pdfReflowMode = useSettingsStore((s) => s.pdfReflowMode);
  const setPdfReflowMode = useSettingsStore((s) => s.setPdfReflowMode);
  const readerTheme = useSettingsStore((s) => s.readerTheme);
  const setReaderTheme = useSettingsStore((s) => s.setReaderTheme);
  const cycleReaderTheme = useCallback(() => {
    setReaderTheme(
      readerTheme === "light"
        ? "dark"
        : readerTheme === "dark"
          ? "sepia"
          : "light",
    );
  }, [readerTheme, setReaderTheme]);

  // Export highlights / comments / bookmarks for the active document.
  // Reads each store's current state directly via getState() — no
  // need to subscribe, this only fires on user click. The annotation
  // and bookmark stores are already scoped to the active document
  // (loaded by ReaderPage's mount effects), so .values() is safe.
  const exportHighlights = useCallback(
    (kind: "markdown" | "json") => {
      const doc = useReaderStore.getState().getActiveDoc();
      if (!doc) return;
      const annState = useAnnotationStore.getState();
      const bmState = useBookmarkStore.getState();
      const highlights = Array.from(annState.highlights.values()).filter(
        (h) => h.documentId === doc.meta.id,
      );
      const comments = Array.from(annState.comments.values()).filter(
        (c) => c.documentId === doc.meta.id,
      );
      const bookmarks = Array.from(bmState.bookmarks.values()).filter(
        (b) => b.documentId === doc.meta.id,
      );
      const body =
        kind === "markdown"
          ? annotationsToMarkdown(doc.meta, highlights, comments, bookmarks)
          : annotationsToJson(doc.meta, highlights, comments, bookmarks);
      const mime =
        kind === "markdown" ? "text/markdown" : "application/json";
      const filenameBase = `${doc.meta.title || "book"}-highlights`;
      downloadTextFile(filenameBase, body, mime);
    },
    [],
  );
  const isPdf = activeDoc?.meta.format === "pdf";

  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const activeHighlightColor = useAnnotationStore((s) => s.activeHighlightColor);
  const setActiveHighlightColor = useAnnotationStore((s) => s.setActiveHighlightColor);
  const canUndo = useUndoStore((s) => s.stack.length > 0);
  const performUndo = useUndoStore((s) => s.performUndo);
  // Page input mirrors the live currentPage as a real value (not a
  // placeholder) so the caret doesn't blink on top of grayed-out
  // digits. `pageInputFocused` gates the sync-from-store effect:
  // while the user is typing we never overwrite their draft, but
  // any external change (arrow keys, scroll-driven page tracking,
  // bookmark jump) is reflected the moment focus leaves.
  const [pageInput, setPageInput] = useState("");
  const [pageInputFocused, setPageInputFocused] = useState(false);
  const currentPageForSync = activeDoc?.currentPage ?? 1;
  useEffect(() => {
    if (!pageInputFocused) setPageInput(String(currentPageForSync));
  }, [currentPageForSync, pageInputFocused]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  // The highlight-color picker (FloatingMenu) anchors to the ⋮ overflow
  // button — that's where the Highlight action now lives. Portaling via
  // FloatingMenu (z-[100] at the body level) escapes the toolbar's z-20
  // stacking context, which the dockview PDF area would otherwise paint
  // over.
  const overflowRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  // Persisted, user-customizable arrangement (Phase B). Renders the
  // non-mobile bar; mobile keeps its own fixed layout.
  const { layout } = useToolbarLayout();
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
    // Don't clear; the focus/sync effect will pull the (possibly new)
    // currentPage in once the input blurs — which also handles the
    // "user typed garbage and submitted" case by reverting cleanly.
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
    {
      // Cycles reader-content theme: light → dark → sepia → light.
      // Label advertises the *next* theme so the user can predict the
      // jump before clicking. A proper 3-way picker lives in the
      // settings page; in-toolbar we keep it to one action.
      label: t("reader.toolbar.readerTheme", {
        next: t(`reader.toolbar.readerTheme_${nextReaderTheme(readerTheme)}`),
      }),
      icon: Palette,
      onClick: cycleReaderTheme,
    },
    {
      label: t("reader.toolbar.exportHighlightsMarkdown"),
      icon: FileDown,
      onClick: () => exportHighlights("markdown"),
    },
    {
      label: t("reader.toolbar.exportHighlightsJson"),
      icon: FileDown,
      onClick: () => exportHighlights("json"),
    },
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

  // Navigate to the book's overview / description page. Replaces the
  // old click-to-rename behaviour on the title — renaming now lives on
  // the book page. `:bookId` in /books/:bookId is the same id the
  // reader opened with (activeDoc.meta.id).
  const goToDescription = () => {
    if (!activeDoc) return;
    navigate(`/books/${activeDoc.meta.id}`, {
      state: { from: location.pathname + location.search },
    });
  };

  // Mobile shrinks the toolbar's vertical footprint: smaller height,
  // smaller icon set, tighter button padding, and a compact page
  // input. Desktop keeps the original generous chrome. One source of
  // truth so the three breakpoint branches below don't drift.
  const iconSize = isMobile ? 14 : 16;
  const btnPad = isMobile ? "p-1" : "p-1.5";

  // ---- Shared toolbar pieces (reused by the mobile + desktop layouts
  //      so the page-nav form / title / menu button don't drift). ----
  const iconBtnCls =
    "rounded-md text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer shrink-0";

  const menuButton = showAppSidebarToggle ? (
    <button
      onClick={() => {
        if (isMobile) setMobileSidebarOpen(true);
        else useUIStore.getState().toggleSidebar();
      }}
      className={cn(iconBtnCls, btnPad)}
      title={t("reader.toolbar.toggleAppSidebar")}
    >
      <Menu size={iconSize} />
    </button>
  ) : null;

  const backButton = (
    <button
      onClick={handleBack}
      className={cn(iconBtnCls, btnPad)}
      title={t("reader.toolbar.backToLibrary")}
    >
      <ArrowLeft size={iconSize} />
    </button>
  );

  // Title is now a link to the book's overview page (rename moved
  // there). Small, truncates, and never grows wide enough to crowd the
  // page-nav / zoom controls.
  const titleEl = (
    <button
      onClick={goToDescription}
      className="block w-full truncate text-left text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
      title={t("reader.toolbar.openBookPage", { defaultValue: "Open book page" })}
    >
      {getDisplayTitle()}
    </button>
  );

  const pageNavEl = (
    <div className="flex shrink-0 items-center gap-1">
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
          onFocus={(e) => {
            setPageInputFocused(true);
            const el = e.currentTarget;
            requestAnimationFrame(() => el.select());
          }}
          onBlur={() => setPageInputFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitPageInput();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setPageInput(String(currentPage));
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          className={cn(
            "rounded border border-glass-border bg-glass-bg px-1.5 py-0.5 text-center font-semibold text-text-primary outline-none focus:border-accent",
            isMobile ? "w-10 text-xs" : "w-12 text-sm",
          )}
        />
        <span
          className={cn(
            "font-medium text-text-secondary",
            isMobile ? "text-xs" : "text-sm",
          )}
        >
          / {totalPages}
        </span>
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
    </div>
  );

  const desktopIconBtn =
    "rounded-md p-1 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer";

  // ---- Item registry (Phase B foundation) -------------------------
  // The non-mobile bar renders from `layout` via this registry.
  // Composite widgets (multi-control) are bar-only; icon items can sit
  // in a bar zone OR the ⋮ overflow menu.
  const zoomEl = (
    <div className="flex items-center gap-1">
      <button onClick={handleZoomOut} className={desktopIconBtn} title={t("reader.toolbar.zoomOut")}>
        <Minus size={14} />
      </button>
      <ZoomSelect
        zoomMode={zoomMode}
        zoomLevel={zoomLevel}
        setZoomMode={setZoomMode}
        setZoomLevel={setZoomLevel}
      />
      <button onClick={handleZoomIn} className={desktopIconBtn} title={t("reader.toolbar.zoomIn")}>
        <Plus size={14} />
      </button>
    </div>
  );

  const compositeNodes: Record<string, ReactNode> = {
    title: (
      <div className="min-w-0 max-w-[10rem] lg:max-w-[16rem] shrink">{titleEl}</div>
    ),
    pageNav: pageNavEl,
    zoom: zoomEl,
    readingTracker: <ReadingTrackerControl />,
    focusTimer: <FocusSessionControl />,
  };

  type IconDef = {
    icon: LucideIcon;
    label: string;
    onClick?: () => void;
    active?: boolean;
    disabled?: boolean;
    available?: boolean;
  };
  const iconDefs: Record<string, IconDef> = {
    menu: {
      icon: Menu,
      label: t("reader.toolbar.toggleAppSidebar"),
      onClick: () => {
        if (isMobile) setMobileSidebarOpen(true);
        else useUIStore.getState().toggleSidebar();
      },
      available: showAppSidebarToggle,
    },
    back: { icon: ArrowLeft, label: t("reader.toolbar.backToLibrary"), onClick: handleBack },
    aiChat: { icon: BotMessageSquare, label: t("reader.toolbar.aiChatTitle"), onClick: onToggleAiChat },
    undo: { icon: Undo2, label: t("reader.toolbar.undoTitle"), onClick: performUndo, disabled: !canUndo },
    inPageDraw: {
      icon: Pencil,
      label: inlineDrawActive
        ? t("reader.toolbar.inlineDrawOff", { defaultValue: "Stop drawing" })
        : t("reader.toolbar.inlineDrawOn", { defaultValue: "Quick draw on page" }),
      onClick: () => toggleInlineDraw(),
      active: inlineDrawActive,
    },
    whiteboardDraw: {
      icon: PenTool,
      label: isDrawMode ? t("reader.toolbar.exitDraw") : t("reader.toolbar.draw"),
      onClick: onToggleDrawMode,
      active: isDrawMode,
      available: !!onToggleDrawMode,
    },
    comments: { icon: MessageSquare, label: t("reader.toolbar.commentsTitle"), onClick: onToggleComments },
    zen: { icon: Focus, label: t("reader.toolbar.zenMode"), onClick: onToggleZenMode },
    search: { icon: Search, label: t("reader.toolbar.search"), onClick: onToggleSearch },
    bookmark: { icon: BookmarkPlus, label: t("reader.toolbar.bookmarkPage"), onClick: handleBookmarkPage },
    highlight: {
      icon: Highlighter,
      label: t("reader.toolbar.highlight"),
      onClick: () => {
        setShowOverflowMenu(false);
        setShowColorPicker(!showColorPicker);
      },
    },
    theme: {
      icon: Palette,
      label: t("reader.toolbar.readerTheme", {
        next: t(`reader.toolbar.readerTheme_${nextReaderTheme(readerTheme)}`),
      }),
      onClick: cycleReaderTheme,
    },
    rotate: { icon: RotateCw, label: t("reader.toolbar.rotate"), onClick: () => rotatePage(1), available: isPdf },
    night: {
      icon: pdfInvertColors ? Sun : Moon,
      label: pdfInvertColors ? t("reader.toolbar.nightModeOff") : t("reader.toolbar.nightModeOn"),
      onClick: () => setPdfInvertColors(!pdfInvertColors),
      active: pdfInvertColors,
      available: isPdf,
    },
    reflow: {
      icon: AlignLeft,
      label: pdfReflowMode ? t("reader.toolbar.reflowOff") : t("reader.toolbar.reflowOn"),
      onClick: () => setPdfReflowMode(!pdfReflowMode),
      active: pdfReflowMode,
      available: isPdf,
    },
    screenshot: { icon: Camera, label: t("reader.toolbar.screenshotTitle"), onClick: onScreenshot },
    screenshotArea: { icon: Crop, label: t("reader.toolbar.screenshotAreaTitle"), onClick: onScreenshotRect },
    cropToAi: {
      icon: BotMessageSquare,
      label: t("reader.toolbar.rectToAi", { defaultValue: "Crop to AI" }),
      onClick: onRectToAi,
      available: !!onRectToAi,
    },
    print: { icon: Printer, label: t("reader.toolbar.printTitle"), onClick: onPrint },
    exportMd: { icon: FileDown, label: t("reader.toolbar.exportHighlightsMarkdown"), onClick: () => exportHighlights("markdown") },
    exportJson: { icon: FileDown, label: t("reader.toolbar.exportHighlightsJson"), onClick: () => exportHighlights("json") },
    sidebar: { icon: PanelLeft, label: t("reader.toolbar.toggleSidebar"), onClick: onToggleSidebar, available: !!onToggleSidebar },
    fullscreen: {
      icon: isFullscreen ? Minimize : Maximize,
      label: isFullscreen ? t("reader.toolbar.exitFullscreen") : t("reader.toolbar.fullscreen"),
      onClick: onToggleFullscreen,
    },
  };

  const isItemAvailable = (id: string): boolean => {
    if (isSeparator(id)) return true;
    if (id in compositeNodes) return true;
    const def = iconDefs[id];
    return def ? def.available ?? true : false;
  };

  const renderBarItem = (slotId: string) => {
    if (isSeparator(slotId)) {
      return <div key={slotId} className="mx-1 h-4 w-px shrink-0 bg-glass-border" />;
    }
    const composite = compositeNodes[slotId];
    if (composite !== undefined) {
      return <Fragment key={slotId}>{composite}</Fragment>;
    }
    const def = iconDefs[slotId];
    if (!def || !(def.available ?? true)) return null;
    return (
      <button
        key={slotId}
        onClick={() => def.onClick?.()}
        disabled={def.disabled}
        title={def.label}
        aria-label={def.label}
        className={cn(
          "rounded-md p-1 transition-colors cursor-pointer",
          def.disabled
            ? "text-text-secondary opacity-30 cursor-not-allowed"
            : def.active
              ? "text-accent bg-accent/10"
              : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )}
      >
        <def.icon size={14} />
      </button>
    );
  };

  const renderZone = (zone: ToolbarZone) =>
    layout[zone].map((slotId) => renderBarItem(slotId));

  // Overflow (⋮) renders only icon-items that are available, plus any
  // separators (as thin menu dividers).
  const overflowMenuSlots = layout.overflow.filter(
    (id) => isSeparator(id) || (iconDefs[id] && isItemAvailable(id)),
  );

  return (
    <div className="border-b border-glass-border bg-bg-secondary/60 backdrop-blur-md pt-safe-top pl-safe-left pr-safe-right">
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-2 sm:px-4",
          isMobile ? "h-9" : "h-10",
        )}
      >
        {isMobile ? (
          /* ------------------------- MOBILE ------------------------- */
          <>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {menuButton}
              {backButton}
              <div className="min-w-0 flex-1">{titleEl}</div>
            </div>
            <div className="flex items-center gap-1">{pageNavEl}</div>
            <div className="flex flex-1 items-center justify-end gap-1">
              <ReadingTrackerControl compact />
              <FocusSessionControl compact />
              <div className="relative" ref={overflowRef}>
                <button
                  onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                  className={cn(iconBtnCls, btnPad, "touch-target")}
                >
                  <MoreVertical size={iconSize} />
                </button>
              </div>
              <FloatingMenu
                open={showOverflowMenu}
                anchorRef={overflowRef}
                onClose={() => setShowOverflowMenu(false)}
                className="w-48"
              >
                {overflowActions.map(
                  ({ label, icon: Icon, onClick, disabled }) => (
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
                  ),
                )}
              </FloatingMenu>
            </div>
          </>
        ) : (
          /* ----------- DESKTOP / TABLET (Google-PDF layout) --------- */
          <>
            {/* LEFT zone */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {renderZone("left")}
            </div>

            {/* CENTER zone */}
            <div className="flex shrink-0 items-center gap-1">
              {renderZone("center")}
            </div>

            {/* RIGHT zone + the always-present ⋮ overflow trigger */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
              {renderZone("right")}
              <div className="relative" ref={overflowRef}>
                <button
                  onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                  className={desktopIconBtn}
                  title={t("reader.toolbar.moreActions", { defaultValue: "More" })}
                  aria-label={t("reader.toolbar.moreActions", { defaultValue: "More" })}
                >
                  <MoreVertical size={14} />
                </button>
              </div>
              {/* Portaled via FloatingMenu so it can't be painted over
                  by the PDF dockview (the toolbar wrapper is its own
                  z-20 stacking context — a plain `absolute z-50` here
                  loses to anything the viewer stacks above z-20). */}
              <FloatingMenu
                open={showOverflowMenu}
                anchorRef={overflowRef}
                onClose={() => setShowOverflowMenu(false)}
                className="w-44"
              >
                {overflowMenuSlots.map((id) => {
                  if (isSeparator(id)) {
                    return (
                      <div key={id} className="my-1 h-px bg-glass-border" />
                    );
                  }
                  const def = iconDefs[id];
                  const Icon = def.icon;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        def.onClick?.();
                        setShowOverflowMenu(false);
                      }}
                      disabled={def.disabled}
                      className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 cursor-pointer"
                    >
                      <Icon size={14} />
                      {def.label}
                    </button>
                  );
                })}
              </FloatingMenu>
            </div>
          </>
        )}
      </div>

      {/* Highlight-color picker — anchored to the ⋮ overflow button on
          every breakpoint (that's where the Highlight action lives
          now). Portaled via FloatingMenu so it escapes the toolbar's
          z-20 stacking context. */}
      <FloatingMenu
        open={showColorPicker}
        anchorRef={overflowRef}
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
  );
}
