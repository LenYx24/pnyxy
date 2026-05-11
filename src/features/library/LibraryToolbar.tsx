import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, LayoutGrid, List, X, RefreshCw, SlidersHorizontal } from "lucide-react";
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
  /** Mobile-only: parent-owned expand state so the toolbar toggle also
   *  reveals/hides the tag filter bar rendered as a sibling. */
  mobileControlsExpanded?: boolean;
  onToggleMobileControls?: () => void;
}

export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  onRefresh,
  isRefreshing,
  mobileControlsExpanded = false,
  onToggleMobileControls,
}: LibraryToolbarProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [searchFocused, setSearchFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const searchActive = searchFocused || searchQuery.length > 0;

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Ctrl+K used to focus this input; that shortcut now opens the
  // global command palette instead. The library search is still a
  // visible input — click it or Tab to it. The palette covers the
  // "I want to find this book" flow with broader scope (catalog, nav,
  // commands) anyway.

  // Escape clears/blurs search when active; the central registry skips
  // keydown events originating inside inputs except for Escape, so this
  // handler runs while the input has focus.
  useEffect(() => {
    if (!searchActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchFocused(false);
        onSearchChange("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchActive, onSearchChange]);

  // View-mode toggle stays visible on every viewport — it's a
  // primary affordance for users who want to switch between
  // covers-focused (grid) and high-density (list) browsing.
  const viewToggle = (
    <div className="flex shrink-0 rounded-lg border border-glass-border bg-glass-bg p-0.5">
      <button
        onClick={() => onViewModeChange("grid")}
        className={cn(
          "rounded-md p-1.5 transition-colors cursor-pointer",
          viewMode === "grid"
            ? "bg-accent-purple/15 text-accent-purple"
            : "text-text-muted hover:text-text-primary",
        )}
        title={t("library.toolbar.gridView")}
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
        title={t("library.toolbar.listView")}
      >
        <List size={16} />
      </button>
    </div>
  );

  // Refresh tucks into the mobile expander — pull-to-refresh already
  // exists at the page level on phones, so the explicit button is
  // redundant chrome there. Still useful on desktop where there's
  // no PTR gesture.
  const refreshButton = (
    <button
      onClick={onRefresh}
      disabled={isRefreshing}
      className="shrink-0 rounded-lg border border-glass-border bg-glass-bg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary disabled:opacity-50 cursor-pointer"
      title={t("library.toolbar.refresh")}
    >
      <RefreshCw size={16} className={cn(isRefreshing && "animate-spin")} />
    </button>
  );

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
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
                placeholder={t("library.toolbar.searchPlaceholder")}
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
              onClick={focusSearch}
              title={t("library.toolbar.search")}
              className="flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Search size={14} />
              <span className="hidden sm:inline">
                {t("library.toolbar.search")}
              </span>
            </button>
          )}
        </div>

        {/* Spacer */}
        {!searchActive && <div className="flex-1" />}

        {isMobile ? (
          <>
            {viewToggle}
            <button
              onClick={onToggleMobileControls}
              aria-expanded={mobileControlsExpanded}
              aria-label={t("library.toolbar.toggleControls")}
              title={t("library.toolbar.toggleControls")}
              className={cn(
                "shrink-0 rounded-lg border p-1.5 transition-colors cursor-pointer",
                mobileControlsExpanded
                  ? "border-accent-purple/40 bg-accent-purple/10 text-accent-purple"
                  : "border-glass-border bg-glass-bg text-text-muted hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              <SlidersHorizontal size={16} />
            </button>
          </>
        ) : (
          <>
            {refreshButton}
            {viewToggle}
          </>
        )}
      </div>

      {/* Collapsible controls drawer on mobile. Holds the
          rarely-used Refresh button (PTR covers the common case)
          plus the parent renders the Tag filter + Storage bar
          here too via the same `mobileControlsExpanded` flag. */}
      {isMobile && mobileControlsExpanded && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-glass-border bg-glass-bg/60 p-2">
          {refreshButton}
        </div>
      )}
    </div>
  );
}
