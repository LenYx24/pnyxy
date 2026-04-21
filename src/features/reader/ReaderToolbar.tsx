import { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
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
  Camera,
  Crop,
  Printer,
  Search,
  MoreHorizontal,
  BotMessageSquare,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument, type ZoomMode } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useUndoStore } from "@/stores/undo-store";
import { useIsMobile, useIsDesktop } from "@/hooks/use-media-query";
import { ReadingTrackerControl } from "./ReadingTrackerControl";
import { FocusSessionControl } from "./FocusSessionControl";
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
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const displayText =
    zoomMode === "custom"
      ? `${zoomLevel}%`
      : zoomMode === "fit-width"
        ? "Width"
        : "Page";

  const handleStartEdit = useCallback(() => {
    setInputValue(String(zoomLevel));
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
      className="min-w-[3rem] rounded px-1 py-0.5 text-center text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      title="Click to set custom zoom, double-click to cycle fit mode"
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
  onPrint?: () => void;
  onToggleSearch?: () => void;
  onToggleAiChat?: () => void;
  onToggleZenMode?: () => void;
}

export function ReaderToolbar({
  isFullscreen,
  onToggleFullscreen,
  onToggleComments,
  isDrawMode,
  onToggleDrawMode,
  onScreenshot,
  onScreenshotRect,
  onPrint,
  onToggleSearch,
  onToggleAiChat,
  onToggleZenMode,
}: ReaderToolbarProps) {
  const navigate = useNavigate();
  const activeDoc = useActiveDocument();
  const goToPage = useReaderStore((s) => s.goToPage);
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);
  const setZoomLevel = useReaderStore((s) => s.setZoomLevel);
  const setCustomTitle = useReaderStore((s) => s.setCustomTitle);
  const getDisplayTitle = useReaderStore((s) => s.getDisplayTitle);

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

  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  if (!activeDoc) return null;

  const { currentPage, totalPages, zoomMode, zoomLevel } = activeDoc;

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(pageInput, 10);
    if (!isNaN(page)) {
      goToPage(page);
    }
    setPageInput("");
  };

  // Mobile overflow menu items
  const overflowActions = [
    { label: "Zoom In", icon: ZoomIn, onClick: () => zoomIn() },
    { label: "Zoom Out", icon: ZoomOut, onClick: () => zoomOut() },
    { label: "Fit Mode", icon: Columns2, onClick: () => setZoomMode(zoomMode === "fit-width" ? "fit-page" : "fit-width") },
    { label: "Highlight", icon: Highlighter, onClick: () => { setShowOverflowMenu(false); setShowColorPicker(!showColorPicker); } },
    ...(onToggleDrawMode ? [{ label: isDrawMode ? "Exit Draw" : "Draw", icon: PenTool, onClick: onToggleDrawMode }] : []),
    { label: "Undo", icon: Undo2, onClick: performUndo, disabled: !canUndo },
    { label: "Screenshot", icon: Camera, onClick: onScreenshot },
    { label: "Area screenshot", icon: Crop, onClick: onScreenshotRect },
    { label: "Print", icon: Printer, onClick: onPrint },
    { label: "Search", icon: Search, onClick: onToggleSearch },
    { label: "Comments", icon: MessageSquare, onClick: onToggleComments },
    { label: "AI Chat", icon: BotMessageSquare, onClick: onToggleAiChat },
    { label: "Zen mode", icon: Focus, onClick: onToggleZenMode },
    { label: isFullscreen ? "Exit Fullscreen" : "Fullscreen", icon: isFullscreen ? Minimize : Maximize, onClick: onToggleFullscreen },
  ];

  // Tablet: hide screenshot/print, show them in a smaller overflow
  const tabletOverflowActions = [
    { label: "Screenshot", icon: Camera, onClick: onScreenshot },
    { label: "Area screenshot", icon: Crop, onClick: onScreenshotRect },
    { label: "Print", icon: Printer, onClick: onPrint },
  ];

  return (
    <div className="flex h-11 items-center justify-between border-b border-glass-border bg-bg-secondary/60 backdrop-blur-md px-2 sm:px-4">
      {/* Left: back button + title (click to edit) */}
      <div className="flex flex-1 min-w-0 items-center gap-1">
        <button
          onClick={() => navigate("/library")}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer shrink-0"
          title="Back to library"
        >
          <ArrowLeft size={16} />
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
            title="Click to rename"
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
            "rounded-md p-1.5 transition-colors cursor-pointer touch-target",
            "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            "disabled:opacity-30 disabled:cursor-not-allowed",
          )}
        >
          <ChevronLeft size={16} />
        </button>

        <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
          <input
            data-page-input
            type="text"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            placeholder={String(currentPage)}
            className="w-10 rounded border border-glass-border bg-glass-bg px-1.5 py-0.5 text-center text-xs text-text-primary outline-none focus:border-accent-purple"
          />
          <span className="text-xs text-text-muted">/ {totalPages}</span>
        </form>

        <button
          onClick={() => nextPage()}
          disabled={currentPage >= totalPages}
          className={cn(
            "rounded-md p-1.5 transition-colors cursor-pointer touch-target",
            "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            "disabled:opacity-30 disabled:cursor-not-allowed",
          )}
        >
          <ChevronRight size={16} />
        </button>
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
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer touch-target"
            >
              <MoreHorizontal size={18} />
            </button>
            {showOverflowMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl py-1">
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
              onClick={() => zoomOut()}
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
              onClick={() => zoomIn()}
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
              title="Toggle fit mode"
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
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Highlight color */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer flex items-center gap-1"
                title="Highlight color"
              >
                <Highlighter size={16} />
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: COLOR_HEX[activeHighlightColor] }}
                />
              </button>
              {showColorPicker && (
                <div className="absolute top-full right-0 mt-1 flex gap-1 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md p-2 shadow-xl z-50">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "h-5 w-5 rounded-full border-2 transition-colors cursor-pointer hover:scale-110",
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
                </div>
              )}
            </div>
            {onToggleDrawMode && (
              <button
                onClick={onToggleDrawMode}
                className={cn(
                  "rounded-md p-1.5 transition-colors cursor-pointer",
                  isDrawMode
                    ? "text-accent-purple bg-accent-purple/10"
                    : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
                )}
                title={isDrawMode ? "Back to PDF viewer" : "Draw on PDF"}
              >
                <PenTool size={16} />
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <button
              onClick={onToggleSearch}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Search (Ctrl+F)"
            >
              <Search size={16} />
            </button>
            <button
              onClick={onToggleComments}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Toggle comments panel (Ctrl+M)"
            >
              <MessageSquare size={16} />
            </button>
            <button
              onClick={onToggleAiChat}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="AI Chat (Ctrl+I)"
            >
              <BotMessageSquare size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <ReadingTrackerControl />
            <FocusSessionControl />
            <button
              onClick={onToggleZenMode}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Zen mode"
            >
              <Focus size={16} />
            </button>
            <button
              onClick={onToggleFullscreen}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
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
                  <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-xl shadow-xl py-1">
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
              onClick={() => zoomOut()}
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
              onClick={() => zoomIn()}
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
              title="Toggle fit mode"
            >
              <Columns2 size={16} />
            </button>
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
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Highlight color button */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer flex items-center gap-1"
                title="Highlight color"
              >
                <Highlighter size={16} />
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: COLOR_HEX[activeHighlightColor] }}
                />
              </button>
              {showColorPicker && (
                <div className="absolute top-full right-0 mt-1 flex gap-1 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md p-2 shadow-xl z-50">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "h-5 w-5 rounded-full border-2 transition-colors cursor-pointer hover:scale-110",
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
                </div>
              )}
            </div>
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
                title={isDrawMode ? "Back to PDF viewer" : "Draw on PDF"}
              >
                <PenTool size={16} />
              </button>
            )}
            <div className="mx-1 h-4 w-px bg-glass-border" />
            {/* Screenshot */}
            <button
              onClick={onScreenshot}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Screenshot viewport (Ctrl+Shift+S)"
            >
              <Camera size={16} />
            </button>
            {/* Area (rectangle) screenshot */}
            <button
              onClick={onScreenshotRect}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Screenshot an area"
            >
              <Crop size={16} />
            </button>
            {/* Print */}
            <button
              onClick={onPrint}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Print (Ctrl+P)"
            >
              <Printer size={16} />
            </button>
            {/* Search */}
            <button
              onClick={onToggleSearch}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Search (Ctrl+F)"
            >
              <Search size={16} />
            </button>
            {/* Comments panel toggle */}
            <button
              onClick={onToggleComments}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Toggle comments panel (Ctrl+M)"
            >
              <MessageSquare size={16} />
            </button>
            {/* AI Chat toggle */}
            <button
              onClick={onToggleAiChat}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="AI Chat (Ctrl+I)"
            >
              <BotMessageSquare size={16} />
            </button>
            <div className="mx-1 h-4 w-px bg-glass-border" />
            <ReadingTrackerControl />
            <FocusSessionControl />
            <button
              onClick={onToggleZenMode}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title="Zen mode"
            >
              <Focus size={16} />
            </button>
            <button
              onClick={onToggleFullscreen}
              className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </>
        )}
      </div>

      {/* Color picker (for mobile, shown separately when triggered from overflow) */}
      {isMobile && showColorPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowColorPicker(false)} />
          <div className="absolute right-2 top-full z-50 mt-1 flex gap-2 rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md p-3 shadow-xl">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-colors cursor-pointer hover:scale-110 touch-target",
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
          </div>
        </>
      )}
    </div>
  );
}
