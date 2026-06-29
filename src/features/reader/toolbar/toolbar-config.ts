import { useCallback, useState } from "react";

// The reader toolbar is rendered from this layout config so the user
// can rearrange it (Phase B). A zone is one of the four drop targets;
// each holds an ordered list of slot ids. A slot id is either a
// registered item id (e.g. "undo", "zoom") or a separator instance
// ("separator:<n>"). The registry of what each item *is* lives in
// ReaderToolbar (it needs the component's handlers/hooks).

export type ToolbarZone = "left" | "center" | "right" | "overflow";
export const TOOLBAR_ZONES: ToolbarZone[] = [
  "left",
  "center",
  "right",
  "overflow",
];

export type ToolbarLayout = Record<ToolbarZone, string[]>;

const STORAGE_KEY = "pnyxy-reader-toolbar-layout";
const SEP_PREFIX = "separator:";

export function isSeparator(id: string): boolean {
  return id.startsWith(SEP_PREFIX);
}

let sepCounter = 0;
export function newSeparatorId(): string {
  sepCounter += 1;
  return `${SEP_PREFIX}${sepCounter}-${Math.round(Math.random() * 1e6)}`;
}

// Default = the Phase A arrangement, with the inline dividers expressed
// as separator slots. Keep ids in sync with the registry in
// ReaderToolbar.
export const DEFAULT_LAYOUT: ToolbarLayout = {
  left: ["menu", "back", "title", "separator:def-1", "pageNav"],
  center: ["zoom", "separator:def-2", "aiChat"],
  right: [
    "undo",
    "separator:def-3",
    "inPageDraw",
    "whiteboardDraw",
    "separator:def-4",
    "comments",
    "separator:def-5",
    "readingTracker",
    "focusTimer",
    "zen",
  ],
  overflow: [
    "search",
    "bookmark",
    "highlight",
    "theme",
    "rotate",
    "night",
    "reflow",
    "screenshot",
    "screenshotArea",
    "cropToAi",
    "print",
    "exportMd",
    "exportJson",
    "sidebar",
    "fullscreen",
  ],
};

export function cloneDefaultLayout(): ToolbarLayout {
  return {
    left: [...DEFAULT_LAYOUT.left],
    center: [...DEFAULT_LAYOUT.center],
    right: [...DEFAULT_LAYOUT.right],
    overflow: [...DEFAULT_LAYOUT.overflow],
  };
}

function loadLayout(): ToolbarLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ToolbarLayout>;
      if (
        Array.isArray(parsed.left) &&
        Array.isArray(parsed.center) &&
        Array.isArray(parsed.right) &&
        Array.isArray(parsed.overflow)
      ) {
        return {
          left: parsed.left,
          center: parsed.center,
          right: parsed.right,
          overflow: parsed.overflow,
        };
      }
    }
  } catch {
    // ignore — fall back to default
  }
  return cloneDefaultLayout();
}

export function saveLayout(layout: ToolbarLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore (private mode / quota)
  }
}

export function useToolbarLayout() {
  const [layout, setLayoutState] = useState<ToolbarLayout>(loadLayout);

  const setLayout = useCallback((next: ToolbarLayout) => {
    setLayoutState(next);
    saveLayout(next);
  }, []);

  const resetLayout = useCallback(() => {
    const fresh = cloneDefaultLayout();
    setLayoutState(fresh);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { layout, setLayout, resetLayout };
}

// Every known item id, used to (a) validate a persisted layout and
// (b) populate the "all icons" palette in edit mode. The registry in
// ReaderToolbar maps each to a concrete render + handler.
export const ALL_ITEM_IDS = [
  "menu",
  "back",
  "title",
  "pageNav",
  "zoom",
  "aiChat",
  "undo",
  "inPageDraw",
  "whiteboardDraw",
  "comments",
  "readingTracker",
  "focusTimer",
  "zen",
  "search",
  "bookmark",
  "highlight",
  "theme",
  "rotate",
  "night",
  "reflow",
  "screenshot",
  "screenshotArea",
  "cropToAi",
  "print",
  "exportMd",
  "exportJson",
  "sidebar",
  "fullscreen",
] as const;

export type ToolbarItemId = (typeof ALL_ITEM_IDS)[number];
