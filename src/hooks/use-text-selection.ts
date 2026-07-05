import { useEffect } from "react";
import { useAnnotationStore } from "@/stores/annotation-store";
import type { PageRect, TextSelection } from "@/types/annotation";

// pdf.js sometimes snaps a drag-select endpoint to the text layer container
// instead of a span, which makes the range swallow the whole page. Clamp it back.
function clampOverExtendedSelection(sel: Selection): void {
  // Single range only. A Ctrl/click multi-range selection must be left alone or
  // the removeAllRanges/addRange below collapses it to one range.
  if (sel.isCollapsed || sel.rangeCount !== 1) return;
  const range = sel.getRangeAt(0);
  const endNode = range.endContainer;

  // Valid endpoints live inside a span text node; the layer itself means over-extension.
  const endLayer =
    endNode instanceof Element &&
    endNode.classList?.contains("react-pdf__Page__textContent")
      ? endNode
      : null;
  if (!endLayer) return;

  // Probe the rightmost rect (inset 2px so we land inside the span, not past it).
  const clientRects = range.getClientRects();
  if (clientRects.length === 0) return;
  const lastRect = clientRects[clientRects.length - 1];
  const probeY = lastRect.top + lastRect.height / 2;
  const probeX = Math.max(lastRect.right - 2, lastRect.left);
  const el = document.elementFromPoint(probeX, probeY);
  const span = el?.closest("span");
  if (!span || span.parentElement !== endLayer) return;

  const lastChild = span.lastChild;
  if (!(lastChild instanceof Text)) return;
  // Shrink to the hit span; re-applying the range repaints the highlight.
  range.setEnd(lastChild, lastChild.length);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getSelectionData(): { selection: TextSelection; rects: PageRect[] } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  clampOverExtendedSelection(sel);

  // Range 0 gates the "inside a PDF text layer?" check; rect collection below
  // walks every range so multi-part (Ctrl/click) selections aren't truncated.
  const firstRange = sel.getRangeAt(0);

  const ancestor =
    firstRange.commonAncestorContainer instanceof Element
      ? firstRange.commonAncestorContainer
      : firstRange.commonAncestorContainer.parentElement;
  if (!ancestor?.closest(".react-pdf__Page__textContent")) return null;

  const text = sel.toString().trim();
  if (!text) return null;

  const rects: PageRect[] = [];

  for (let r = 0; r < sel.rangeCount; r++) {
    const clientRects = sel.getRangeAt(r).getClientRects();
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
  }

  if (rects.length === 0) return null;

  return { selection: { text, rects }, rects };
}

// Coordinate hit-test for highlight under a point (highlight els are pointer-events: none).
function findHighlightAtPoint(x: number, y: number): string | null {
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
      // right-click is handled by the contextmenu event
      if (e.button === 2) return;

      // Probe both selection and highlight so a click-on-highlight with a stale
      // text selection still exposes the "Remove Highlight" entry.
      const data = getSelectionData();
      const highlightId = findHighlightAtPoint(e.clientX, e.clientY);
      if (data || highlightId) {
        useAnnotationStore
          .getState()
          .showContextMenu(
            e.clientX,
            e.clientY,
            data?.selection ?? null,
            highlightId,
          );
      }
    };

    // Touch selection completes on touchend. Try synchronously, then fall back to
    // one rAF for platforms where selectionchange lands a tick after touchend.
    const handleTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const x = touch.clientX;
      const y = touch.clientY;

      const tryShow = () => {
        const data = getSelectionData();
        const highlightId = findHighlightAtPoint(x, y);
        if (data || highlightId) {
          useAnnotationStore
            .getState()
            .showContextMenu(x, y, data?.selection ?? null, highlightId);
          return true;
        }
        return false;
      };

      if (tryShow()) return;
      requestAnimationFrame(() => {
        tryShow();
      });
    };

    const handleContextMenu = (e: MouseEvent) => {
      const data = getSelectionData();
      const highlightId = findHighlightAtPoint(e.clientX, e.clientY);

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
      // else let the native context menu show
    };

    const handleMouseDown = (e: MouseEvent) => {
      // dismiss menu on left-click outside it
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
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    container.addEventListener("scroll", handleScroll, true);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      container.removeEventListener("scroll", handleScroll, true);
    };
  }, [containerRef]);
}
