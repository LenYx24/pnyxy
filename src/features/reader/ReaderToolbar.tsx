import {
  useEffect,
  useRef,
  useState,
  useCallback,
  Fragment,
  type ReactNode,
} from "react";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { Toggle, Tooltip } from "@/components/ui";
import { getZoomControls } from "./gestures/pinch-zoom-controller";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
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
  BookmarkPlus,
  PanelLeft,
  Menu,
  AlignLeft,
  Palette,
  FileDown,
  ZoomIn,
  Sparkles,
  BookMarked,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import {
  useReaderStore,
  useActiveDocument,
  type ZoomMode,
} from "@/stores/reader-store";
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
import type { TocItem } from "@/types/document";
import {
  useToolbarLayout,
  useToolbarStyle,
  isSeparator,
  type ToolbarZone,
} from "./toolbar/toolbar-config";
import { ToolbarEditor } from "./toolbar/ToolbarEditor";
import { useFeatures } from "@/lib/use-features";
import { useCoverTintPref } from "./hooks/useReaderTint";

function nextReaderTheme(
  t: "light" | "dark" | "sepia",
): "light" | "dark" | "sepia" {
  return t === "light" ? "dark" : t === "dark" ? "sepia" : "light";
}

const HIGHLIGHT_COLORS: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "orange",
];
const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

/** Deepest TOC entry whose page is at or before the current page. */
/** Bar icon slot -> shortcut catalog id, rendered as Kbd chips in the tooltip. */
const BAR_ITEM_SHORTCUTS: Record<string, string> = {
  search: "reader:search",
  zen: "reader:zen-mode",
  fullscreen: "reader:fullscreen",
  sidebar: "reader:toggle-toc",
  comments: "reader:toggle-comments",
  bookmark: "reader:bookmark-page",
  print: "reader:print",
  screenshot: "reader:screenshot",
  undo: "reader:undo",
  theme: "reader:cycle-theme",
};

function currentSectionLabel(toc: TocItem[], page: number): string | null {
  let best: { page: number; title: string } | null = null;
  const walk = (items: TocItem[]) => {
    for (const it of items) {
      const p = it.pageIndex + 1;
      if (p <= page && (!best || p >= best.page))
        best = { page: p, title: it.title };
      if (it.children.length) walk(it.children);
    }
  };
  walk(toc);
  return best ? (best as { title: string }).title : null;
}

/** Shared look for the 36x32 icon buttons inside the header pill cluster. */
const clusterBtnCls =
  "inline-flex h-8 w-9 shrink-0 items-center justify-center rounded-[10px] text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";

/** Menu row inside the kebab / popovers. */
const menuRowCls =
  "flex w-full items-center justify-start gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer";

/** Editable zoom % (typed value or the named mode). */
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

  const displayText = zoomDisplayText(zoomMode, zoomLevel, t);

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
        className="field w-16 px-2 py-1 text-center text-xs"
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
      className="min-w-[4rem] rounded-[10px] px-2 py-1 text-center text-xs font-medium text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
      title={t("reader.toolbar.zoomCustomTitle")}
    >
      {displayText}
    </button>
  );
}

function zoomDisplayText(
  zoomMode: ZoomMode,
  zoomLevel: number,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  return zoomMode === "custom"
    ? `${Math.round(zoomLevel)}%`
    : zoomMode === "fit-width"
      ? t("reader.toolbar.fitWidth")
      : zoomMode === "fit-page"
        ? t("reader.toolbar.fitPage")
        : zoomMode === "auto"
          ? t("reader.toolbar.zoomAutoShort")
          : t("reader.toolbar.zoomActualShort");
}

/**
 * One cluster button that opens the zoom popover: presets, the editable
 * % box, and the +/- steppers. The trigger keeps the "Zoom presets"
 * title (e2e hooks) and shows the live zoom text next to the icon.
 */
