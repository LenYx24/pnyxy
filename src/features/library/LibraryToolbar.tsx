import { useState, useRef, useEffect } from "react";
import { Search, LayoutGrid, List, X, RefreshCw } from "lucide-react";
import { Slider } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ViewMode } from "./useLibraryPrefs";

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  cardSize: number;
  onCardSizeChange: (size: number) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  cardSize,
  onCardSizeChange,
  onRefresh,
  isRefreshing,
}: LibraryToolbarProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchActive = searchFocused || searchQuery.length > 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchFocused(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && searchActive) {
        setSearchFocused(false);
        onSearchChange("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchActive, onSearchChange]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* Search */}
      <div
        className={cn(
          "relative flex items-center transition-all duration-200",
          searchActive ? "w-full sm:flex-1 sm:w-auto" : "w-auto",
        )}
      >
        {searchActive ? (
          <div className="flex w-full items-center gap-2 rounded-lg border border-accent-purple/40 bg-bg-secondary px-3 py-1.5 shadow-sm shadow-accent-purple/10">
            <Search size={14} className="shrink-0 text-accent-purple" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                if (!searchQuery) setSearchFocused(false);
              }}
              placeholder="Search books and folders..."
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
              autoFocus
            />
            {searchQuery && (
              <span className="shrink-0 text-xs text-text-muted">
                {/* result count injected by parent if needed */}
              </span>
            )}
            <button
              onClick={() => {
                onSearchChange("");
                setSearchFocused(false);
                inputRef.current?.blur();
              }}
              className="shrink-0 cursor-pointer text-text-muted transition-colors hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setSearchFocused(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex items-center rounded border border-glass-border px-1 py-0.5 text-[10px] font-mono">
              {navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}K
            </kbd>
          </button>
        )}
      </div>

      {/* Spacer */}
      {!searchActive && <div className="flex-1" />}

      {/* Refresh */}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="shrink-0 rounded-lg border border-glass-border bg-glass-bg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-50 cursor-pointer"
        title="Refresh library"
      >
        <RefreshCw size={16} className={cn(isRefreshing && "animate-spin")} />
      </button>

      {/* View mode toggle */}
      <div className="flex shrink-0 rounded-lg border border-glass-border bg-glass-bg p-0.5">
        <button
          onClick={() => onViewModeChange("grid")}
          className={cn(
            "rounded-md p-1.5 transition-colors cursor-pointer",
            viewMode === "grid"
              ? "bg-accent-purple/15 text-accent-purple"
              : "text-text-muted hover:text-text-primary",
          )}
          title="Grid view"
        >
          <LayoutGrid size={16} />
        </button>
        <button
          onClick={() => onViewModeChange("list")}
          className={cn(
            "rounded-md p-1.5 transition-colors cursor-pointer",
            viewMode === "list"
              ? "bg-accent-purple/15 text-accent-purple"
              : "text-text-muted hover:text-text-primary",
          )}
          title="List view"
        >
          <List size={16} />
        </button>
      </div>

      {/* Size slider */}
      <div className="hidden w-24 shrink-0 sm:flex">
        <Slider
          value={cardSize}
          onChange={onCardSizeChange}
          min={140}
          max={320}
          step={10}
        />
      </div>
    </div>
  );
}
