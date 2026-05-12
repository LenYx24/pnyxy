import { useState, useCallback } from "react";

export type ViewMode = "grid" | "list";

const STORAGE_KEY = "pnyxy-library-prefs";
const SORT_ORDERS_KEY = "pnyxy-library-sort-orders";

interface LibraryPrefs {
  viewMode: ViewMode;
  cardSize: number; // 140–320, grid minWidth in px
  // Whether the search box + tag filter row are visible. Toolbar
  // exposes a chevron toggle. Default is platform-aware (mobile
  // collapsed, desktop expanded) but the user's explicit pick is
  // persisted from then on.
  controlsExpanded: boolean;
}

// Map of folder context → ordered item keys
// Keys are "folder:<id>" or "book:<id>" strings
type SortOrdersMap = Record<string, string[]>;

const DEFAULT_PREFS: LibraryPrefs = {
  viewMode: "grid",
  cardSize: 200,
  controlsExpanded: true,
};

function loadPrefs(): LibraryPrefs {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 640px)").matches;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LibraryPrefs>;
      // If `controlsExpanded` was never written (older clients), fall
      // back to the platform default rather than the object default.
      const controlsExpanded =
        parsed.controlsExpanded ?? (isMobile ? false : true);
      return { ...DEFAULT_PREFS, ...parsed, controlsExpanded };
    }
  } catch {
    // ignore
  }
  // First-time visitors land on the platform-appropriate default —
  // mobile gets list (less visually noisy, matches the Nextcloud-
  // style files UI we're modeling after); desktop keeps grid which
  // shows book covers well at desktop widths. Once the user picks
  // explicitly via the toolbar toggle, that choice is persisted
  // and this default no longer applies.
  if (isMobile) {
    return { ...DEFAULT_PREFS, viewMode: "list", controlsExpanded: false };
  }
  return DEFAULT_PREFS;
}

function savePrefs(prefs: LibraryPrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function loadSortOrders(): SortOrdersMap {
  try {
    const raw = localStorage.getItem(SORT_ORDERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveSortOrders(orders: SortOrdersMap) {
  localStorage.setItem(SORT_ORDERS_KEY, JSON.stringify(orders));
}

/**
 * Given saved order keys and the current set of item keys,
 * returns ordered keys: saved items that still exist (in saved order),
 * then any new items appended at end.
 */
export function applySort(savedOrder: string[] | undefined, currentKeys: string[]): string[] {
  if (!savedOrder || savedOrder.length === 0) return currentKeys;
  const currentSet = new Set(currentKeys);
  // Keep saved items that still exist
  const ordered = savedOrder.filter((k) => currentSet.has(k));
  // Append any new items not in saved order
  const orderedSet = new Set(ordered);
  for (const k of currentKeys) {
    if (!orderedSet.has(k)) ordered.push(k);
  }
  return ordered;
}

export function useLibraryPrefs() {
  const [prefs, setPrefs] = useState<LibraryPrefs>(loadPrefs);
  const [sortOrders, setSortOrdersState] = useState<SortOrdersMap>(loadSortOrders);

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setPrefs((p) => {
      const next = { ...p, viewMode };
      savePrefs(next);
      return next;
    });
  }, []);

  const setCardSize = useCallback((cardSize: number) => {
    setPrefs((p) => {
      const next = { ...p, cardSize };
      savePrefs(next);
      return next;
    });
  }, []);

  const setControlsExpanded = useCallback((controlsExpanded: boolean) => {
    setPrefs((p) => {
      const next = { ...p, controlsExpanded };
      savePrefs(next);
      return next;
    });
  }, []);

  const setSortOrder = useCallback((contextId: string, orderedKeys: string[]) => {
    setSortOrdersState((prev) => {
      const next = { ...prev, [contextId]: orderedKeys };
      saveSortOrders(next);
      return next;
    });
  }, []);

  return {
    ...prefs,
    setViewMode,
    setCardSize,
    setControlsExpanded,
    sortOrders,
    setSortOrder,
  };
}