function ZoomSelect({
  zoomMode,
  zoomLevel,
  setZoomMode,
  setZoomLevel,
  onZoomIn,
  onZoomOut,
}: {
  zoomMode: ZoomMode;
  zoomLevel: number;
  setZoomMode: (mode: ZoomMode) => void;
  setZoomLevel: (level: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const presets: { mode: ZoomMode; label: string }[] = [
    { mode: "auto", label: t("reader.toolbar.zoomPresetAuto") },
    { mode: "actual", label: t("reader.toolbar.zoomPresetActual") },
    { mode: "fit-page", label: t("reader.toolbar.zoomPresetFitPage") },
    { mode: "fit-width", label: t("reader.toolbar.zoomPresetFitWidth") },
  ];

  const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];

  const rowCls = (active: boolean) =>
    cn(
      "flex w-full items-center rounded-[10px] px-2 py-1 text-xs transition-colors cursor-pointer",
      active
        ? "bg-surface-3 text-text-primary"
        : "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
    );

  return (
    <div className="flex items-center">
      <button
        ref={anchorRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium transition-colors cursor-pointer",
          open
            ? "bg-bg-tertiary text-text-primary"
            : "text-text-muted hover:bg-bg-tertiary hover:text-text-primary",
        )}
        title={t("reader.toolbar.zoomPresets")}
        aria-expanded={open}
      >
        <ZoomIn size={18} strokeWidth={1.5} />
        <span className="tabular-nums">
          {zoomDisplayText(zoomMode, zoomLevel, t)}
        </span>
      </button>
      <FloatingMenu
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="w-48 p-1.5"
      >
        <div className="mb-1 flex items-center justify-between gap-1 px-0.5">
          <button
            onClick={onZoomOut}
            className={clusterBtnCls}
            title={t("reader.toolbar.zoomOut")}
            aria-label={t("reader.toolbar.zoomOut")}
          >
            <Minus size={16} strokeWidth={1.5} />
          </button>
          <ZoomInput
            zoomMode={zoomMode}
            zoomLevel={zoomLevel}
            onSubmit={(level) => setZoomLevel(level)}
            onCycleMode={() =>
              setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width")
            }
          />
          <button
            onClick={onZoomIn}
            className={clusterBtnCls}
            title={t("reader.toolbar.zoomIn")}
            aria-label={t("reader.toolbar.zoomIn")}
          >
            <Plus size={16} strokeWidth={1.5} />
          </button>
        </div>
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
        <div className="my-1 h-1" />
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
    setReaderTheme(nextReaderTheme(readerTheme));
  }, [readerTheme, setReaderTheme]);
  const [coverTint, toggleCoverTint] = useCoverTintPref();

  // export highlights/comments/bookmarks for the active doc
  const exportHighlights = useCallback((kind: "markdown" | "json") => {
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
    const mime = kind === "markdown" ? "text/markdown" : "application/json";
    const filenameBase = `${doc.meta.title || "book"}-highlights`;
    downloadTextFile(filenameBase, body, mime);
  }, []);
  const isPdf = activeDoc?.meta.format === "pdf";

  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const activeHighlightColor = useAnnotationStore(
    (s) => s.activeHighlightColor,
  );
  const setActiveHighlightColor = useAnnotationStore(
    (s) => s.setActiveHighlightColor,
  );
  const canUndo = useUndoStore((s) => s.stack.length > 0);
  const performUndo = useUndoStore((s) => s.performUndo);
  // gate the sync effect so it doesn't clobber the draft while typing
  const [pageInput, setPageInput] = useState("");
  const [pageInputFocused, setPageInputFocused] = useState(false);
  const currentPageForSync = activeDoc?.currentPage ?? 1;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the store page into the draft while the box isn't focused; cannot cascade
    if (!pageInputFocused) setPageInput(String(currentPageForSync));
  }, [currentPageForSync, pageInputFocused]);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  // portaled to body so it escapes the toolbar's stacking context
  const overflowRef = useRef<HTMLDivElement>(null);

  const isMobile = useIsMobile();
  // persisted arrangement that drives the non-mobile bar
  const { layout, setLayout, resetLayout } = useToolbarLayout();
  const { style: toolbarStyle, setStyle: setToolbarStyle } = useToolbarStyle();
  const [editingToolbar, setEditingToolbar] = useState(false);
  // desktop expands the app sidebar, mobile opens the nav drawer
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  // the reader hides the global rail, so the app-menu button is mobile-only
  const showAppSidebarToggle = isMobile;

  if (!activeDoc) return null;

  const { currentPage, totalPages, zoomMode, zoomLevel } = activeDoc;
  const sectionLabel = currentSectionLabel(activeDoc.toc, currentPage);

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

  // open the book's overview page
  const goToDescription = () => {
    if (!activeDoc) return;
    navigate(`/books/${activeDoc.meta.id}`, {
      state: { from: location.pathname + location.search },
    });
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
    {
      label: t("reader.toolbar.fitMode"),
      icon: Columns2,
      onClick: () =>
        setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width"),
    },
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
    {
      label: t("reader.toolbar.highlight"),
      icon: Highlighter,
      onClick: () => {
        setShowOverflowMenu(false);
        setShowColorPicker(!showColorPicker);
      },
    },
    ...(features.whiteboard
      ? [
          {
            label: inlineDrawActive
              ? t("reader.toolbar.inlineDrawOff")
              : t("reader.toolbar.inlineDrawOn"),
            icon: Pencil,
            onClick: () => {
              setShowOverflowMenu(false);
              toggleInlineDraw();
            },
          },
        ]
      : []),
    ...(onToggleDrawMode && features.whiteboard
      ? [
          {
            label: isDrawMode
              ? t("reader.toolbar.exitDraw")
              : t("reader.toolbar.draw"),
            icon: PenTool,
            onClick: onToggleDrawMode,
          },
        ]
      : []),
    {
      label: t("reader.toolbar.undo"),
      icon: Undo2,
      onClick: performUndo,
      disabled: !canUndo,
    },
    {
      label: t("reader.toolbar.screenshot"),
      icon: Camera,
      onClick: onScreenshot,
    },
    {
      label: t("reader.toolbar.screenshotArea"),
      icon: SquareDashedMousePointer,
      onClick: onScreenshotRect,
    },
    ...(onRectToAi
      ? [
          {
            label: t("reader.toolbar.rectToAi"),
            icon: ImagePlus,
            onClick: onRectToAi,
          },
        ]
      : []),
    ...(onToggleSidebar
      ? [
          {
            label: t("reader.toolbar.toggleSidebar"),
            icon: PanelLeft,
            onClick: onToggleSidebar,
          },
        ]
      : []),
    {
      label: t("reader.toolbar.zenMode"),
      icon: Focus,
      onClick: onToggleZenMode,
    },
    {
      label: isFullscreen
        ? t("reader.toolbar.exitFullscreen")
        : t("reader.toolbar.fullscreen"),
      icon: isFullscreen ? Minimize : Maximize,
      onClick: onToggleFullscreen,
    },
    {
      label: t("reader.toolbar.openBookPage"),
      icon: BookMarked,
      onClick: goToDescription,
    },
  ];

  const menuButton = showAppSidebarToggle ? (
    <button
      onClick={() => {
        if (isMobile) setMobileSidebarOpen(true);
        else useUIStore.getState().toggleSidebar();
      }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
      title={t("reader.toolbar.toggleAppSidebar")}
      aria-label={t("reader.toolbar.toggleAppSidebar")}
    >
      <Menu size={20} strokeWidth={1.5} />
    </button>
  ) : null;

  // ---- header pieces --------------------------------------------------

  const backEl = (
    <button
      onClick={handleBack}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
      title={t("reader.toolbar.backToLibrary")}
      aria-label={t("reader.toolbar.backToLibrary")}
    >
      <ChevronLeft size={20} strokeWidth={1.5} />
    </button>
  );

  const sidebarEl = onToggleSidebar ? (
    <Tooltip
      label={t("reader.toolbar.toggleSidebar")}
      shortcut="reader:toggle-toc"
      side="bottom"
    >
      <button
        onClick={onToggleSidebar}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
        aria-label={t("reader.toolbar.toggleSidebar")}
      >
        <PanelLeft size={20} strokeWidth={1.5} />
      </button>
    </Tooltip>
  ) : null;

  // title (+ current section) links to the book's overview page
  const titleEl = (
    <button
      onClick={goToDescription}
      className="flex min-w-0 flex-col items-start text-left cursor-pointer"
      title={t("reader.toolbar.openBookPage")}
    >
      <span className="w-full truncate font-display text-[15px] font-semibold leading-tight text-text-primary">
        {getDisplayTitle()}
      </span>
      <span className="w-full truncate text-xs leading-tight text-text-muted">
        {sectionLabel ?? t("reader.sidebar.page", { n: currentPage })}
      </span>
    </button>
  );

  // "84 / 312" editable page box; Ctrl+G focuses it (data-page-input)
  const pageNavEl = (
    <form
      onSubmit={handlePageSubmit}
      className="flex shrink-0 items-center gap-1 rounded-[10px] px-1.5 text-[13px]"
    >
      <button
        type="button"
        onClick={() => prevPage()}
        disabled={currentPage <= 1}
        className="sr-only"
        aria-label={t("reader.toolbar.prevPage")}
      />
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
        title={t("reader.toolbar.pageNav")}
        aria-label={t("reader.toolbar.pageNav")}
        className={cn(
          "rounded-[8px] bg-transparent py-1 text-center font-medium tabular-nums text-text-secondary outline-none transition-colors hover:bg-bg-tertiary focus:bg-bg-tertiary focus:text-text-primary",
          isMobile ? "w-9 text-xs" : "w-11",
        )}
      />
      <span className="tabular-nums text-text-muted-2">/ {totalPages}</span>
      <button
        type="button"
        onClick={() => nextPage()}
        disabled={currentPage >= totalPages}
        className="sr-only"
        aria-label={t("reader.toolbar.nextPage")}
      />
    </form>
  );

  const zoomEl = (
    <ZoomSelect
      zoomMode={zoomMode}
      zoomLevel={zoomLevel}
      setZoomMode={setZoomMode}
      setZoomLevel={setZoomLevel}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
    />
  );

  // The "Teacher" button: today it toggles the AI margin (Ctrl+I); the
  // teacher mode itself is a later feature.
  const teacherEl = (
    <Tooltip
      label={t("reader.toolbar.aiChatTitle")}
      shortcut="reader:toggle-ai-chat"
      side="bottom"
    >
      <button
        onClick={onToggleAiChat}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-control bg-text-primary px-3.5 text-[13px] font-semibold text-bg-primary transition-opacity hover:opacity-90 cursor-pointer"
        aria-label={t("reader.toolbar.aiChatTitle")}
      >
        <Sparkles size={15} strokeWidth={1.5} />
        {t("reader.tools.teacher")}
      </button>
    </Tooltip>
  );

  const compositeNodes: Record<string, ReactNode> = {
    back: backEl,
    title: (
      <div className="min-w-0 max-w-[14rem] shrink lg:max-w-[24rem]">
        {titleEl}
      </div>
    ),
    pageNav: pageNavEl,
    zoom: zoomEl,
    aiChat: teacherEl,
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
    undo: {
      icon: Undo2,
      label: t("reader.toolbar.undoTitle"),
      onClick: performUndo,
      disabled: !canUndo,
    },
    inPageDraw: {
      icon: Pencil,
      label: inlineDrawActive
        ? t("reader.toolbar.inlineDrawOff")
        : t("reader.toolbar.inlineDrawOn"),
      onClick: () => toggleInlineDraw(),
      active: inlineDrawActive,
      available: features.whiteboard,
    },
    whiteboardDraw: {
      icon: PenTool,
      label: isDrawMode
        ? t("reader.toolbar.exitDraw")
        : t("reader.toolbar.draw"),
      onClick: onToggleDrawMode,
      active: isDrawMode,
      available: !!onToggleDrawMode && features.whiteboard,
    },
    comments: {
      icon: MessageSquare,
      label: t("reader.toolbar.commentsTitle"),
      onClick: onToggleComments,
      available: features.comments,
    },
    zen: {
      icon: Focus,
      label: t("reader.toolbar.zenMode"),
      onClick: onToggleZenMode,
    },
    search: {
      icon: Search,
      label: t("reader.toolbar.search"),
      onClick: onToggleSearch,
    },
    bookmark: {
      icon: BookmarkPlus,
      label: t("reader.toolbar.bookmarkPage"),
      onClick: handleBookmarkPage,
      available: features.bookmarks,
    },
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
    rotate: {
      icon: RotateCw,
      label: t("reader.toolbar.rotate"),
      onClick: () => rotatePage(1),
      available: isPdf,
    },
    night: {
      icon: pdfInvertColors ? Sun : Moon,
      label: pdfInvertColors
        ? t("reader.toolbar.nightModeOff")
        : t("reader.toolbar.nightModeOn"),
      onClick: () => setPdfInvertColors(!pdfInvertColors),
      active: pdfInvertColors,
      available: isPdf,
    },
    reflow: {
      icon: AlignLeft,
      label: pdfReflowMode
        ? t("reader.toolbar.reflowOff")
        : t("reader.toolbar.reflowOn"),
      onClick: () => setPdfReflowMode(!pdfReflowMode),
      active: pdfReflowMode,
      available: isPdf,
    },
    screenshot: {
      icon: Camera,
      label: t("reader.toolbar.screenshotTitle"),
      onClick: onScreenshot,
    },
    screenshotArea: {
      icon: SquareDashedMousePointer,
      label: t("reader.toolbar.screenshotAreaTitle"),
      onClick: onScreenshotRect,
    },
    cropToAi: {
      icon: ImagePlus,
      label: t("reader.toolbar.rectToAi"),
      onClick: onRectToAi,
      available: !!onRectToAi,
    },
    print: {
      icon: Printer,
      label: t("reader.toolbar.printTitle"),
      onClick: onPrint,
    },
    exportMd: {
      icon: FileDown,
      label: t("reader.toolbar.exportHighlightsMarkdown"),
      onClick: () => exportHighlights("markdown"),
    },
    exportJson: {
      icon: FileDown,
      label: t("reader.toolbar.exportHighlightsJson"),
      onClick: () => exportHighlights("json"),
    },
    sidebar: {
      icon: PanelLeft,
      label: t("reader.toolbar.toggleSidebar"),
      onClick: onToggleSidebar,
      available: !!onToggleSidebar,
    },
    fullscreen: {
      icon: isFullscreen ? Minimize : Maximize,
      label: isFullscreen
        ? t("reader.toolbar.exitFullscreen")
        : t("reader.toolbar.fullscreen"),
      onClick: onToggleFullscreen,
    },
    bookPage: {
      icon: BookMarked,
      label: t("reader.toolbar.openBookPage"),
      onClick: goToDescription,
    },
  };

  const isItemAvailable = (id: string): boolean => {
    if (isSeparator(id)) return true;
    if (id in compositeNodes) return true;
    const def = iconDefs[id];
    return def ? (def.available ?? true) : false;
  };

  // Bar items: composites render as themselves, icon items as 36x32
  // cluster buttons. Separators are a 4 px breath (no lines on chrome).
  const renderBarItem = (slotId: string) => {
    if (isSeparator(slotId)) {
      return <div key={slotId} className="w-1 shrink-0" />;
    }
    const composite = compositeNodes[slotId];
    if (composite !== undefined) {
      return <Fragment key={slotId}>{composite}</Fragment>;
    }
    const def = iconDefs[slotId];
    if (!def || !(def.available ?? true)) return null;
    const shortcutId = BAR_ITEM_SHORTCUTS[slotId];
    const btn = (
      <button
        key={slotId}
        onClick={() => def.onClick?.()}
        disabled={def.disabled}
        title={shortcutId ? undefined : def.label}
        aria-label={def.label}
        aria-pressed={def.active}
        style={{
          paddingTop: toolbarStyle.paddingY,
          paddingBottom: toolbarStyle.paddingY,
        }}
        className={cn(
          clusterBtnCls,
          def.active && "bg-bg-tertiary text-text-primary",
        )}
      >
        <def.icon size={18} strokeWidth={1.5} />
      </button>
    );
    if (!shortcutId) return btn;
    return (
      <Tooltip
        key={slotId}
        label={def.label}
        shortcut={shortcutId}
        side="bottom"
      >
        {btn}
      </Tooltip>
    );
  };

  const renderZone = (zone: ToolbarZone) =>
    layout[zone].map((slotId) => renderBarItem(slotId));

  // The kebab lists every available overflow slot; composites (tracker,
  // timer) render their own control next to a label.
  const overflowMenuSlots = layout.overflow.filter(
    (id) =>
      isSeparator(id) ||
      (id in compositeNodes &&
        id !== "title" &&
        id !== "back" &&
        id !== "aiChat") ||
      (iconDefs[id] && isItemAvailable(id)),
  );

  const overflowLabelFor = (id: string): string => {
    if (id === "readingTracker") return t("reader.toolbar.readingTracker");
    if (id === "focusTimer") return t("reader.toolbar.focusTimer");
    if (id === "pageNav") return t("reader.toolbar.pageNav");
    if (id === "zoom") return t("reader.toolbar.zoom");
    return id;
  };

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

  const kebabEl = (
    <div className="relative" ref={overflowRef}>
      <button
        onClick={() => setShowOverflowMenu(!showOverflowMenu)}
        className={cn(
          clusterBtnCls,
          showOverflowMenu && "bg-bg-tertiary text-text-primary",
        )}
        title={t("reader.toolbar.moreActions")}
        aria-label={t("reader.toolbar.moreActions")}
        aria-expanded={showOverflowMenu}
      >
        <MoreVertical size={18} strokeWidth={1.5} />
      </button>
    </div>
  );

  return (
    <div className="pt-safe-top pl-safe-left pr-safe-right">
      <div
        className={cn(
          "flex items-center gap-3 px-2 sm:px-4",
          isMobile ? "h-12" : "py-2",
        )}
        style={isMobile ? undefined : { minHeight: toolbarStyle.height + 16 }}
      >
        {isMobile ? (
          /* MOBILE: hamburger, page box, tracker/timer, kebab */
          <>
            <div className="flex shrink-0 items-center gap-1">{menuButton}</div>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
              <div className="flex items-center rounded-[14px] bg-bg-secondary p-1">
                {pageNavEl}
              </div>
            </div>
            <div className="flex flex-1 items-center justify-end gap-1">
              <ReadingTrackerControl compact />
              <FocusSessionControl compact />
              <div className="relative" ref={overflowRef}>
                <button
                  onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer touch-target"
                  aria-label={t("reader.toolbar.moreActions")}
                >
                  <MoreVertical size={20} strokeWidth={1.5} />
                </button>
              </div>
              <FloatingMenu
                open={showOverflowMenu}
                anchorRef={overflowRef}
                onClose={() => setShowOverflowMenu(false)}
                className="w-52 p-1"
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
                      className={cn(menuRowCls, "gap-3 px-3 py-2.5 text-sm")}
                    >
                      <Icon size={16} strokeWidth={1.5} />
                      {label}
                    </button>
                  ),
                )}
              </FloatingMenu>
            </div>
          </>
        ) : (
          /* DESKTOP / TABLET: back + title | pill cluster | Teacher */
          <>
            {/* LEFT: back chevron, TOC toggle, title block */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {layout.left.includes("back") ? backEl : null}
              {sidebarEl}
              {layout.left.includes("title") ? compositeNodes.title : null}
              {layout.left
                .filter((id) => id !== "back" && id !== "title")
                .map((id) => renderBarItem(id))}
            </div>

            {/* CENTER: the pill cluster (surface 1, radius 14, 4 px pad) + kebab */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-[14px] bg-bg-secondary p-1">
              {renderZone("center")}
              {kebabEl}
            </div>

            {/* RIGHT: the Teacher button (+ anything the user dragged here) */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
              {renderZone("right")}
            </div>

            {/* portaled so the PDF dockview can't paint over it */}
            <FloatingMenu
              open={showOverflowMenu}
              anchorRef={overflowRef}
              onClose={() => setShowOverflowMenu(false)}
              className="reader-overflow-menu w-56 p-1"
            >
              {overflowMenuSlots.map((id) => {
                if (isSeparator(id)) {
                  return <div key={id} className="my-1 h-1" />;
                }
                const composite = compositeNodes[id];
                if (composite !== undefined) {
                  return (
                    <div
                      key={id}
                      className="flex w-full items-center gap-2 rounded-[10px] px-1 py-0.5 text-xs text-text-secondary"
                    >
                      {composite}
                      <span className="min-w-0 flex-1 truncate">
                        {overflowLabelFor(id)}
                      </span>
                    </div>
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
                    aria-pressed={def.active}
                    className={cn(
                      menuRowCls,
                      def.active && "bg-bg-tertiary text-text-primary",
                    )}
                  >
                    <Icon size={16} strokeWidth={1.5} />
                    {def.label}
                  </button>
                );
              })}
              <div className="my-1 h-1" />
              {/* cover tint preference (reader-only, default on) */}
              <div
                className={cn(
                  menuRowCls,
                  "justify-between cursor-default hover:bg-transparent",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Palette size={16} strokeWidth={1.5} />
                  {t("reader.toolbar.coverTint")}
                </span>
                <Toggle
                  checked={coverTint}
                  onChange={toggleCoverTint}
                  label={t("reader.toolbar.coverTint")}
                />
              </div>
              <button
                onClick={() => {
                  setEditingToolbar(true);
                  setShowOverflowMenu(false);
                }}
                className={menuRowCls}
              >
                <Settings2 size={16} strokeWidth={1.5} />
                {t("reader.toolbar.customize")}
              </button>
            </FloatingMenu>
          </>
        )}
      </div>

      {/* highlight-color picker, anchored to the overflow button */}
      <FloatingMenu
        open={showColorPicker}
        anchorRef={overflowRef}
        onClose={() => setShowColorPicker(false)}
        className="!min-w-0 flex gap-1.5 p-2"
      >
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            className={cn(
              "rounded-full transition-transform cursor-pointer hover:scale-110",
              isMobile ? "h-7 w-7 touch-target" : "h-5 w-5",
              activeHighlightColor === color &&
                "ring-2 ring-text-primary/60 ring-offset-2 ring-offset-bg-tertiary",
            )}
            style={{ backgroundColor: COLOR_HEX[color] }}
            onClick={() => {
              setActiveHighlightColor(color);
              setShowColorPicker(false);
            }}
            title={color}
            aria-label={color}
          />
        ))}
      </FloatingMenu>
    </div>
  );
}
