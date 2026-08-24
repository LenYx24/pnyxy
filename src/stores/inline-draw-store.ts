import { create } from "zustand";

/**
 * Inline draw: a lightweight vector doodle layer on top of the reader's
 * existing PDF page layout. The full Whiteboard mode is still there for
 * heavy use; this is the "annotate the page in place" tool.
 *
 * It now supports the core whiteboard tool-set, freehand pen, shapes
 * (rectangle, ellipse, line, arrow), an eraser, and a select tool that
 * moves/resizes/deletes placed elements, plus adjustable stroke width
 * and a colour palette.
 *
 * Design choices kept from v1:
 *   - SVG vector elements, not raster: crisp at every zoom, trivial to
 *     undo / persist as JSON.
 *   - Coordinates are NORMALISED to the page (0..1 on each axis) so the
 *     same drawing renders correctly at any zoom / CSS scale.
 *   - localStorage persistence keyed by (book, page). Per-device, no DB
 *     migration. Cloud-sync remains a follow-up.
 */

export interface Pt {
  x: number;
  y: number;
}

interface ElementBase {
  id: string;
  /** Hex with optional alpha. */
  color: string;
  /** Px at 1× zoom (non-scaling-stroke keeps it constant on screen). */
  width: number;
}

export type InlineElement =
  | (ElementBase & { type: "pen"; points: Pt[] })
  | (ElementBase & { type: "rectangle"; x: number; y: number; w: number; h: number })
  | (ElementBase & { type: "ellipse"; cx: number; cy: number; rx: number; ry: number })
  | (ElementBase & { type: "line"; x1: number; y1: number; x2: number; y2: number })
  | (ElementBase & { type: "arrow"; x1: number; y1: number; x2: number; y2: number });

/** Legacy v1 stroke: a pen with no `type`/`id`. Kept for migration. */
interface LegacyStroke {
  color: string;
  width: number;
  points: Pt[];
}

const STORAGE_PREFIX = "pnyxy:inline-draw:v1:";
const STORAGE_VERSION_KEY = `${STORAGE_PREFIX}__index`;

function storageKey(bookId: string): string {
  return `${STORAGE_PREFIX}${bookId}`;
}

export function makeId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Coerce a stored item into an InlineElement, migrating legacy strokes
 *  (no `type`) into pen elements and back-filling ids. */
function normalizeElement(raw: unknown): InlineElement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const base = {
    id: typeof o.id === "string" ? o.id : makeId(),
    color: typeof o.color === "string" ? o.color : "#ef4444",
    width: typeof o.width === "number" ? o.width : INLINE_DRAW_DEFAULT_WIDTH,
  };
  const type = o.type;
  if (type === undefined || type === "pen") {
    const pts = (raw as LegacyStroke).points;
    if (!Array.isArray(pts)) return null;
    return { ...base, type: "pen", points: pts };
  }
  if (type === "rectangle" || type === "ellipse" || type === "line" || type === "arrow") {
    return { ...base, ...(o as object), type } as InlineElement;
  }
  return null;
}

