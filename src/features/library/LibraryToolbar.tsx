import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  LayoutGrid,
  List,
  X,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/hooks/use-media-query";
import type { ViewMode } from "./useLibraryPrefs";

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Whether the collapsible filter chrome (tag filter, and on mobile
   *  the search field) is open. Persisted via useLibraryPrefs. */
  controlsExpanded?: boolean;
  onToggleControls?: () => void;
  /** Breadcrumb (and anything else the parent leads with). */
  leading?: ReactNode;
  /** Primary action(s) closing out the row on the right. */
  trailing?: ReactNode;
}

/**
 * Library page header: breadcrumb on the left, then search, refresh,
 * the list/grid segmented toggle and the primary Add button on the
 * right. Mobile keeps one tight row and drops the search field into
 * the expander below it.
 */
export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  onRefresh,
  isRefreshing,
  controlsExpanded = true,
  onToggleControls,
  leading,
  trailing,
}: LibraryToolbarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape clears the search while the field has a query; the central
  // shortcut registry skips keydown events from inputs except Escape,
  // so this handler runs while the input is focused.
  useEffect(() => {
    if (!searchQuery) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSearchChange("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchQuery, onSearchChange]);

  const searchField = (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-bg-secondary px-3 py-2 text-sm transition-colors",
        "focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/25",
        searchQuery ? "border-accent/40" : "border-glass-border",
        isMobile ? "w-full" : "w-[300px]",
      )}
    >
      <Search size={16} className="shrink-0 text-text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t("library.toolbar.searchPlaceholder")}
        aria-label={t("library.toolbar.search")}
        className="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => {
            onSearchChange("");
            inputRef.current?.focus();
          }}
          className="shrink-0 cursor-pointer text-text-muted transition-colors hover:text-text-primary"
          aria-label={t("common.clear")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  // Segmented list / grid toggle; the active half is filled.
  const viewToggle = (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-glass-border">
      <button
        type="button"
        onClick={() => onViewModeChange("list")}
        aria-pressed={viewMode === "list"}
        className={cn(
          "px-2.5 py-2 transition-colors cursor-pointer",
          viewMode === "list"
            ? "bg-glass-hover text-text-primary"
            : "text-text-muted hover:text-text-primary",
        )}
        title={t("library.toolbar.listView")}
        aria-label={t("library.toolbar.listView")}
      >
        <List size={16} />
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange("grid")}
        aria-pressed={viewMode === "grid"}
        className={cn(
          "px-2.5 py-2 transition-colors cursor-pointer",
          viewMode === "grid"
            ? "bg-glass-hover text-text-primary"
            : "text-text-muted hover:text-text-primary",
        )}
        title={t("library.toolbar.gridView")}
        aria-label={t("library.toolbar.gridView")}
      >
        <LayoutGrid size={16} />
      </button>
    </div>
  );

  const refreshButton = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      className="shrink-0 rounded-lg border border-glass-border p-2 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-50 cursor-pointer"
      title={t("library.toolbar.refresh")}
      aria-label={t("library.toolbar.refresh")}
    >
      <RefreshCw size={16} className={cn(isRefreshing && "animate-spin")} />
    </button>
  );

  // Disclosure toggle for the filter chrome (tag filter row; on mobile
  // also the search field and refresh).
  const toggleControlsButton = onToggleControls ? (
    <button
      type="button"
      onClick={onToggleControls}
      aria-expanded={controlsExpanded}
      aria-label={t("library.toolbar.toggleControls")}
      title={t("library.toolbar.toggleControls")}
      className={cn(
        "shrink-0 rounded-lg border p-2 transition-colors cursor-pointer",
        controlsExpanded
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-glass-border text-text-muted hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      <ChevronDown
        size={16}
        className={cn("transition-transform", controlsExpanded && "rotate-180")}
      />
    </button>
  ) : null;

  return (
    <div className="mb-3 border-b border-glass-border pb-3">
      <div className="flex items-center gap-2 md:gap-3">
        {leading}
        <div className="min-w-0 flex-1" />
        {!isMobile && searchField}
        {!isMobile && refreshButton}
        {toggleControlsButton}
        {viewToggle}
        {trailing}
      </div>

      {/* Mobile: search + refresh live in the expander so the main row
          stays a single tight line. */}
      {isMobile && controlsExpanded && (
        <div className="mt-2 flex items-center gap-2">
          {searchField}
          {refreshButton}
        </div>
      )}
    </div>
  );
}
