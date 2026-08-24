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
  SquareDashedMousePointer,
  ImagePlus,
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
import { Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useToolbarLayout,
  useToolbarStyle,
  isSeparator,
  type ToolbarZone,
} from "./toolbar/toolbar-config";
import { ToolbarEditor } from "./toolbar/ToolbarEditor";
import { useFeatures } from "@/lib/use-features";

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

  // display only; store keeps zoomLevel as a float
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

// Editable % box + chevron dropdown of named presets.
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
  /** Crop a page region and send it to AI chat as an image attachment. */
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
  // go back via history when we have an opener path, else fall back to /library
  const fromPath = (location.state as { from?: string } | null)?.from ?? null;
  const handleBack = useCallback(() => {
    if (fromPath) navigate(-1);
    else navigate("/library");
  }, [fromPath, navigate]);
  const activeDoc = useActiveDocument();
  const features = useFeatures();
  const inlineDrawActive = useInlineDrawStore((s) => s.active);
  const toggleInlineDraw = useInlineDrawStore((s) => s.toggleActive);
  const goToPage = useReaderStore((s) => s.goToPage);
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);
  const setZoomLevel = useReaderStore((s) => s.setZoomLevel);

  // step off the live rendered scale, not doc.zoomLevel: at fit-to-width they
  // differ and the first zoom would jump wrong. no viewer -> use the store.
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

  // export highlights/comments/bookmarks for the active doc
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
  // gate the sync effect so it doesn't clobber the draft while typing
  const [pageInput, setPageInput] = useState("");
  const [pageInputFocused, setPageInputFocused] = useState(false);
  const currentPageForSync = activeDoc?.currentPage ?? 1;
  useEffect(() => {
    if (!pageInputFocused) setPageInput(String(currentPageForSync));
  }, [currentPageForSync, pageInputFocused]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  // portaled to body so it escapes the toolbar's z-20 stacking context
  const overflowRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  // persisted arrangement that drives the non-mobile bar
  const { layout, setLayout, resetLayout } = useToolbarLayout();
  const { style: toolbarStyle, setStyle: setToolbarStyle } = useToolbarStyle();
  const [editingToolbar, setEditingToolbar] = useState(false);
  // desktop expands the app sidebar, mobile opens the nav drawer
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
    // don't clear; the sync effect pulls currentPage on blur
  };

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitPageInput();
  };

  const handleBookmarkPage = () => {
    if (!activeDoc) return;
    addBookmark(activeDoc.currentPage);
  };

  // Mobile-only overflow list (desktop uses the configurable overflowMenuSlots).
  // Deliberately trimmed: bookmark / search / comments / AI already live in the
  // bottom bar, and pinch-zoom replaces the zoom buttons, so those, plus rarely-
  // used JSON export and print, are dropped here to cut the menu down.
  const overflowActions = [
    {
      // label shows the next theme in the light/dark/sepia cycle
      label: t("reader.toolbar.readerTheme", {
        next: t(`reader.toolbar.readerTheme_${nextReaderTheme(readerTheme)}`),
      }),
      icon: Palette,
      onClick: cycleReaderTheme,
    },
    { label: t("reader.toolbar.fitMode"), icon: Columns2, onClick: () => setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width") },
    // PDF-only: rotate, night mode, reflow
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
    ...(features.whiteboard
      ? [
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
        ]
      : []),
    ...(onToggleDrawMode && features.whiteboard ? [{ label: isDrawMode ? t("reader.toolbar.exitDraw") : t("reader.toolbar.draw"), icon: PenTool, onClick: onToggleDrawMode }] : []),
    { label: t("reader.toolbar.undo"), icon: Undo2, onClick: performUndo, disabled: !canUndo },
    { label: t("reader.toolbar.screenshot"), icon: Camera, onClick: onScreenshot },
    { label: t("reader.toolbar.screenshotArea"), icon: SquareDashedMousePointer, onClick: onScreenshotRect },
    ...(onRectToAi
      ? [{ label: t("reader.toolbar.rectToAi", { defaultValue: "Crop to AI" }), icon: ImagePlus, onClick: onRectToAi }]
      : []),
    ...(onToggleSidebar ? [{ label: t("reader.toolbar.toggleSidebar"), icon: PanelLeft, onClick: onToggleSidebar }] : []),
    { label: t("reader.toolbar.zenMode"), icon: Focus, onClick: onToggleZenMode },
    { label: isFullscreen ? t("reader.toolbar.exitFullscreen") : t("reader.toolbar.fullscreen"), icon: isFullscreen ? Minimize : Maximize, onClick: onToggleFullscreen },
  ];

  // open the book's overview page
  const goToDescription = () => {
    if (!activeDoc) return;
    navigate(`/books/${activeDoc.meta.id}`, {
      state: { from: location.pathname + location.search },
    });
  };

  // mobile shrinks height, icons, and padding
  const iconSize = isMobile ? 14 : 16;
  const btnPad = isMobile ? "p-1" : "p-1.5";

  // shared by both layouts
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

  // title links to the book's overview page
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
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        onClick={() => prevPage()}
        disabled={currentPage <= 1}
        className={cn(
          "inline-flex items-center justify-center rounded-md transition-colors cursor-pointer touch-target",
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
          "inline-flex items-center justify-center rounded-md transition-colors cursor-pointer touch-target",
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

  // composite widgets are bar-only; icon items can also go in the overflow menu
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
      available: features.whiteboard,
    },
    whiteboardDraw: {
      icon: PenTool,
      label: isDrawMode ? t("reader.toolbar.exitDraw") : t("reader.toolbar.draw"),
      onClick: onToggleDrawMode,
      active: isDrawMode,
      available: !!onToggleDrawMode && features.whiteboard,
    },
    comments: { icon: MessageSquare, label: t("reader.toolbar.commentsTitle"), onClick: onToggleComments, available: features.comments },
    zen: { icon: Focus, label: t("reader.toolbar.zenMode"), onClick: onToggleZenMode },
    search: { icon: Search, label: t("reader.toolbar.search"), onClick: onToggleSearch },
    bookmark: { icon: BookmarkPlus, label: t("reader.toolbar.bookmarkPage"), onClick: handleBookmarkPage, available: features.bookmarks },
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
    screenshotArea: { icon: SquareDashedMousePointer, label: t("reader.toolbar.screenshotAreaTitle"), onClick: onScreenshotRect },
    cropToAi: {
      icon: ImagePlus,
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
        style={{
          paddingTop: toolbarStyle.paddingY,
          paddingBottom: toolbarStyle.paddingY,
        }}
        className={cn(
          "rounded-md px-1 transition-colors cursor-pointer",
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

  // overflow shows available icon-items plus separators as dividers
  const overflowMenuSlots = layout.overflow.filter(
    (id) => isSeparator(id) || (iconDefs[id] && isItemAvailable(id)),
  );

  // In-place WYSIWYG customizer replaces the real bar at the same spot.
  if (editingToolbar) {
    return (
      <ToolbarEditor
        layout={layout}
        onChange={setLayout}
        onReset={resetLayout}
        onDone={() => setEditingToolbar(false)}
        style={toolbarStyle}
        onStyleChange={setToolbarStyle}
      />
    );
  }

  return (
    <div className="border-b border-glass-border bg-bg-secondary/60 backdrop-blur-md pt-safe-top pl-safe-left pr-safe-right">
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-2 sm:px-4",
          isMobile && "h-11",
        )}
        style={isMobile ? undefined : { height: toolbarStyle.height }}
      >
        {isMobile ? (
          /* MOBILE */
          <>
            {/* left: just the app-nav hamburger. Back arrow + book title
                removed on mobile, the hamburger opens full app nav, and the
                title barely fit 3 chars anyway. */}
            <div className="flex shrink-0 items-center gap-1">
              {menuButton}
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              {pageNavEl}
            </div>
            <div className="flex flex-1 items-center justify-end gap-1">
              <ReadingTrackerControl compact />
              <FocusSessionControl compact />
              <div className="relative" ref={overflowRef}>
                <button
                  onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                  className={cn(
                    iconBtnCls,
                    "inline-flex h-9 w-9 items-center justify-center touch-target",
                  )}
                  aria-label={t("reader.toolbar.moreActions", {
                    defaultValue: "More",
                  })}
                >
                  <MoreVertical size={20} />
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
                      className="flex w-full items-center justify-start gap-3 px-3 py-2.5 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 cursor-pointer"
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
          /* DESKTOP / TABLET */
          <>
            {/* LEFT zone */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {renderZone("left")}
            </div>

            {/* CENTER zone */}
            <div className="flex shrink-0 items-center gap-1">
              {renderZone("center")}
            </div>

            {/* RIGHT zone + overflow trigger */}
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
              {/* portaled so the PDF dockview can't paint over it */}
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
                      className="flex w-full items-center justify-start gap-2.5 px-2.5 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 cursor-pointer"
                    >
                      <Icon size={14} />
                      {def.label}
                    </button>
                  );
                })}
                <div className="my-1 h-px bg-glass-border" />
                <button
                  onClick={() => {
                    setEditingToolbar(true);
                    setShowOverflowMenu(false);
                  }}
                  className="flex w-full items-center justify-start gap-2.5 px-2.5 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                >
                  <Settings2 size={14} />
                  {t("reader.toolbar.customize", {
                    defaultValue: "Customize toolbar",
                  })}
                </button>
              </FloatingMenu>
            </div>
          </>
        )}
      </div>

      {/* highlight-color picker, anchored to the overflow button */}
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