function loadFromStorage(bookId: string): Map<number, InlineElement[]> {
  try {
    const raw = localStorage.getItem(storageKey(bookId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown[]>;
    const out = new Map<number, InlineElement[]>();
    for (const [k, v] of Object.entries(parsed)) {
      const page = Number(k);
      if (!Number.isFinite(page) || !Array.isArray(v)) continue;
      const els = v.map(normalizeElement).filter((e): e is InlineElement => !!e);
      if (els.length > 0) out.set(page, els);
    }
    return out;
  } catch {
    return new Map();
  }
}

function saveToStorage(bookId: string, drawings: Map<number, InlineElement[]>) {
  try {
    const obj: Record<string, InlineElement[]> = {};
    for (const [page, els] of drawings) {
      if (els.length > 0) obj[String(page)] = els;
    }
    if (Object.keys(obj).length === 0) {
      localStorage.removeItem(storageKey(bookId));
    } else {
      localStorage.setItem(storageKey(bookId), JSON.stringify(obj));
    }
    const idxRaw = localStorage.getItem(STORAGE_VERSION_KEY);
    const idx = new Set<string>(idxRaw ? (JSON.parse(idxRaw) as string[]) : []);
    if (Object.keys(obj).length === 0) idx.delete(bookId);
    else idx.add(bookId);
    localStorage.setItem(STORAGE_VERSION_KEY, JSON.stringify([...idx]));
  } catch {
    // quota / private mode, elements stay in memory for the session
  }
}

export const INLINE_DRAW_COLORS = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#1f2937", // slate-ink (reads on white pages)
] as const;

export const INLINE_DRAW_WIDTHS = [1.5, 2.5, 4, 6] as const;
export const INLINE_DRAW_DEFAULT_WIDTH = 2.5;

export type InlineDrawTool =
  | "select"
  | "pen"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "eraser";

interface InlineDrawState {
  active: boolean;
  color: string;
  width: number;
  tool: InlineDrawTool;
  /** Selected element id (select tool). Selection is global; only one
   *  element is selected at a time, on whichever page it lives. */
  selectedId: string | null;
  currentBookId: string | null;
  drawingsByPage: Map<number, InlineElement[]>;

  setActive: (active: boolean) => void;
  toggleActive: () => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  setTool: (tool: InlineDrawTool) => void;
  select: (id: string | null) => void;
  setBook: (bookId: string | null) => void;

  addElement: (page: number, el: InlineElement) => void;
  updateElement: (page: number, id: string, next: InlineElement) => void;
  removeElement: (page: number, id: string) => void;
  /** Remove the currently selected element wherever it lives. */
  removeSelected: () => void;
  undoOnPage: (page: number) => boolean;
  clearPage: (page: number) => void;
  clearAllPages: () => void;

  elementsForPage: (page: number) => InlineElement[];
  totalElements: () => number;
}

const EMPTY: InlineElement[] = [];

export const useInlineDrawStore = create<InlineDrawState>((set, get) => ({
  active: false,
  color: INLINE_DRAW_COLORS[0],
  width: INLINE_DRAW_DEFAULT_WIDTH,
  tool: "pen",
  selectedId: null,
  currentBookId: null,
  drawingsByPage: new Map(),

  setActive: (active) =>
    set(active ? { active } : { active, tool: "pen", selectedId: null }),
  toggleActive: () =>
    set((s) =>
      s.active
        ? { active: false, tool: "pen", selectedId: null }
        : { active: true },
    ),
  setColor: (color) => {
    const { tool, selectedId, currentBookId, drawingsByPage } = get();
    set({ color });
    // Recolour the selected element live when the select tool is active.
    if (tool === "select" && selectedId) {
      const next = mapElement(drawingsByPage, selectedId, (el) => ({ ...el, color }));
      if (next) {
        set({ drawingsByPage: next });
        if (currentBookId) saveToStorage(currentBookId, next);
      }
    }
  },
  setWidth: (width) => {
    const { tool, selectedId, currentBookId, drawingsByPage } = get();
    set({ width });
    if (tool === "select" && selectedId) {
      const next = mapElement(drawingsByPage, selectedId, (el) => ({ ...el, width }));
      if (next) {
        set({ drawingsByPage: next });
        if (currentBookId) saveToStorage(currentBookId, next);
      }
    }
  },
  setTool: (tool) =>
    set(tool === "select" ? { tool } : { tool, selectedId: null }),
  select: (id) => set({ selectedId: id }),

  setBook: (bookId) => {
    if (get().currentBookId === bookId) return;
    if (!bookId) {
      set({ currentBookId: null, drawingsByPage: new Map(), selectedId: null });
      return;
    }
    set({
      currentBookId: bookId,
      drawingsByPage: loadFromStorage(bookId),
      selectedId: null,
    });
  },

  addElement: (page, el) => {
    const { drawingsByPage, currentBookId } = get();
    const next = new Map(drawingsByPage);
    next.set(page, [...(next.get(page) ?? []), el]);
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  updateElement: (page, id, updated) => {
    const { drawingsByPage, currentBookId } = get();
    const existing = drawingsByPage.get(page);
    if (!existing) return;
    const next = new Map(drawingsByPage);
    next.set(page, existing.map((e) => (e.id === id ? updated : e)));
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  removeElement: (page, id) => {
    const { drawingsByPage, currentBookId, selectedId } = get();
    const existing = drawingsByPage.get(page);
    if (!existing) return;
    const remaining = existing.filter((e) => e.id !== id);
    const next = new Map(drawingsByPage);
    if (remaining.length === 0) next.delete(page);
    else next.set(page, remaining);
    set({
      drawingsByPage: next,
      selectedId: selectedId === id ? null : selectedId,
    });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  removeSelected: () => {
    const { selectedId, drawingsByPage, currentBookId } = get();
    if (!selectedId) return;
    for (const [page, els] of drawingsByPage) {
      if (!els.some((e) => e.id === selectedId)) continue;
      const remaining = els.filter((e) => e.id !== selectedId);
      const next = new Map(drawingsByPage);
      if (remaining.length === 0) next.delete(page);
      else next.set(page, remaining);
      set({ drawingsByPage: next, selectedId: null });
      if (currentBookId) saveToStorage(currentBookId, next);
      return;
    }
    set({ selectedId: null });
  },

  undoOnPage: (page) => {
    const { drawingsByPage, currentBookId } = get();
    const existing = drawingsByPage.get(page);
    if (!existing || existing.length === 0) return false;
    const next = new Map(drawingsByPage);
    const removed = existing[existing.length - 1];
    if (existing.length === 1) next.delete(page);
    else next.set(page, existing.slice(0, -1));
    set((s) => ({
      drawingsByPage: next,
      selectedId: s.selectedId === removed.id ? null : s.selectedId,
    }));
    if (currentBookId) saveToStorage(currentBookId, next);
    return true;
  },

  clearPage: (page) => {
    const { drawingsByPage, currentBookId } = get();
    if (!drawingsByPage.has(page)) return;
    const next = new Map(drawingsByPage);
    next.delete(page);
    set({ drawingsByPage: next, selectedId: null });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  clearAllPages: () => {
    const { drawingsByPage, currentBookId } = get();
    if (drawingsByPage.size === 0) return;
    const next = new Map<number, InlineElement[]>();
    set({ drawingsByPage: next, selectedId: null });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  elementsForPage: (page) => get().drawingsByPage.get(page) ?? EMPTY,

  totalElements: () => {
    let n = 0;
    for (const els of get().drawingsByPage.values()) n += els.length;
    return n;
  },
}));

/** Apply `fn` to the element with `id` wherever it lives; returns a new
 *  page map, or null if not found. */
function mapElement(
  drawings: Map<number, InlineElement[]>,
  id: string,
  fn: (el: InlineElement) => InlineElement,
): Map<number, InlineElement[]> | null {
  for (const [page, els] of drawings) {
    const idx = els.findIndex((e) => e.id === id);
    if (idx === -1) continue;
    const next = new Map(drawings);
    next.set(page, els.map((e) => (e.id === id ? fn(e) : e)));
    return next;
  }
  return null;
}
