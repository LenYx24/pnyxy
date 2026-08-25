import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import { useReaderStore } from "@/stores/reader-store";
import { upperBound, type PageDimensions } from "./pdf-layout";
import type { TouchAxisLock } from "./usePdfTouchAxisLock";

export interface ResumeTarget {
  page: number;
  offset: number;
  expiresAt: number;
}

export interface PdfScrollAnchorArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  docId: string | null | undefined;
  zoomMode: string;
  scrollToPage: number | null;
  pageOffsets: number[];
  getPageHeight: (pageNum: number) => number;
  resolvedDims: PageDimensions[] | null;
  baselineWidth: number;
  containerHeight: number;
  scrollTop: number;
  setScrollTop: (top: number) => void;
  liveScaleRef: RefObject<number>;
  writeProgrammaticScroll: (el: HTMLElement, top: number, left?: number) => void;
  consumeProgrammaticScroll: (el: HTMLElement) => boolean;
  lastScrollWasProgrammaticRef: RefObject<boolean>;
  /** Shared with the wheel handler in usePdfZoom. */
  userScrolledRef: RefObject<boolean>;
  resumeTargetRef: RefObject<ResumeTarget | null>;
  touchAxisLockRef: RefObject<TouchAxisLock | null>;
  sampleScrollVelocity: (scrollTop: number, now: number, isProgrammatic: boolean) => void;
  setCurrentPage: (page: number, docId?: string) => void;
  setScrollOffset: (fraction: number, docId?: string) => void;
  clearScrollRequest: (docId?: string) => void;
}

export interface PdfScrollAnchor {
  handleScroll: () => void;
  handleMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * Everything that reads or writes the container's scroll position on
 * behalf of the user: the scroll handler (current page + top anchor), the
 * resume / scroll-to-page re-snap, the re-anchors on width, height and
 * resolved-dims changes, and the debounced scroll-offset persistence.
 *
 * Invariant: none of these effects write scrollTop while the user is
 * driving the scroll (wheel, touch, or a scrollbar thumb drag).
 */
export function usePdfScrollAnchor({
  containerRef,
  docId,
  zoomMode,
  scrollToPage,
  pageOffsets,
  getPageHeight,
  resolvedDims,
  baselineWidth,
  containerHeight,
  scrollTop,
  setScrollTop,
  liveScaleRef,
  writeProgrammaticScroll,
  consumeProgrammaticScroll,
  lastScrollWasProgrammaticRef,
  userScrolledRef,
  resumeTargetRef,
  touchAxisLockRef,
  sampleScrollVelocity,
  setCurrentPage,
  setScrollOffset,
  clearScrollRequest,
}: PdfScrollAnchorArgs): PdfScrollAnchor {
  const offsetReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);

