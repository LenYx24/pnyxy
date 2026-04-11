import { useEffect } from "react";
import { useAnnotationStore } from "@/stores/annotation-store";
import type { PageRect, TextSelection } from "@/types/annotation";

function getSelectionData(): { selection: TextSelection; rects: PageRect[] } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range = sel.getRangeAt(0);

  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!ancestor?.closest(".react-pdf__Page__textContent")) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  const clientRects = range.getClientRects();
  if (!clientRects.length) return null;

  const rects: PageRect[] = [];

  for (let i = 0; i < clientRects.length; i++) {
    const rect = clientRects[i];
    if (rect.width < 1 || rect.height < 1) continue;

    const el = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const pageEl = el?.closest("[data-page-number]") as HTMLElement | null;
    if (!pageEl) continue;

    const pageNum = parseInt(pageEl.dataset.pageNumber || "0", 10);
    if (!pageNum) continue;

    const pageBounds = pageEl.getBoundingClientRect();

    rects.push({
      pageNum,
      x: (rect.left - pageBounds.left) / pageBounds.width,
      y: (rect.top - pageBounds.top) / pageBounds.height,
      width: rect.width / pageBounds.width,
      height: rect.height / pageBounds.height,
    });
  }

  if (rects.length === 0) return null;

  return { selection: { text, rects }, rects };
}

/**
 * Find the highlight ID under a given point using coordinate-based hit testing.
 * Checks the annotation store's highlight rects against the point position
 * relative to the PDF page, since highlight elements have pointer-events: none.
 */
function findHighlightAtPoint(x: number, y: number): string | null {
  // Find the page element at this point
  const els = document.elementsFromPoint(x, y);
  let pageEl: HTMLElement | null = null;
  for (const el of els) {
    const found = (el as HTMLElement).closest?.("[data-page-number]") as HTMLElement | null;
    if (found) {
      pageEl = found;
      break;
    }
  }
  if (!pageEl) return null;

  const pageNum = parseInt(pageEl.dataset.pageNumber || "0", 10);
  if (!pageNum) return null;

  const pageBounds = pageEl.getBoundingClientRect();
  const relX = (x - pageBounds.left) / pageBounds.width;
  const relY = (y - pageBounds.top) / pageBounds.height;

  const { highlights } = useAnnotationStore.getState();
  for (const highlight of highlights.values()) {
    for (const rect of highlight.selection.rects) {
      if (rect.pageNum !== pageNum) continue;
      if (
        relX >= rect.x &&
        relX <= rect.x + rect.width &&
        relY >= rect.y &&
        relY <= rect.y + rect.height
      ) {
        return highlight.id;
      }
    }
  }

  return null;
}

export function useTextSelection(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      // Don't show on right-click (handled by contextmenu event)
      if (e.button === 2) return;

      const data = getSelectionData();
      if (!data) return;

      useAnnotationStore
        .getState()
        .showContextMenu(e.clientX, e.clientY, data.selection, null);
    };

    const handleContextMenu = (e: MouseEvent) => {
      // Check for text selection first
      const data = getSelectionData();

      // Check for highlight under cursor
      const highlightId = findHighlightAtPoint(e.clientX, e.clientY);

      // If we have a selection or a highlight, show our context menu
      if (data || highlightId) {
        e.preventDefault();
        useAnnotationStore
          .getState()
          .showContextMenu(
            e.clientX,
            e.clientY,
            data?.selection ?? null,
            highlightId,
          );
      }
      // Otherwise, let the browser's default context menu appear
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Dismiss context menu if clicking outside it (left-click only)
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-annotation-context-menu]")) {
        useAnnotationStore.getState().hideContextMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        useAnnotationStore.getState().hideContextMenu();
      }
    };

    const handleScroll = () => {
      useAnnotationStore.getState().hideContextMenu();
    };

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    container.addEventListener("scroll", handleScroll, true);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("scroll", handleScroll, true);
    };
  }, [containerRef]);
}
