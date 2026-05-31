import { useEffect } from "react";
import { useAnnotationStore } from "@/stores/annotation-store";
import type { PageRect, TextSelection } from "@/types/annotation";

/**
 * Belt-and-suspenders clamp for selection over-extension. pdf.js's
 * text layer occasionally lets a drag-select snap its endpoint to
 * the layer container (instead of an individual span), which makes
 * the range engulf every remaining span on the page. The CSS rule
 * `:not(span) { user-select: none }` blocks most cases visually; this
 * runs at read-time to repair any range that still slipped through,
 * so we never hand a "whole-page" selection to the context menu.
 */
function clampOverExtendedSelection(sel: Selection): void {
  // Only repair a single drag-select. For a Ctrl/⌘-click multi-range
  // selection we must NOT touch it — the removeAllRanges()/addRange()
  // repair below would collapse it down to a single range and drop the
  // other fragments.
  if (sel.isCollapsed || sel.rangeCount !== 1) return;
  const range = sel.getRangeAt(0);
  const endNode = range.endContainer;

  // The only "valid" endpoint is inside a span's text node. Anything
  // landing on the textContent layer itself is an over-extension.
  const endLayer =
    endNode instanceof Element &&
    endNode.classList?.contains("react-pdf__Page__textContent")
      ? endNode
      : null;
  if (!endLayer) return;

  // Probe the rightmost user-visible rect to find which span the
  // user actually meant to reach. A small inset from the right edge
  // lands inside the span instead of past it.
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
  // Shrink the range to end at the span we just hit. Re-applying the
  // range tells the browser to repaint the highlight, so the user
  // also sees the clamp visually.
  range.setEnd(lastChild, lastChild.length);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getSelectionData(): { selection: TextSelection; rects: PageRect[] } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  clampOverExtendedSelection(sel);

  // Range 0 gates the "is this inside a PDF text layer?" check. The
  // rect collection below walks EVERY range: a Ctrl/⌘-click selection
  // is several disjoint ranges, and reading only range 0 was the bug
  // where a multi-part selection only underlined its first fragment.
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

      // Mirror the right-click path: probe for BOTH a selection and
      // a highlight at the cursor and pass both to the menu. Without
      // probing both, a click-on-highlight that happens while a stale
      // text selection from earlier is still alive would land in the
      // selection branch and never expose the "Remove Highlight"
      // entry. Showing them together keeps the menu honest about
      // what actions apply to what's under the cursor.
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

    // Mobile path. Selection on touch devices completes on touchend
    // rather than mouseup; long-press → drag-to-extend → release.
    //
    // Was: blanket double-rAF wait so the selection state had a
    // guaranteed two frames to settle. That added ~33ms of dead time
    // even on platforms where the selection is already ready at
    // touchend. Now: try synchronously first (zero delay common case),
    // fall back to a single rAF only if nothing's there yet — covers
    // the platforms where selectionchange lands one tick after
    // touchend without penalising everyone else.
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
