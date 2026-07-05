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
  cardSize: number; // 140-320, grid minWidth in px
  // default is platform-aware (mobile collapsed, desktop expanded) until user toggles
  controlsExpanded: boolean;
  listColumnWidths: ListColumnWidths;
}

// keys are "folder:<id>" or "book:<id>"
type SortOrdersMap = Record<string, string[]>;

export const DEFAULT_LIST_COLUMN_WIDTHS: ListColumnWidths = {
  author: 128,
  size: 64,
  added: 80,
};

const DEFAULT_CARD_SIZE = 150;
// stored 200 is treated as unset and migrated to the current default
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
      // fall back to platform default when unset
      const controlsExpanded =
        parsed.controlsExpanded ?? (isMobile ? false : true);
      // merge so newly-added columns pick up defaults
      const listColumnWidths = {
        ...DEFAULT_LIST_COLUMN_WIDTHS,
        ...(parsed.listColumnWidths ?? {}),
      };
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
  // mobile defaults to list, desktop to grid
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

/** Order currentKeys by savedOrder, appending unseen keys at the end. */
export function applySort(savedOrder: string[] | undefined, currentKeys: string[]): string[] {
  if (!savedOrder || savedOrder.length === 0) return currentKeys;
  const currentSet = new Set(currentKeys);
  const ordered = savedOrder.filter((k) => currentSet.has(k));
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
