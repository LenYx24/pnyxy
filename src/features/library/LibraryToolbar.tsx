import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Search, LayoutGrid, List, X, RefreshCw, ChevronDown } from "lucide-react";
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
  /** Whether the collapsible panel (search + tag filter, plus the
   *  storage bar on mobile) is currently open. Persisted via
   *  useLibraryPrefs, so the user's pick survives reloads. */
  controlsExpanded?: boolean;
  onToggleControls?: () => void;
  /** Rendered at the very start of the toolbar row — the page title
   *  lives here so the whole header is a single line. */
  leading?: ReactNode;
  /** Rendered at the very end of the row — the Upload / New-folder
   *  actions sit here. */
  trailing?: ReactNode;
}

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
            ? "bg-accent/15 text-accent"
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
            ? "bg-accent/15 text-accent"
            : "text-text-muted hover:text-text-primary",
        )}
        title={t("library.toolbar.listView")}
      >
        <List size={16} />
      </button>
    </div>
  );

  // Refresh: desktop puts it in the main row (no PTR gesture there);
  // mobile tucks it inside the expander since pull-to-refresh covers
  // the common case at the page level.
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

  // Disclosure toggle for the collapsible panel. A single chevron
  // that rotates 180° between states — same pattern as the settings
  // TabDropdown elsewhere in the app. When expanded the search input
  // + tag filter bar are visible; when collapsed the toolbar shrinks
  // to just this toggle + view/refresh controls.
  const toggleControlsButton = onToggleControls ? (
    <button
      onClick={onToggleControls}
      aria-expanded={controlsExpanded}
      aria-label={t("library.toolbar.toggleControls")}
      title={t("library.toolbar.toggleControls")}
      className={cn(
        "shrink-0 rounded-lg border p-1.5 transition-colors cursor-pointer",
        controlsExpanded
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-glass-border bg-glass-bg text-text-muted hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      <ChevronDown
        size={16}
        className={cn(
          "transition-transform",
          controlsExpanded && "rotate-180",
        )}
      />
    </button>
  ) : null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Page title (and anything else the parent leads with) sits
            first so the header reads as one line. */}
        {leading}

        {/* Disclosure toggle — clicking it shows the search/filter
            chrome below. */}
        {toggleControlsButton}

        {/* Search — always visible on desktop (it's a primary
            affordance; hiding it behind the disclosure added friction).
            On mobile it stays behind the chevron so the collapsed
            toolbar keeps a tight single row; the tag filter + storage
            bar remain gated by `controlsExpanded` in either case. */}
        {(controlsExpanded || !isMobile) && (
          <div
            className={cn(
              "relative flex items-center transition-all duration-200",
              searchActive ? "w-full sm:flex-1 sm:w-auto" : "w-auto",
            )}
          >
            {searchActive ? (
              <div className="flex w-full items-center gap-2 rounded-lg border border-accent/40 bg-bg-secondary px-3 py-1.5 shadow-sm shadow-accent/10">
                <Search size={14} className="shrink-0 text-accent" />
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
        )}

        {/* Spacer pushes view/refresh controls to the far right
            whenever the search field isn't stretching to fill
            (i.e. the search input isn't active/expanded). */}
        {!searchActive && <div className="flex-1" />}

        {isMobile ? (
          viewToggle
        ) : (
          <>
            {refreshButton}
            {viewToggle}
          </>
        )}

        {/* Upload / New folder (and anything else the parent trails
            with) close out the row on the right. */}
        {trailing}
      </div>

      {/* Mobile-only secondary row inside the expander. The parent
          renders the Tag filter + Storage bar via the same
          `controlsExpanded` flag, so this stays focused on the bits
          unique to the toolbar (Refresh — PTR covers the common case
          on phones but the explicit button is still useful). */}
      {isMobile && controlsExpanded && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-glass-border bg-glass-bg/60 p-2">
          {refreshButton}
        </div>
      )}
    </div>
  );
}
