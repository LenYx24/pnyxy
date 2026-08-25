import { createContext, useContext } from "react";
import type { ClientRect } from "@dnd-kit/core";
import type { SortingStrategy } from "@dnd-kit/sortable";

/**
 * Explicit drop intent for the library drag & drop.
 *
 * dnd-kit only tells us which droppable the pointer is over; whether
 * the user means "put it before / after this item" (reorder) or "put it
 * inside this folder" (nest) is decided here from where the pointer
 * sits inside the target's rect, and the result drives both the visual
 * indicator (insertion line / folder highlight) and the drop handler.
 */
export type DropPosition = "before" | "after" | "inside";

export interface DropIntent {
  /** Sortable key (`folder:<id>`, `book:<id>`, ...) or a level target
   *  (`breadcrumb:<id|root>`, `parent:<id|root>`). */
  overId: string;
  position: DropPosition;
}

/** Fraction of the target's extent (height in list view, width in grid
 *  view) at each edge that counts as "reorder" when the target is a
 *  folder; the middle 50% nests. Non-folders split at the half. */
const EDGE_ZONE = 0.25;

/**
 * Compute the intent for a pointer over a sortable target.
 * `axis` is "y" for list rows (line above / below) and "x" for grid
 * cards (line left / right). Returns null when the target is the
 * dragged item itself.
 */
export function computeDropIntent(params: {
  activeId: string;
  overId: string;
  rect: ClientRect;
  pointer: { x: number; y: number } | null;
  axis: "x" | "y";
  /** Fallback when there is no pointer (keyboard sensor): sibling
   *  indices decide before / after. */
  activeIndex: number;
  overIndex: number;
}): DropIntent | null {
  const { activeId, overId, rect, pointer, axis, activeIndex, overIndex } =
    params;
  if (overId === activeId) return null;
  // level targets are always "inside"
  if (overId.startsWith("breadcrumb:") || overId.startsWith("parent:")) {
    return { overId, position: "inside" };
  }
  const isFolder = overId.startsWith("folder:");
  if (!pointer) {
    return { overId, position: activeIndex < overIndex ? "after" : "before" };
  }
  const start = axis === "y" ? rect.top : rect.left;
  const size = axis === "y" ? rect.height : rect.width;
  const along = axis === "y" ? pointer.y : pointer.x;
  const rel = size > 0 ? Math.min(1, Math.max(0, (along - start) / size)) : 0.5;
  if (isFolder) {
    if (rel < EDGE_ZONE) return { overId, position: "before" };
    if (rel > 1 - EDGE_ZONE) return { overId, position: "after" };
    return { overId, position: "inside" };
  }
  return { overId, position: rel < 0.5 ? "before" : "after" };
}

/** Sortable strategy that never displaces siblings: the insertion line
 *  is the only reorder feedback, so rows do not slide around under the
 *  ghost and the pointer zones stay where they were measured. */
export const noShiftStrategy: SortingStrategy = () => null;

const DropIntentContext = createContext<DropIntent | null>(null);
export const DropIntentProvider = DropIntentContext.Provider;

/** The drop position for one sortable / droppable id, or null when the
 *  drag is not targeting it. */
export function useDropIntent(id: string | undefined): DropPosition | null {
  const intent = useContext(DropIntentContext);
  if (!intent || !id || intent.overId !== id) return null;
  return intent.position;
}

/** Folder highlight while an item would nest into it. */
export const NEST_TARGET_CLASS =
  "bg-accent-soft ring-2 ring-inset ring-accent-soft";
