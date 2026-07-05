import { create } from "zustand";

/**
 * "Dumbed down" inline draw, a lightweight doodle overlay on top of
 * the reader's existing PDF page layout. The full whiteboard mode
 * (which swaps the viewer for a Tldraw canvas) is still there for
 * heavy use; this is the "I just want to circle something quickly"
 * pen.
 *
 * Design choices that keep this small on purpose:
 *   - SVG strokes, not raster, crisp at every zoom level, easy to
 *     undo / clear, easy to persist as JSON.
 *   - Coordinates are NORMALIZED to the page (0..1 along x, 0..1
 *     along y) so the same stroke draws correctly at any zoom level
 *     and any per-slot CSS scale. Avoids the "drew at 100 %, panned
 *     to 200 %, marks now drift" problem.
 *   - localStorage persistence keyed by (book, page). Per-device,
 *     no DB migration. v1 trade-off; cloud-sync is a follow-up.
 *   - No size picker, no eraser. Three colours, undo, clear page,
 *     exit. That's it.
 */

export interface Stroke {
  /** Hex with optional alpha. */
  color: string;
  /** Px at 1× zoom, applied via stroke-width on the SVG. */
  width: number;
  /** Normalised 0..1 coordinates relative to the page's natural box. */
  points: { x: number; y: number }[];
}

const STORAGE_PREFIX = "pnyxy:inline-draw:v1:";
const STORAGE_VERSION_KEY = `${STORAGE_PREFIX}__index`;

function storageKey(bookId: string): string {
  return `${STORAGE_PREFIX}${bookId}`;
}

