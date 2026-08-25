import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

// renderWidth = the width react-pdf rasterizes at. Grow-only: shrinking
// keeps the larger canvas and CSS-down-scales, so resize-down never
// re-rasterizes. Capped because canvas backing is W * devicePixelRatio;
// an uncapped Retina render hits ~187 MB/page and tanks scrolling.
// See react-pdf issues #1760, #1705, #875.
const RENDER_GROWTH_HEADROOM = 1.1;
const RENDER_WIDTH_CAP = 1800;

export interface PdfContainerSize {
  containerWidth: number;
  containerHeight: number;
  /** Tray-local width of every page at 1x scale. */
  baselineWidth: number;
  /** Grow-only rasterization width for PageSlot. */
  renderWidth: number;
}

/**
 * Tracks the scroll container's size (rAF-throttled ResizeObserver) and
 * derives the tray baseline width plus the grow-only raster width.
 */
export function usePdfContainerSize(
  containerRef: RefObject<HTMLDivElement | null>,
): PdfContainerSize {
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Track container size, rAF-throttled (not debounced). renderWidth is
  // window-based and constant, so a resize step is pure CSS with no
  // re-rasterize and the page can track the divider live. rAF coalesces
  // the ResizeObserver burst to one update per frame.
  const resizeRafRef = useRef<number>(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerWidth(el.clientWidth);
    setContainerHeight(el.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = requestAnimationFrame(() => {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current);
    };
  }, [containerRef]);

  // baselineWidth = tray-local width of every page at 1x scale. Tray CSS
  // transform handles visual zoom; per-slot transform bridges baselineWidth
  // (display) vs renderWidth (raster). With the -48 padding, fit-width == 1x.
  const baselineWidth = containerWidth > 0 ? containerWidth - 48 : 600;

  const [renderWidth, setRenderWidth] = useState(0);
  useLayoutEffect(() => {
    if (baselineWidth <= 0) return;
    // Rasterize at the widest the panel could reach (window width), not the
    // current panel width. A panel can't grow past the window, so a divider
    // drag never exceeds the canvas we already have and only CSS-scales.
    // Grow-only + capped, so only a window-resize-up re-rasterizes.
    const maxDisplay = Math.max(
      baselineWidth,
      typeof window !== "undefined" ? window.innerWidth : baselineWidth,
    );
    const target = Math.min(maxDisplay * RENDER_GROWTH_HEADROOM, RENDER_WIDTH_CAP);
    // Grow-only state has to be committed before paint (layout effect) so
    // the first PageSlot raster is already at the final width.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRenderWidth((prev) => (target > prev ? target : prev));
  }, [baselineWidth]);

  return { containerWidth, containerHeight, baselineWidth, renderWidth };
}