  // True while the user is driving the scroll: set on every non-programmatic
  // scroll event and cleared 150ms after the last one, and held for the
  // whole time the mouse button is down on the container's scrollbar (a
  // thumb drag fires scroll events with gaps larger than the timer). Effects
  // that re-anchor scrollTop skip their write while this is true so nothing
  // fights the user's input.
  const userScrollActiveRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollbarDragRef = useRef(false);
  const isUserScrolling = useCallback(
    () => userScrollActiveRef.current || scrollbarDragRef.current,
    [],
  );
  const markUserScroll = useCallback(() => {
    userScrollActiveRef.current = true;
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    userScrollTimerRef.current = setTimeout(() => {
      userScrollTimerRef.current = null;
      userScrollActiveRef.current = false;
    }, 150);
  }, []);
  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
    };
  }, []);

  // Page + in-page fraction pinned to the viewport TOP, refreshed on every
  // user scroll. Width-independent so it survives a panel resize: after
  // pages reflow we restore scrollTop to keep this point at the top.
  // Persisted currentPage/scrollOffset can't drive this (they're centre-based).
  const topAnchorRef = useRef<{ page: number; fraction: number } | null>(
    null,
  );

  // Exact scrollTop the resume system last wrote. A scrollbar drag fires no
  // wheel/pointer event, and our re-snap can overwrite the dragged position
  // in the same frame, so userScrolledRef never trips for a drag. The tell
  // is drift: if el.scrollTop differs from our last write on a re-snap tick,
  // the user moved it. (Pages are absolutely positioned in a fixed-height
  // tray, so reflow never moves scrollTop.)
  const lastResumeWriteRef = useRef<number | null>(null);

  // While a panel/viewport resize settles, the browser can clamp scrollTop
  // and fire a *non-programmatic* scroll event before the re-anchor restores
  // the position. handleScroll must not treat that as a real user scroll,
  // it would flip currentPage to a different page and clobber topAnchorRef
  // (the very value the re-anchor needs). Set to now+window on a size change.
  const resizeGuardUntilRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Identify our own programmatic write by matching against the last
    // target; a match consumes the marker so the next event reads as user.
    // Must run synchronously on the raw event, not in the rAF below: a user
    // scroll has to cancel an in-flight resume anchor before the re-snap
    // effect re-applies it, else a scrollbar drag snaps back.
    const isProgrammatic = consumeProgrammaticScroll(el);
    lastScrollWasProgrammaticRef.current = isProgrammatic;
    if (!isProgrammatic) {
      userScrolledRef.current = true;
      resumeTargetRef.current = null;
      markUserScroll();
      // Axis-lock: during a vertical-dominant single-finger touch pan, cancel
      // sideways drift so an imperfect up/down swipe on a zoomed page doesn't
      // slide it left/right. Correcting scrollLeft here (not preventDefault)
      // keeps native vertical momentum intact.
      const lock = touchAxisLockRef.current;
      if (lock?.lockHoriz && el.scrollLeft !== lock.lockLeft) {
        el.scrollLeft = lock.lockLeft;
      }
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const st = el.scrollTop;
      setScrollTop(st);

      sampleScrollVelocity(st, performance.now(), isProgrammatic);

      if (isProgrammatic) return;
      if (pageOffsets.length === 0) return;
      // A resize just fired this via a scrollTop clamp, don't repaginate or
      // overwrite topAnchorRef; the re-anchor effect will restore position.
      if (performance.now() < resizeGuardUntilRef.current) return;

      const scale = liveScaleRef.current;
      const viewportCenterTrayY = (st + containerHeight / 2) / scale;
      const ub = upperBound(pageOffsets, viewportCenterTrayY);
      const containingIdx = Math.max(0, ub - 1);
      const candidates =
        containingIdx + 1 < pageOffsets.length
          ? [containingIdx, containingIdx + 1]
          : [containingIdx];

      let closestPage = candidates[0] + 1;
      let closestDist = Infinity;
      for (const idx of candidates) {
        const pageCenter = pageOffsets[idx] + getPageHeight(idx + 1) / 2;
        const dist = Math.abs(pageCenter - viewportCenterTrayY);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = idx + 1;
        }
      }

      setCurrentPage(closestPage, docId ?? undefined);

      // Capture what's at the viewport TOP so a later resize can pin it
      // back. Width-independent page + fraction.
      const viewportTopTrayY = st / scale;
      const topIdx = Math.max(0, upperBound(pageOffsets, viewportTopTrayY) - 1);
      const topPageTop = pageOffsets[topIdx];
      const topPageHeight = getPageHeight(topIdx + 1);
      const topFraction =
        topPageHeight > 0 ? (viewportTopTrayY - topPageTop) / topPageHeight : 0;
      topAnchorRef.current = {
        page: topIdx + 1,
        fraction: Math.min(1, Math.max(0, topFraction)),
      };
    });
  }, [
    containerHeight,
    pageOffsets,
    getPageHeight,
    setCurrentPage,
    docId,
    markUserScroll,
    containerRef,
    consumeProgrammaticScroll,
    lastScrollWasProgrammaticRef,
    userScrolledRef,
    resumeTargetRef,
    touchAxisLockRef,
    setScrollTop,
    sampleScrollVelocity,
    liveScaleRef,
  ]);

  // Scrollbar drag detection. A mousedown whose offset lies beyond the
  // client box (on the vertical or horizontal scrollbar) starts a drag that
  // no wheel/touch/pointer-move handler sees; hold the flag until mouseup.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el || e.target !== e.currentTarget) return;
      const { offsetX, offsetY } = e.nativeEvent;
      if (offsetX < el.clientWidth && offsetY < el.clientHeight) return;
      scrollbarDragRef.current = true;
      userScrolledRef.current = true;
      resumeTargetRef.current = null;
      const onUp = () => {
        scrollbarDragRef.current = false;
        window.removeEventListener("mouseup", onUp);
        // the last drag scroll events may still be pending, keep the timer
        // based flag alive so a queued re-anchor doesn't fire on release
        markUserScroll();
      };
      window.addEventListener("mouseup", onUp);
    },
    [markUserScroll, containerRef, userScrolledRef, resumeTargetRef],
  );

  // Scroll-to-page (resume on doc open, TOC click, page input, search hit,
  // citation jump). scrollTop = pageOffsets[N] * liveScale.
  // resumeTargetRef is set first, even before pageOffsets has the entry, so
  // the re-snap effect below pulls the scroll toward the target as the
  // layout fills in. Otherwise a slow doc-load leaves the view on page 1.
  useEffect(() => {
    if (scrollToPage === null) return;
    const el = containerRef.current;
    if (!el) return;

    const offset =
      useReaderStore.getState().documents.get(docId ?? "")?.scrollOffset ?? 0;
    // The one legitimate re-arm point for the resume re-snap, re-enable
    // even if the user scrolled the previous view.
    userScrolledRef.current = false;
    // forget the previous view's last write so the first re-snap tick
    // doesn't mistake it for user drift
    lastResumeWriteRef.current = null;
    resumeTargetRef.current = {
      page: scrollToPage,
      offset,
      expiresAt: Date.now() + 5000,
    };

    if (pageOffsets.length === 0) return;
    const pageTop = pageOffsets[scrollToPage - 1];
    if (pageTop === undefined) return;

    const pageHeight = getPageHeight(scrollToPage);
    const scale = liveScaleRef.current;
    const targetOffset = (pageTop + offset * pageHeight) * scale;

    writeProgrammaticScroll(el, targetOffset);
    lastResumeWriteRef.current = el.scrollTop;
    setScrollTop(targetOffset);

    clearScrollRequest(docId ?? undefined);
  }, [
    scrollToPage,
    pageOffsets,
    clearScrollRequest,
    docId,
    getPageHeight,
    containerRef,
    userScrolledRef,
    resumeTargetRef,
    liveScaleRef,
    writeProgrammaticScroll,
    setScrollTop,
  ]);

  // Re-snap on layout settle. Fires on every dim change within the resume
  // window so the scroll stays anchored as real page heights replace A4
  // estimates. The 5s window is the back-stop.
  useLayoutEffect(() => {
    const target = resumeTargetRef.current;
    if (!target) return;
    // User took over the scroll, drop the anchor. (handleScroll/handleWheel
    // already null it; this guards the frame where a settle commit runs
    // before the scroll event.)
    if (userScrolledRef.current) {
      resumeTargetRef.current = null;
      return;
    }
    if (Date.now() > target.expiresAt) {
      resumeTargetRef.current = null;
      return;
    }
    const el = containerRef.current;
    if (!el || pageOffsets.length === 0) return;
    // drift since our last write means the user grabbed the scrollbar
    const lastWrite = lastResumeWriteRef.current;
    if (lastWrite !== null && Math.abs(el.scrollTop - lastWrite) > 1) {
      userScrolledRef.current = true;
      resumeTargetRef.current = null;
      return;
    }
    const pageTop = pageOffsets[target.page - 1];
    if (pageTop === undefined) return;
    const pageHeight = getPageHeight(target.page);
    const desired = (pageTop + target.offset * pageHeight) * liveScaleRef.current;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    writeProgrammaticScroll(el, desired);
    lastResumeWriteRef.current = el.scrollTop;
    setScrollTop(desired);
  }, [
    pageOffsets,
    getPageHeight,
    resumeTargetRef,
    userScrolledRef,
    containerRef,
    liveScaleRef,
    writeProgrammaticScroll,
    setScrollTop,
  ]);

  // Re-anchor on container WIDTH change (e.g. dragging a side-panel
  // divider). In fit-width/custom modes a width change resizes every page
  // and shifts pageOffsets, so a fixed scrollTop would land on a different
  // page and jump. fit-page is handled by the zoom-mode sync effect.
  //
  // Pin the page-position that was at the viewport TOP back to the top.
  // topAnchorRef is page + fraction (width-independent), so recompute the
  // pixel target from the fresh pageOffsets. Pages above the anchor are
  // already measured, so one write holds. Falls back to currentPage top.
  const lastAnchorWidthRef = useRef(baselineWidth);
  useLayoutEffect(() => {
    const prevWidth = lastAnchorWidthRef.current;
    lastAnchorWidthRef.current = baselineWidth;
    if (prevWidth === baselineWidth) return; // only act on a width change
    // suppress the clamp-induced repaginate for this settle (see handleScroll)
    resizeGuardUntilRef.current = performance.now() + 250;
    if (zoomMode === "fit-page") return; // applyScale owns this re-anchor
    if (scrollToPage !== null || resumeTargetRef.current) return; // resume owns the scroll
    if (scrollbarDragRef.current) return; // never fight a thumb drag
    const el = containerRef.current;
    if (!el || pageOffsets.length === 0) return;

    let page: number;
    let fraction: number;
    const anchor = topAnchorRef.current;
    if (anchor) {
      page = anchor.page;
      fraction = anchor.fraction;
    } else {
      const doc = useReaderStore.getState().documents.get(docId ?? "");
      if (!doc) return;
      page = doc.currentPage;
      fraction = 0;
    }
    const pageTop = pageOffsets[page - 1];
    if (pageTop === undefined) return;
    const pageHeight = getPageHeight(page);
    const desired = (pageTop + fraction * pageHeight) * liveScaleRef.current;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    writeProgrammaticScroll(el, desired);
    setScrollTop(desired);
  }, [
    baselineWidth,
    zoomMode,
    scrollToPage,
    pageOffsets,
    getPageHeight,
    docId,
    resumeTargetRef,
    containerRef,
    liveScaleRef,
    writeProgrammaticScroll,
    setScrollTop,
  ]);

  // Re-anchor on container HEIGHT change (e.g. the reader toolbar/menu
  // appearing or disappearing shrinks/grows the viewport). A taller viewport
  // can clamp scrollTop and shift what's visible; pin the top-anchored
  // page/fraction back to the viewport top, mirroring the WIDTH re-anchor.
  // fit-page recomputes scale from height in the zoom-mode sync effect, so
  // it owns its own re-anchor and is skipped here.
  const lastAnchorHeightRef = useRef(containerHeight);
  useLayoutEffect(() => {
    const prevHeight = lastAnchorHeightRef.current;
    lastAnchorHeightRef.current = containerHeight;
    if (prevHeight === containerHeight) return; // only act on a height change
    // suppress the clamp-induced repaginate for this settle (see handleScroll)
    resizeGuardUntilRef.current = performance.now() + 250;
    if (zoomMode === "fit-page") return; // applyScale owns this re-anchor
    if (scrollToPage !== null || resumeTargetRef.current) return; // resume owns the scroll
    if (scrollbarDragRef.current) return; // never fight a thumb drag
    const el = containerRef.current;
    if (!el || pageOffsets.length === 0) return;

    let page: number;
    let fraction: number;
    const anchor = topAnchorRef.current;
    if (anchor) {
      page = anchor.page;
      fraction = anchor.fraction;
    } else {
      const doc = useReaderStore.getState().documents.get(docId ?? "");
      if (!doc) return;
      page = doc.currentPage;
      fraction = 0;
    }
    const pageTop = pageOffsets[page - 1];
    if (pageTop === undefined) return;
    const pageHeight = getPageHeight(page);
    const desired = (pageTop + fraction * pageHeight) * liveScaleRef.current;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    writeProgrammaticScroll(el, desired);
    setScrollTop(desired);
  }, [
    containerHeight,
    zoomMode,
    scrollToPage,
    pageOffsets,
    getPageHeight,
    docId,
    resumeTargetRef,
    containerRef,
    liveScaleRef,
    writeProgrammaticScroll,
    setScrollTop,
  ]);

  // One-shot re-anchor when the resolved dims land: this is the last time
  // pageOffsets can change for the document, and if the user already
  // scrolled away from the resume target the content under the viewport
  // would otherwise shift once. Pin the top-anchored page/fraction back.
  // Skipped while the user is actively scrolling (their input wins, the
  // shift is a one-off) and when resume still owns the scroll.
  const prevResolvedDimsRef = useRef(resolvedDims);
  useLayoutEffect(() => {
    const prev = prevResolvedDimsRef.current;
    prevResolvedDimsRef.current = resolvedDims;
    if (prev === resolvedDims || resolvedDims === null) return; // only on resolve
    if (scrollToPage !== null || resumeTargetRef.current) return;
    if (isUserScrolling()) return;
    const el = containerRef.current;
    const anchor = topAnchorRef.current;
    if (!el || !anchor || pageOffsets.length === 0) return;
    const pageTop = pageOffsets[anchor.page - 1];
    if (pageTop === undefined) return;
    const desired =
      (pageTop + anchor.fraction * getPageHeight(anchor.page)) *
      liveScaleRef.current;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    writeProgrammaticScroll(el, desired);
    setScrollTop(desired);
  }, [
    resolvedDims,
    scrollToPage,
    pageOffsets,
    getPageHeight,
    isUserScrolling,
    resumeTargetRef,
    containerRef,
    liveScaleRef,
    writeProgrammaticScroll,
    setScrollTop,
  ]);

  // Save scroll fraction to store for resume sync. Skip when the scroll
  // came from us, so a re-applied value doesn't overwrite the saved
  // fraction. Flag is consumed single-shot so the next user scroll commits.
  useEffect(() => {
    if (pageOffsets.length === 0 || containerHeight === 0) return;
    if (lastScrollWasProgrammaticRef.current) {
      lastScrollWasProgrammaticRef.current = false;
      return;
    }
    const scale = liveScaleRef.current;
    const viewportCenter = (scrollTop + containerHeight / 2) / scale;
    const idx = Math.max(0, upperBound(pageOffsets, viewportCenter) - 1);
    const pageTop = pageOffsets[idx];
    const pageHeight = getPageHeight(idx + 1);
    if (viewportCenter >= pageTop && viewportCenter <= pageTop + pageHeight) {
      const fraction = (viewportCenter - pageTop) / pageHeight;
      if (offsetReportTimerRef.current) clearTimeout(offsetReportTimerRef.current);
      offsetReportTimerRef.current = setTimeout(() => {
        setScrollOffset(fraction, docId ?? undefined);
      }, 250);
    }
  }, [
    scrollTop,
    pageOffsets,
    getPageHeight,
    containerHeight,
    setScrollOffset,
    docId,
    lastScrollWasProgrammaticRef,
    liveScaleRef,
  ]);

  return { handleScroll, handleMouseDown };
}
