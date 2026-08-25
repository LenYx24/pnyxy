import { useCallback, useMemo, useRef, useState } from "react";
import { upperBound } from "./pdf-layout";

export interface PdfVirtualizationArgs {
  totalPages: number;
  pageOffsets: number[];
  getPageHeight: (pageNum: number) => number;
  /** Container scrollTop as React sees it. */
  scrollTop: number;
  containerHeight: number;
  liveScaleTrigger: number;
  zoomBoostActive: boolean;
  scrollToPage: number | null;
}

export interface PdfVirtualization {
  /** Pages to mount this render (visible window + jump prefetch + gesture-frozen set). */
  renderedPages: number[];
  /** Feed a scroll sample (called from the scroll handler's rAF). */
  sampleScrollVelocity: (scrollTop: number, now: number, isProgrammatic: boolean) => void;
}

/**
 * Which pages are mounted, virtualized in tray-local coords (scrollTop /
 * scale), widened by scroll velocity and by an active zoom gesture.
 */
export function usePdfVirtualization({
  totalPages,
  pageOffsets,
  getPageHeight,
  scrollTop,
  containerHeight,
  liveScaleTrigger,
  zoomBoostActive,
  scrollToPage,
}: PdfVirtualizationArgs): PdfVirtualization {
  const [scrollVelocity, setScrollVelocity] = useState(0);
  const lastScrollSampleRef = useRef<{ y: number; t: number } | null>(null);
  const velocityDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const sampleScrollVelocity = useCallback(
    (st: number, now: number, isProgrammatic: boolean) => {
      const prev = lastScrollSampleRef.current;
      // A zoom pivot write moves scrollTop by a lot in one step (deep in a
      // long document: thousands of px). Feeding that into the velocity
      // would flag a "fast scroll" and mount up to 6 viewports of extra
      // pages mid-gesture, so only user scrolls contribute.
      if (prev && !isProgrammatic) {
        const dt = now - prev.t;
        if (dt > 0) {
          const dy = st - prev.y;
          setScrollVelocity((v) => v * 0.4 + (dy / dt) * 0.6);
        }
      }
      lastScrollSampleRef.current = { y: st, t: now };
      if (velocityDecayTimerRef.current) {
        clearTimeout(velocityDecayTimerRef.current);
      }
      velocityDecayTimerRef.current = setTimeout(() => {
        setScrollVelocity(0);
        lastScrollSampleRef.current = null;
      }, 250);
    },
    [],
  );

  const visiblePages = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return [];
    const scale = liveScaleTrigger;
    const trayViewportTop = scrollTop / scale;
    const trayViewportH = containerHeight / scale;

    const fastScroll = scrollVelocity > 1.5;
    const aheadFactor = fastScroll
      ? Math.min(6, 2 + scrollVelocity * 0.8)
      : 2;
    const goingDown = scrollVelocity >= 0;
    let aboveFactor = goingDown ? 1 : aheadFactor;
    let belowFactor = goingDown ? aheadFactor : 1;
    if (zoomBoostActive) {
      // pre-mount extra pages so a fast zoom-out doesn't reveal blanks
      aboveFactor = Math.max(aboveFactor, 3);
      belowFactor = Math.max(belowFactor, 4);
    }
    const viewportTop = trayViewportTop - trayViewportH * aboveFactor;
    const viewportBottom =
      trayViewportTop + trayViewportH * (1 + belowFactor);

    const ub = upperBound(pageOffsets, viewportTop);
    let startIdx = Math.max(0, ub - 1);
    if (
      startIdx < pageOffsets.length - 1 &&
      pageOffsets[startIdx] + getPageHeight(startIdx + 1) < viewportTop
    ) {
      startIdx += 1;
    }

    const pages: number[] = [];
    for (let i = startIdx; i < totalPages; i++) {
      if (pageOffsets[i] > viewportBottom) break;
      pages.push(i + 1);
    }
    return pages;
  }, [
    scrollTop,
    containerHeight,
    totalPages,
    pageOffsets,
    getPageHeight,
    scrollVelocity,
    liveScaleTrigger,
    zoomBoostActive,
  ]);

  const jumpPrefetchPages = useMemo(() => {
    if (scrollToPage === null) return new Set<number>();
    const set = new Set<number>();
    for (let p = scrollToPage - 1; p <= scrollToPage + 1; p++) {
      if (p >= 1 && p <= totalPages) set.add(p);
    }
    return set;
  }, [scrollToPage, totalPages]);

  // Pages mounted before the current zoom gesture started. While the
  // gesture runs the mounted set only grows (union with the new window), so
  // no already-rendered canvas is unmounted mid-zoom; the set collapses back
  // to the plain window once zoomBoostActive drops.
  //
  // The set is read and written inside the memo on purpose: the frozen set
  // has to be folded into the SAME render that computes the new window, an
  // effect would land a frame late and let the canvases unmount first.
  const gestureMountedRef = useRef<number[] | null>(null);

  /* eslint-disable react-hooks/refs */
  const renderedPages = useMemo(() => {
    let pages = visiblePages;
    if (jumpPrefetchPages.size > 0) {
      const set = new Set(visiblePages);
      for (const p of jumpPrefetchPages) set.add(p);
      pages = Array.from(set).sort((a, b) => a - b);
    }
    if (!zoomBoostActive) {
      gestureMountedRef.current = null;
      return pages;
    }
    const kept = gestureMountedRef.current;
    if (kept && kept.length > 0) {
      const set = new Set(kept);
      let grew = false;
      for (const p of pages) {
        if (!set.has(p)) {
          set.add(p);
          grew = true;
        }
      }
      if (!grew) {
        return kept;
      }
      pages = Array.from(set).sort((a, b) => a - b);
    }
    gestureMountedRef.current = pages;
    return pages;
  }, [visiblePages, jumpPrefetchPages, zoomBoostActive]);

  return { renderedPages, sampleScrollVelocity };
  /* eslint-enable react-hooks/refs */
}
