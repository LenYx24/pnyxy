import { useLayoutEffect, useRef } from "react";
import { useDndContext } from "@dnd-kit/core";
import { cn } from "@/lib/cn";
import type { ViewMode } from "./useLibraryPrefs";

/**
 * DragOverlay body for the library. Instead of re-drawing a
 * per-entity approximation of the card / row, it clones the DOM of
 * the element being dragged (dnd-kit's `activeNode`), so the ghost is
 * pixel-identical to its source in both views: the same BookRow /
 * FolderRow / EntityRow in list view, the same LibraryBookCard /
 * FolderCard / EntityCard in grid view. The width comes from the
 * source's initial rect so list rows keep their full width.
 *
 * The clone is inert (pointer-events none, no React handlers), it only
 * exists for the duration of the drag; the source keeps its placeholder
 * state (opacity-40) from the `isDragging` class in the components.
 */
export function DragGhost({ viewMode }: { viewMode: ViewMode }) {
  const { active, activeNode } = useDndContext();
  const hostRef = useRef<HTMLDivElement>(null);
  const activeId = active?.id ?? null;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !activeNode) return;
    const clone = activeNode.cloneNode(true) as HTMLElement;
    // The source is mid-drag when we clone it: strip its placeholder
    // opacity and the lazy-render hints so the ghost paints in full.
    clone.style.transform = "";
    clone.style.transition = "";
    clone.style.contentVisibility = "";
    clone.style.containIntrinsicSize = "";
    clone.style.opacity = "";
    clone.querySelectorAll<HTMLElement>('[class*="opacity-"]').forEach((el) => {
      el.classList.remove("opacity-40", "opacity-50");
    });
    clone.classList.remove("opacity-40", "opacity-50");
    // list rows carry the 1 px separator; the floating ghost should not
    clone.querySelectorAll<HTMLElement>(".border-b").forEach((el) => {
      el.classList.remove("border-b");
    });
    host.replaceChildren(clone);
    return () => {
      host.replaceChildren();
    };
  }, [activeId, activeNode]);

  if (!active) return null;
  const width = active.rect.current.initial?.width;

  return (
    <div
      ref={hostRef}
      style={width ? { width } : undefined}
      className={cn(
        "pointer-events-none opacity-90 shadow-page",
        viewMode === "list" && "overflow-hidden rounded-md bg-bg-secondary",
        viewMode === "grid" && "rounded-md",
      )}
    />
  );
}
