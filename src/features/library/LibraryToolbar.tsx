import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  LayoutGrid,
  List,
  X,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui";
import {
  fieldClass,
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
} from "@/components/ui/classes";
import { useIsMobile } from "@/hooks/use-media-query";
import type { ViewMode } from "./useLibraryPrefs";

interface LibraryToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Breadcrumb (and anything else the parent leads with). */
  leading?: ReactNode;
  /** Primary action(s) closing out the row on the right. */
  trailing?: ReactNode;
}

/**
 * Library page header: breadcrumb on the left, then search, refresh,
 * the list/grid segmented toggle and the primary Add button on the
 * right. Mobile keeps one tight row (breadcrumb, view toggle, Add)
 * and puts the full-width search field on a second line.
 */
export function LibraryToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  onRefresh,
  isRefreshing,
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
        fieldClass,
        "flex items-center gap-2",
        isMobile ? "w-full" : "w-[300px]",
      )}
    >
      <Search size={16} strokeWidth={1.5} className="shrink-0 text-text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t("library.toolbar.searchPlaceholder")}
        aria-label={t("library.toolbar.search")}
        className="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-muted-2 outline-none"
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
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );

  // Segmented list / grid toggle; the active half is filled.
  const viewToggle = (
    <div className={cn(segmentedGroupClass, "shrink-0")}>
      <button
        type="button"
        onClick={() => onViewModeChange("list")}
        aria-pressed={viewMode === "list"}
        className={cn(
          segmentedItemClass,
          "px-2.5",
          viewMode === "list" && segmentedItemActiveClass,
        )}
        title={t("library.toolbar.listView")}
        aria-label={t("library.toolbar.listView")}
      >
        <List size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange("grid")}
        aria-pressed={viewMode === "grid"}
        className={cn(
          segmentedItemClass,
          "px-2.5",
          viewMode === "grid" && segmentedItemActiveClass,
        )}
        title={t("library.toolbar.gridView")}
        aria-label={t("library.toolbar.gridView")}
      >
        <LayoutGrid size={16} strokeWidth={1.5} />
      </button>
    </div>
  );

  const refreshButton = (
    <IconButton
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      title={t("library.toolbar.refresh")}
      aria-label={t("library.toolbar.refresh")}
    >
      <RefreshCw
        size={16}
        strokeWidth={1.5}
        className={cn(isRefreshing && "animate-spin")}
      />
    </IconButton>
  );

  return (
    <div className="mb-3 pb-1">
      <div className="flex items-center gap-2 md:gap-3">
        {leading}
        <div className="min-w-0 flex-1" />
        {!isMobile && searchField}
        {!isMobile && refreshButton}
        {viewToggle}
        {trailing}
      </div>

      {/* Mobile: search + refresh on their own line so the main row
          stays a single tight line. */}
      {isMobile && (
        <div className="mt-2 flex items-center gap-2">
          {searchField}
          {refreshButton}
        </div>
      )}
    </div>
  );
}
