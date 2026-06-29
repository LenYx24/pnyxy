import { useState, useCallback } from "react";

export type ViewMode = "grid" | "list";

const STORAGE_KEY = "pnyxy-library-prefs";
const SORT_ORDERS_KEY = "pnyxy-library-sort-orders";

export interface ListColumnWidths {
  author: number;
  size: number;
  added: number;
}

interface LibraryPrefs {
  viewMode: ViewMode;
  cardSize: number; // 140–320, grid minWidth in px
  // Whether the search box + tag filter row are visible. Toolbar
  // exposes a chevron toggle. Default is platform-aware (mobile
  // collapsed, desktop expanded) but the user's explicit pick is
  // persisted from then on.
  controlsExpanded: boolean;
  // List-view column widths in pixels. Defaults mirror the original
  // hard-coded w-32 / w-16 / w-20 tailwind values; resize handles in
  // the column header let the user tune them per-column.
  listColumnWidths: ListColumnWidths;
}

// Map of folder context → ordered item keys
// Keys are "folder:<id>" or "book:<id>" strings
type SortOrdersMap = Record<string, string[]>;

export const DEFAULT_LIST_COLUMN_WIDTHS: ListColumnWidths = {
  author: 128,
  size: 64,
  added: 80,
};

// Compact, Nextcloud-style tiles by default — the old 200px tiles read
// as oversized for a file-manager grid. 150 keeps covers legible while
// fitting more per row; the size slider still spans 140–320.
const DEFAULT_CARD_SIZE = 150;
// The previous default. Clients that never touched the size slider have
// this value baked into their persisted prefs (savePrefs writes the
// whole object), so we treat a stored 200 as "unset" and nudge it to
// the new default — without stomping a size the user deliberately set.
const LEGACY_CARD_SIZE = 200;

const DEFAULT_PREFS: LibraryPrefs = {
  viewMode: "grid",
  cardSize: DEFAULT_CARD_SIZE,
  controlsExpanded: true,
  listColumnWidths: DEFAULT_LIST_COLUMN_WIDTHS,
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
      // Merge column widths so newly-added columns get defaults when
      // older clients have only some keys persisted.
      const listColumnWidths = {
        ...DEFAULT_LIST_COLUMN_WIDTHS,
        ...(parsed.listColumnWidths ?? {}),
      };
      // Migrate the legacy 200px default down to the new compact one.
      const cardSize =
        parsed.cardSize == null || parsed.cardSize === LEGACY_CARD_SIZE
          ? DEFAULT_CARD_SIZE
          : parsed.cardSize;
      return {
        ...DEFAULT_PREFS,
        ...parsed,
        controlsExpanded,
        listColumnWidths,
        cardSize,
      };
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

  const setListColumnWidth = useCallback(
    (key: keyof ListColumnWidths, width: number) => {
      setPrefs((p) => {
        const next = {
          ...p,
          listColumnWidths: { ...p.listColumnWidths, [key]: width },
        };
        savePrefs(next);
        return next;
      });
    },
    [],
  );

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
    setListColumnWidth,
    sortOrders,
    setSortOrder,
  };
}