function loadFromStorage(bookId: string): Map<number, Stroke[]> {
  try {
    const raw = localStorage.getItem(storageKey(bookId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Stroke[]>;
    const out = new Map<number, Stroke[]>();
    for (const [k, v] of Object.entries(parsed)) {
      const page = Number(k);
      if (Number.isFinite(page) && Array.isArray(v)) out.set(page, v);
    }
    return out;
  } catch {
    return new Map();
  }
}

function saveToStorage(bookId: string, drawings: Map<number, Stroke[]>) {
  try {
    const obj: Record<string, Stroke[]> = {};
    for (const [page, strokes] of drawings) {
      if (strokes.length > 0) obj[String(page)] = strokes;
    }
    if (Object.keys(obj).length === 0) {
      localStorage.removeItem(storageKey(bookId));
    } else {
      localStorage.setItem(storageKey(bookId), JSON.stringify(obj));
    }
    // Maintain a small index so future cleanup / migration knows
    // which keys exist without scanning all of localStorage.
    const idxRaw = localStorage.getItem(STORAGE_VERSION_KEY);
    const idx = new Set<string>(idxRaw ? (JSON.parse(idxRaw) as string[]) : []);
    if (Object.keys(obj).length === 0) idx.delete(bookId);
    else idx.add(bookId);
    localStorage.setItem(STORAGE_VERSION_KEY, JSON.stringify([...idx]));
  } catch {
    // quota / private mode, strokes stay in memory for the session
  }
}

export const INLINE_DRAW_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
] as const;

export const INLINE_DRAW_STROKE_WIDTH = 2.5;

/** Pen mode draws new strokes; eraser mode lets the user tap an
 *  existing stroke to delete just that one. The toolbar exposes a
 *  toggle for it so users have a precise way to clean up parts of
 *  their doodles without losing the rest of the page. */
export type InlineDrawTool = "pen" | "eraser";

interface InlineDrawState {
  active: boolean;
  /** Currently selected colour (hex). */
  color: string;
  /** Pen vs eraser. */
  tool: InlineDrawTool;
  /** Current book scope. Switching books clears in-memory state. */
  currentBookId: string | null;
  /** Page → strokes for the active book. Persisted to localStorage on
   *  every commit. */
  drawingsByPage: Map<number, Stroke[]>;
  setActive: (active: boolean) => void;
  toggleActive: () => void;
  setColor: (color: string) => void;
  setTool: (tool: InlineDrawTool) => void;
  /** Switch the active book, loads its drawings from localStorage,
   *  no-op if it's already the current book. */
  setBook: (bookId: string | null) => void;
  /** Commit a finished stroke to a page (called on pointer-up). */
  addStroke: (page: number, stroke: Stroke) => void;
  /** Pop the last stroke on a page. Returns true if anything was
   *  removed (useful so the toolbar can disable the button). */
  undoStrokeOnPage: (page: number) => boolean;
  /** Delete a specific stroke (by index) on a page, used by the
   *  eraser tool when the user taps a stroke. */
  removeStrokeOnPage: (page: number, strokeIndex: number) => void;
  /** Wipe strokes on a single page. */
  clearPage: (page: number) => void;
  /** Wipe all strokes across every page for the active book, used
   *  when the user wants a clean slate without flipping through each
   *  page to clear them individually. */
  clearAllPages: () => void;
  /** Read-side helper, returns a stable ref-equal array per render
   *  when the page hasn't changed. */
  strokesForPage: (page: number) => Stroke[];
  /** Total stroke count for the active book, drives the toolbar's
   *  disabled state for the "Clear all" button. */
  totalStrokes: () => number;
}

const EMPTY: Stroke[] = [];

export const useInlineDrawStore = create<InlineDrawState>((set, get) => ({
  active: false,
  color: INLINE_DRAW_COLORS[0],
  tool: "pen",
  currentBookId: null,
  drawingsByPage: new Map(),

  // Leaving draw mode also resets the tool back to pen so the user
  // doesn't re-enter mid-erase the next time they open the palette.
  setActive: (active) => set(active ? { active } : { active, tool: "pen" }),
  toggleActive: () =>
    set((s) => (s.active ? { active: false, tool: "pen" } : { active: true })),
  setColor: (color) => set({ color }),
  setTool: (tool) => set({ tool }),

  setBook: (bookId) => {
    if (get().currentBookId === bookId) return;
    if (!bookId) {
      set({ currentBookId: null, drawingsByPage: new Map() });
      return;
    }
    set({
      currentBookId: bookId,
      drawingsByPage: loadFromStorage(bookId),
    });
  },

  addStroke: (page, stroke) => {
    const { drawingsByPage, currentBookId } = get();
    const next = new Map(drawingsByPage);
    const existing = next.get(page) ?? [];
    next.set(page, [...existing, stroke]);
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  undoStrokeOnPage: (page) => {
    const { drawingsByPage, currentBookId } = get();
    const existing = drawingsByPage.get(page);
    if (!existing || existing.length === 0) return false;
    const next = new Map(drawingsByPage);
    next.set(page, existing.slice(0, -1));
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
    return true;
  },

  removeStrokeOnPage: (page, strokeIndex) => {
    const { drawingsByPage, currentBookId } = get();
    const existing = drawingsByPage.get(page);
    if (!existing || strokeIndex < 0 || strokeIndex >= existing.length) return;
    const remaining = existing.filter((_, i) => i !== strokeIndex);
    const next = new Map(drawingsByPage);
    if (remaining.length === 0) next.delete(page);
    else next.set(page, remaining);
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  clearPage: (page) => {
    const { drawingsByPage, currentBookId } = get();
    if (!drawingsByPage.has(page)) return;
    const next = new Map(drawingsByPage);
    next.delete(page);
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  clearAllPages: () => {
    const { drawingsByPage, currentBookId } = get();
    if (drawingsByPage.size === 0) return;
    const next = new Map<number, Stroke[]>();
    set({ drawingsByPage: next });
    if (currentBookId) saveToStorage(currentBookId, next);
  },

  strokesForPage: (page) => get().drawingsByPage.get(page) ?? EMPTY,

  totalStrokes: () => {
    let n = 0;
    for (const strokes of get().drawingsByPage.values()) n += strokes.length;
    return n;
  },
}));
