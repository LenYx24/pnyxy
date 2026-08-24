import { useCallback, useState } from "react";
import {
  Menu,
  ArrowLeft,
  Type,
  FileText,
  ZoomIn,
  BotMessageSquare,
  Undo2,
  Pencil,
  PenTool,
  MessageSquare,
  BookOpen,
  Timer,
  Focus,
  Search,
  BookmarkPlus,
  Highlighter,
  Palette,
  RotateCw,
  Moon,
  AlignLeft,
  Camera,
  SquareDashedMousePointer,
  ImagePlus,
  Printer,
  FileDown,
  PanelLeft,
  Maximize,
  type LucideIcon,
} from "lucide-react";

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
    "cropToAi",
    "separator:def-4",
    "search",
    "bookmark",
    "comments",
    "night",
    "separator:def-5",
    "readingTracker",
    "focusTimer",
    "zen",
  ],
  // Only the genuinely rarely-used actions live here; the common ones
  // (search, bookmark, crop-to-AI, night mode) were promoted to the bar,
  // and the highlight-export buttons were dropped from the reader entirely.
  overflow: [
    "highlight",
    "theme",
    "rotate",
    "reflow",
    "screenshot",
    "screenshotArea",
    "print",
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
    // ignore, fall back to default
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

// --- Toolbar dimensions (height + vertical icon padding) ---
// Kept deliberately narrow so the bar can't get silly-tall. Default is a
// compact bar with near-zero padding above/below the icons.
export interface ToolbarStyle {
  height: number; // px, the toolbar row height
  paddingY: number; // px, padding above & below each icon
}

const STYLE_KEY = "pnyxy-reader-toolbar-style";
export const TOOLBAR_HEIGHT_MIN = 28;
export const TOOLBAR_HEIGHT_MAX = 48;
export const TOOLBAR_PADY_MIN = 0;
export const TOOLBAR_PADY_MAX = 8;
export const DEFAULT_TOOLBAR_STYLE: ToolbarStyle = { height: 36, paddingY: 1 };

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function loadStyle(): ToolbarStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ToolbarStyle>;
      return {
        height: clampInt(
          p.height ?? DEFAULT_TOOLBAR_STYLE.height,
          TOOLBAR_HEIGHT_MIN,
          TOOLBAR_HEIGHT_MAX,
        ),
        paddingY: clampInt(
          p.paddingY ?? DEFAULT_TOOLBAR_STYLE.paddingY,
          TOOLBAR_PADY_MIN,
          TOOLBAR_PADY_MAX,
        ),
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_TOOLBAR_STYLE };
}

export function useToolbarStyle() {
  const [style, setStyleState] = useState<ToolbarStyle>(loadStyle);

  const update = useCallback((patch: Partial<ToolbarStyle>) => {
    setStyleState((prev) => {
      const next: ToolbarStyle = {
        height: clampInt(
          patch.height ?? prev.height,
          TOOLBAR_HEIGHT_MIN,
          TOOLBAR_HEIGHT_MAX,
        ),
        paddingY: clampInt(
          patch.paddingY ?? prev.paddingY,
          TOOLBAR_PADY_MIN,
          TOOLBAR_PADY_MAX,
        ),
      };
      try {
        localStorage.setItem(STYLE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return { style, setStyle: update };
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

// Static icon + label for every item, used by the drag-and-drop toolbar
// editor to render chips/palette without wiring up each item's live
// handlers (those stay in ReaderToolbar's registry). Label is an i18n key
// with a fallback.
export interface ToolbarItemMeta {
  icon: LucideIcon;
  labelKey: string;
  labelDefault: string;
}

export const TOOLBAR_ITEM_META: Record<string, ToolbarItemMeta> = {
  menu: { icon: Menu, labelKey: "reader.toolbar.toggleAppSidebar", labelDefault: "App menu" },
  back: { icon: ArrowLeft, labelKey: "reader.toolbar.backToLibrary", labelDefault: "Back to library" },
  title: { icon: Type, labelKey: "reader.toolbar.bookTitle", labelDefault: "Book title" },
  pageNav: { icon: FileText, labelKey: "reader.toolbar.pageNav", labelDefault: "Page navigation" },
  zoom: { icon: ZoomIn, labelKey: "reader.toolbar.zoom", labelDefault: "Zoom" },
  aiChat: { icon: BotMessageSquare, labelKey: "reader.toolbar.aiChatTitle", labelDefault: "AI chat" },
  undo: { icon: Undo2, labelKey: "reader.toolbar.undoTitle", labelDefault: "Undo" },
  inPageDraw: { icon: Pencil, labelKey: "reader.toolbar.inlineDrawOn", labelDefault: "Quick draw" },
  whiteboardDraw: { icon: PenTool, labelKey: "reader.toolbar.draw", labelDefault: "Draw on page" },
  comments: { icon: MessageSquare, labelKey: "reader.toolbar.commentsTitle", labelDefault: "Comments" },
  readingTracker: { icon: BookOpen, labelKey: "reader.toolbar.readingTracker", labelDefault: "Reading tracker" },
  focusTimer: { icon: Timer, labelKey: "reader.toolbar.focusTimer", labelDefault: "Focus timer" },
  zen: { icon: Focus, labelKey: "reader.toolbar.zenMode", labelDefault: "Zen mode" },
  search: { icon: Search, labelKey: "reader.toolbar.search", labelDefault: "Search" },
  bookmark: { icon: BookmarkPlus, labelKey: "reader.toolbar.bookmarkPage", labelDefault: "Bookmark" },
  highlight: { icon: Highlighter, labelKey: "reader.toolbar.highlight", labelDefault: "Highlight" },
  theme: { icon: Palette, labelKey: "reader.toolbar.readerThemeShort", labelDefault: "Theme" },
  rotate: { icon: RotateCw, labelKey: "reader.toolbar.rotate", labelDefault: "Rotate" },
  night: { icon: Moon, labelKey: "reader.toolbar.nightModeOn", labelDefault: "Night mode" },
  reflow: { icon: AlignLeft, labelKey: "reader.toolbar.reflowOn", labelDefault: "Reflow" },
  screenshot: { icon: Camera, labelKey: "reader.toolbar.screenshotTitle", labelDefault: "Screenshot" },
  screenshotArea: { icon: SquareDashedMousePointer, labelKey: "reader.toolbar.screenshotAreaTitle", labelDefault: "Screenshot area" },
  cropToAi: { icon: ImagePlus, labelKey: "reader.toolbar.rectToAi", labelDefault: "Crop to AI" },
  print: { icon: Printer, labelKey: "reader.toolbar.printTitle", labelDefault: "Print" },
  exportMd: { icon: FileDown, labelKey: "reader.toolbar.exportHighlightsMarkdown", labelDefault: "Export highlights (MD)" },
  exportJson: { icon: FileDown, labelKey: "reader.toolbar.exportHighlightsJson", labelDefault: "Export highlights (JSON)" },
  sidebar: { icon: PanelLeft, labelKey: "reader.toolbar.toggleSidebar", labelDefault: "Toggle sidebar" },
  fullscreen: { icon: Maximize, labelKey: "reader.toolbar.fullscreen", labelDefault: "Fullscreen" },
};
