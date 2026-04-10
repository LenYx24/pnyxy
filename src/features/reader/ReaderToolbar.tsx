import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Columns2,
  Maximize,
  Minimize,
  Highlighter,
  MessageSquare,
  Undo2,
  PenTool,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useReaderStore, useActiveDocument } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useUndoStore } from "@/stores/undo-store";
import type { HighlightColor } from "@/types/annotation";

const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "orange"];
const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

interface ReaderToolbarProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleComments?: () => void;
  onOpenPdfOnCanvas?: () => void;
}

export function ReaderToolbar({
  isFullscreen,
  onToggleFullscreen,
  onToggleComments,
  onOpenPdfOnCanvas,
}: ReaderToolbarProps) {
  const activeDoc = useActiveDocument();
  const goToPage = useReaderStore((s) => s.goToPage);
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);
  const setCustomTitle = useReaderStore((s) => s.setCustomTitle);
  const getDisplayTitle = useReaderStore((s) => s.getDisplayTitle);

  const activeHighlightColor = useAnnotationStore((s) => s.activeHighlightColor);
  const setActiveHighlightColor = useAnnotationStore((s) => s.setActiveHighlightColor);
  const canUndo = useUndoStore((s) => s.stack.length > 0);
  const performUndo = useUndoStore((s) => s.performUndo);
  const [pageInput, setPageInput] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="flex h-11 items-center justify-between border-b border-glass-border bg-bg-secondary/60 backdrop-blur-md px-4">
      {/* Left: title (click to edit) */}
      <div className="flex-1 min-w-0">
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

      {/* Center: page navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => prevPage()}
          disabled={currentPage <= 1}
          className={cn(
            "rounded-md p-1.5 transition-colors cursor-pointer",
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
            "rounded-md p-1.5 transition-colors cursor-pointer",
            "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            "disabled:opacity-30 disabled:cursor-not-allowed",
          )}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Right: zoom controls */}
      <div className="flex flex-1 items-center justify-end gap-1">
        <button
          onClick={() => zoomOut()}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <ZoomOut size={16} />
        </button>
        <span className="min-w-[3rem] text-center text-xs text-text-muted">
          {zoomMode === "custom" ? `${zoomLevel}%` : zoomMode === "fit-width" ? "Width" : "Page"}
        </span>
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
        {/* Open PDF on canvas */}
        {onOpenPdfOnCanvas && (
          <button
            onClick={onOpenPdfOnCanvas}
            className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            title="Draw on PDF (opens whiteboard with PDF background)"
          >
            <PenTool size={16} />
          </button>
        )}
        {/* Comments panel toggle */}
        <button
          onClick={onToggleComments}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title="Toggle comments panel (Ctrl+M)"
        >
          <MessageSquare size={16} />
        </button>
        <div className="mx-1 h-4 w-px bg-glass-border" />
        <button
          onClick={onToggleFullscreen}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>
    </div>
  );
}
