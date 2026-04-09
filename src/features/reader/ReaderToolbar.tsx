import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Columns2,
  Maximize,
  Minimize,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useReaderStore } from "@/stores/reader-store";

interface ReaderToolbarProps {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function ReaderToolbar({
  isFullscreen,
  onToggleFullscreen,
}: ReaderToolbarProps) {
  const {
    meta,
    currentPage,
    totalPages,
    zoomMode,
    zoomLevel,
    goToPage,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    setZoomMode,
  } = useReaderStore();

  const [pageInput, setPageInput] = useState("");

  if (!meta) return null;

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
      {/* Left: title */}
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-secondary truncate block">
          {meta.title}
        </span>
      </div>

      {/* Center: page navigation */}
      <div className="flex items-center gap-1">
        <button
          onClick={prevPage}
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
          onClick={nextPage}
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
          onClick={zoomOut}
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <ZoomOut size={16} />
        </button>
        <span className="min-w-[3rem] text-center text-xs text-text-muted">
          {zoomMode === "custom" ? `${zoomLevel}%` : zoomMode === "fit-width" ? "Width" : "Page"}
        </span>
        <button
          onClick={zoomIn}
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
