import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useReaderStore } from "@/stores/reader-store";
import {
  registerZoomControls,
  type ZoomGestureControls,
} from "../../gestures/pinch-zoom-controller";
import { clamp, MAX_SCALE, MIN_SCALE, STORE_COMMIT_DEBOUNCE_MS } from "./pdf-layout";
import type { PageDimensions } from "./pdf-layout";
import type { ResumeTarget } from "./usePdfScrollAnchor";

export type ApplyScale = (
  newScale: number,
  logicalX: number,
  logicalY: number,
  focalViewportX: number,
  focalViewportY: number,
) => void;

export interface PdfZoomArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  sizerRef: RefObject<HTMLDivElement | null>;
  trayRef: RefObject<HTMLDivElement | null>;
  docId: string | null | undefined;
  baselineWidth: number;
  totalContentHeight: number;
  /** Source of truth for visual zoom, owned by the viewer. */
  liveScaleRef: RefObject<number>;
  setZoomLevel: (level: number, docId?: string) => void;
  writeProgrammaticScroll: (el: HTMLElement, top: number, left?: number) => void;
  /** Container scrollTop as React sees it; applyScale writes it synchronously. */
  setScrollTop: (top: number) => void;
  /** Shared with the scroll anchor: a plain wheel scroll is user intent. */
  userScrolledRef: RefObject<boolean>;
  resumeTargetRef: RefObject<ResumeTarget | null>;
}

export interface PdfZoom {
  /** React-visible mirror of liveScaleRef, bumps only over 0.5% threshold. */
  liveScaleTrigger: number;
  /** true mid-zoom, widens the virtualization window. */
  zoomBoostActive: boolean;
  applyScale: ApplyScale;
}

/**
 * Live tray zoom: the per-frame scale + scroll pivot math, the pinch
 * gesture entry points registered for ReaderPage, the ctrl+wheel handler
 * (which also owns plain wheel smooth-scrolling), and the debounced mirror
 * of the live scale into the store. The store -> live sync runs in
 * usePdfZoomModeSync, which the viewer calls after the scroll-anchor
 * effects so a re-anchor never lands after a pivot write.
 */
export function usePdfZoom({
  containerRef,
  sizerRef,
  trayRef,
  docId,
  baselineWidth,
  totalContentHeight,
  liveScaleRef,
  setZoomLevel,
  writeProgrammaticScroll,
  setScrollTop,
  userScrolledRef,
  resumeTargetRef,
}: PdfZoomArgs): PdfZoom {
  const storeCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // React-visible mirror of liveScaleRef, bumps only over 0.5% threshold.
  const [liveScaleTrigger, setLiveScaleTrigger] = useState(1);
  // true mid-zoom, widens the visiblePages window so a fast zoom-out
  // doesn't flash blanks. ref dedups the setState per wheel event.
  const [zoomBoostActive, setZoomBoostActive] = useState(false);
  const zoomBoostRef = useRef(false);
  const setZoomBoost = useCallback((active: boolean) => {
    if (zoomBoostRef.current === active) return;
    zoomBoostRef.current = active;
    setZoomBoostActive(active);
  }, []);

  // Refs mirror the latest derived values for the wheel handler, which is
  // set up once and reads them each gesture frame.
  const baselineWidthRef = useRef(baselineWidth);
  const totalContentHeightRef = useRef(totalContentHeight);
  useLayoutEffect(() => {
    baselineWidthRef.current = baselineWidth;
    totalContentHeightRef.current = totalContentHeight;
  }, [baselineWidth, totalContentHeight]);

  // Imperatively size the sizer to baselineWidth/totalContentHeight *
  // liveScale after every render (no deps), so the DOM never sits at the
  // JSX-declared unscaled values (which would be a visible snap).
  //
  // Skip the write when dims already match: an identical re-write can still
  // trigger the browser's scroll-clamping pass mid-drag, which shows up as
  // the horizontal scrollbar snapping back to 0 on a zoomed-in page.
  useLayoutEffect(() => {
    const sizerEl = sizerRef.current;
    if (!sizerEl) return;
    const scale = liveScaleRef.current;
    const nextWidth = `${baselineWidth * scale}px`;
    const nextHeight = `${totalContentHeight * scale}px`;
    if (
      sizerEl.style.width === nextWidth &&
      sizerEl.style.height === nextHeight
    ) {
      return;
    }
    // Save/restore scroll across the write: when the sizer box actually
    // shrinks (real height replaces an A4 estimate) the browser clamps both
    // axes, which would yank an in-progress scrollbar drag back to 0.
    const containerEl = containerRef.current;
    const prevLeft = containerEl?.scrollLeft ?? 0;
    const prevTop = containerEl?.scrollTop ?? 0;
    sizerEl.style.width = nextWidth;
    sizerEl.style.height = nextHeight;
    if (containerEl) {
      if (containerEl.scrollLeft !== prevLeft) {
        containerEl.scrollLeft = prevLeft;
      }
      if (containerEl.scrollTop !== prevTop) {
        containerEl.scrollTop = prevTop;
      }
    }
  });

  // Apply the scale + scroll math imperatively. Runs 60x/sec during a
  // gesture, so it touches only DOM and refs; setLiveScaleTrigger's
  // functional updater returns prev when sub-threshold to avoid re-renders.
  const applyScale = useCallback<ApplyScale>(
    (newScale, logicalX, logicalY, focalViewportX, focalViewportY) => {
      const containerEl = containerRef.current;
      const sizerEl = sizerRef.current;
      const trayEl = trayRef.current;
      if (!containerEl || !sizerEl || !trayEl) return;

      const clampedScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
      liveScaleRef.current = clampedScale;

      const baseW = baselineWidthRef.current;
      const baseH = totalContentHeightRef.current;
      sizerEl.style.width = `${baseW * clampedScale}px`;
      sizerEl.style.height = `${baseH * clampedScale}px`;
      trayEl.style.transform = `scale(${clampedScale})`;

      // Pivot the zoom at the focal point (finger midpoint / wheel cursor /
      // viewport centre) rather than the top-left: keep the logical (tray-
      // local) point that sat under the focal point pinned there across the
      // scale change, i.e. place logicalX*scale back under focalViewportX.
      const containerRect = containerEl.getBoundingClientRect();
      const maxScrollLeft = Math.max(
        0,
        baseW * clampedScale - containerEl.clientWidth,
      );
      const maxScrollTop = Math.max(
        0,
        baseH * clampedScale - containerEl.clientHeight,
      );
      const newScrollLeft = clamp(
        containerRect.left + logicalX * clampedScale - focalViewportX,
        0,
        maxScrollLeft,
      );
      const newScrollTop = clamp(
        containerRect.top + logicalY * clampedScale - focalViewportY,
        0,
        maxScrollTop,
      );

      // Arm the programmatic-scroll marker so this scroll event isn't
      // mis-read as user input (which would clear resumeTargetRef and break
      // TOC/deep-link restoration).
      writeProgrammaticScroll(containerEl, newScrollTop, newScrollLeft);

      // Bump the React trigger only when the scale moved enough to matter
      // for virtualization; sub-threshold changes skip the re-render.
      //
      // scrollTop MUST land in the same render as the scale. The scroll
      // event (and the rAF inside handleScroll) arrives frames later, so
      // without this visiblePages would divide the OLD scrollTop by the NEW
      // scale: deep in a long document that is off by dozens of pages, the
      // pages under the viewport would unmount, then remount blank a frame
      // later (a zoom flicker that only shows on 100+ page PDFs). Both
      // setState calls run in one rAF/effect tick, so React batches them.
      setScrollTop(containerEl.scrollTop);
      setLiveScaleTrigger((prev) =>
        Math.abs(prev - clampedScale) > 0.005 ? clampedScale : prev,
      );
    },
    [containerRef, sizerRef, trayRef, liveScaleRef, writeProgrammaticScroll, setScrollTop],
  );

  // Mirror the live scale into the store as zoomLevel after the user stops
  // zooming. Debounced so a gesture triggers one render, after it settles.
  const scheduleStoreCommit = useCallback(() => {
    if (storeCommitTimerRef.current) clearTimeout(storeCommitTimerRef.current);
    storeCommitTimerRef.current = setTimeout(() => {
      storeCommitTimerRef.current = null;
      const scale = liveScaleRef.current;
      // Skip if the store already matches, avoids ping-pong with the
      // store-sync effect. Stored as a float so the round-trip is exact.
      const currentLevel = useReaderStore.getState().documents.get(docId ?? "")
        ?.zoomLevel;
      const desiredLevel = scale * 100;
      if (currentLevel != null && Math.abs(currentLevel - desiredLevel) < 0.5) {
        return;
      }
      setZoomLevel(desiredLevel, docId ?? undefined);
    }, STORE_COMMIT_DEBOUNCE_MS);
  }, [docId, setZoomLevel, liveScaleRef]);

  // Per-gesture state, mutated by begin/update/end. Nothing here goes
  // through React.
  const gestureRef = useRef<{
    active: boolean;
    startScale: number;
    logicalX: number;
    logicalY: number;
    focalX: number;
    focalY: number;
  }>({
    active: false,
    startScale: 1,
    logicalX: 0,
    logicalY: 0,
    focalX: 0,
    focalY: 0,
  });

  const beginGesture = useCallback(
    (focalViewportX: number, focalViewportY: number) => {
      const sizerEl = sizerRef.current;
      if (!sizerEl) return;
      const sizerRect = sizerEl.getBoundingClientRect();
      const scale = liveScaleRef.current;
      // tray-local coords of the focal point
      const logicalX = (focalViewportX - sizerRect.left) / scale;
      const logicalY = (focalViewportY - sizerRect.top) / scale;
      gestureRef.current = {
        active: true,
        startScale: scale,
        logicalX,
        logicalY,
        focalX: focalViewportX,
        focalY: focalViewportY,
      };
      // GPU-promote the tray for the gesture, cleared on end
      const trayEl = trayRef.current;
      if (trayEl) trayEl.style.willChange = "transform";
      setZoomBoost(true);
    },
    [setZoomBoost, sizerRef, trayRef, liveScaleRef],
  );

  const updateGesture = useCallback(
    (scaleSinceBegin: number) => {
      const g = gestureRef.current;
      if (!g.active) return;
      applyScale(
        g.startScale * scaleSinceBegin,
        g.logicalX,
        g.logicalY,
        g.focalX,
        g.focalY,
      );
    },
    [applyScale],
  );

  const endGesture = useCallback(() => {
    const g = gestureRef.current;
    if (!g.active) return;
    g.active = false;
    const trayEl = trayRef.current;
    if (trayEl) trayEl.style.willChange = "";
    setZoomBoost(false);
    scheduleStoreCommit();
  }, [scheduleStoreCommit, setZoomBoost, trayRef]);

  const setAbsolute = useCallback<ZoomGestureControls["setAbsolute"]>(
    (scale, options) => {
      const containerEl = containerRef.current;
      const sizerEl = sizerRef.current;
      if (!containerEl || !sizerEl) return;
      // default pivot: viewport center
      const containerRect = containerEl.getBoundingClientRect();
      const focalX = options?.pivotX ?? containerRect.left + containerRect.width / 2;
      const focalY = options?.pivotY ?? containerRect.top + containerRect.height / 2;
      const sizerRect = sizerEl.getBoundingClientRect();
      const oldScale = liveScaleRef.current;
      const logicalX = (focalX - sizerRect.left) / oldScale;
      const logicalY = (focalY - sizerRect.top) / oldScale;
      applyScale(scale, logicalX, logicalY, focalX, focalY);
      scheduleStoreCommit();
    },
    [applyScale, scheduleStoreCommit, containerRef, sizerRef, liveScaleRef],
  );

  // Register imperative entry points so ReaderPage's pinch/double-tap
  // handlers can drive the tray.
  useEffect(() => {
    const controls: ZoomGestureControls = {
      begin: beginGesture,
      update: updateGesture,
      end: endGesture,
      setAbsolute,
      getScale: () => liveScaleRef.current,
    };
    registerZoomControls(controls);
    return () => registerZoomControls(null);
  }, [beginGesture, updateGesture, endGesture, setAbsolute, liveScaleRef]);

  // Ctrl+wheel cursor-pivot zoom. ctrlKey also fires on trackpad pinch
  // (macOS/Windows synthesise pinch as ctrl+wheel). Each event re-anchors
  // the pivot to the current cursor position; the rAF flush reads the live
  // sizerRect so batched events still see the latest scale. Rapid events
  // grow burstMul (cap 3x) to accelerate; a >200ms gap decays back to 1x.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pendingDeltaY = 0;
    let pendingFocalX = 0;
    let pendingFocalY = 0;
    let pending = false;
    let lastEventTime = 0;
    // Acceleration latch: boost only grows after FAST_RAMP_THRESHOLD
    // consecutive fast events, so casual zoom stays single-detent.
    let fastCount = 0;
    let burstMul = 1;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let trayPromoted = false;

    // Smooth-scroll target tracking: animate scrollTop/Left toward a target
    // with rAF exponential easing, accumulating deltas across rapid wheel
    // events so a burst glides instead of jumping.
    let scrollTargetY = 0;
    let scrollTargetX = 0;
    let scrollAnimating = false;
    let scrollAnimRaf = 0;
    // same acceleration shape as the zoom burst
    let lastScrollEventTime = 0;
    let scrollFastCount = 0;
    let scrollBurstMul = 1;
    const SCROLL_LERP = 0.25;
    const SCROLL_FAST_DT_MS = 60;
    const SCROLL_FAST_THRESHOLD = 5;

    const animateScrollFrame = () => {
      scrollAnimRaf = 0;
      const curY = el.scrollTop;
      const curX = el.scrollLeft;
      const dy = scrollTargetY - curY;
      const dx = scrollTargetX - curX;
      if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) {
        el.scrollTop = scrollTargetY;
        el.scrollLeft = scrollTargetX;
        scrollAnimating = false;
        return;
      }
      el.scrollTop = curY + dy * SCROLL_LERP;
      el.scrollLeft = curX + dx * SCROLL_LERP;
      scrollAnimRaf = requestAnimationFrame(animateScrollFrame);
    };

    const smoothScrollBy = (dy: number, dx: number) => {
      if (!scrollAnimating) {
        // re-anchor to current position so we don't lerp from a stale target
        scrollTargetY = el.scrollTop;
        scrollTargetX = el.scrollLeft;
        scrollAnimating = true;
      }
      const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
      const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
      scrollTargetY = clamp(scrollTargetY + dy, 0, maxY);
      scrollTargetX = clamp(scrollTargetX + dx, 0, maxX);
      if (!scrollAnimRaf) {
        scrollAnimRaf = requestAnimationFrame(animateScrollFrame);
      }
    };

    // Abort an in-flight smooth-scroll. Called when intent shifts to zooming;
    // otherwise the lerp toward a stale target fights applyScale's pivot
    // writes and jitters the view up/down.
    const cancelScrollAnimation = () => {
      if (scrollAnimRaf) {
        cancelAnimationFrame(scrollAnimRaf);
        scrollAnimRaf = 0;
      }
      scrollAnimating = false;
      scrollTargetY = el.scrollTop;
      scrollTargetX = el.scrollLeft;
    };

    const flush = () => {
      pending = false;
      if (pendingDeltaY === 0) return;
      const sizerEl = sizerRef.current;
      if (!sizerEl) {
        pendingDeltaY = 0;
        return;
      }
      const oldScale = liveScaleRef.current;
      const sizerRect = sizerEl.getBoundingClientRect();
      const logicalX = (pendingFocalX - sizerRect.left) / oldScale;
      const logicalY = (pendingFocalY - sizerRect.top) / oldScale;
      // 0.0015 coeff: one detent (deltaY~100) is ~16% per click. The
      // per-flush clamp (0.78/1.28) bounds the change per rAF frame so a
      // fast spin can't compound into a jumpy step; extra input flows
      // through over later frames.
      const rawStep = Math.exp(-pendingDeltaY * 0.0015);
      const stepFactor = clamp(rawStep, 0.78, 1.28);
      applyScale(
        oldScale * stepFactor,
        logicalX,
        logicalY,
        pendingFocalX,
        pendingFocalY,
      );
      pendingDeltaY = 0;
    };

    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(flush);
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Wheel scroll is unambiguous user intent, kill the resume re-snap
        // synchronously so it can't fight this gesture.
        userScrolledRef.current = true;
        resumeTargetRef.current = null;

        // Scroll travel dampens with zoom-in but is capped at 1x zoomed out
        // (without the cap 50% zoom would move 2x the distance and feel floaty).
        const scale = liveScaleRef.current || 1;
        const mul = Math.min(1.0, 1.0 / scale);

        // scroll acceleration latch, same shape as the zoom burst
        const now = performance.now();
        const dt = now - lastScrollEventTime;
        if (dt < SCROLL_FAST_DT_MS) {
          scrollFastCount++;
          if (scrollFastCount > SCROLL_FAST_THRESHOLD) {
            scrollBurstMul = Math.min(3, scrollBurstMul * 1.1);
          }
        } else {
          scrollFastCount = 0;
          if (dt > 200) scrollBurstMul = 1;
        }
        lastScrollEventTime = now;
        const accelMul = mul * scrollBurstMul;

        if (e.shiftKey) {
          // Shift+wheel = horizontal scroll. Some platforms map to deltaX,
          // others leave it on deltaY; use whichever axis has magnitude.
          const horizDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY)
            ? e.deltaX
            : e.deltaY;
          if (horizDelta !== 0) {
            e.preventDefault();
            smoothScrollBy(0, horizDelta * accelMul);
          }
          return;
        }
        // Route every non-zero delta through the smooth scroller. A
        // threshold would let touchpad tail events (deltaY 5-30) fall through
        // to native scroll mid-animation and make the viewport vibrate.
        if (e.deltaY !== 0 || e.deltaX !== 0) {
          e.preventDefault();
          smoothScrollBy(e.deltaY * accelMul, e.deltaX * accelMul);
        }
        return;
      }
      e.preventDefault();
      // switched from scrolling to zooming, kill the tail scroll animation
      cancelScrollAnimation();

      const now = performance.now();
      const dt = now - lastEventTime;
      const FAST_DT_MS = 60;
      const FAST_RAMP_THRESHOLD = 5;
      if (dt < FAST_DT_MS) {
        fastCount++;
        if (fastCount > FAST_RAMP_THRESHOLD) {
          // past the ramp gate, accelerate 1.10 per event, cap 2.5x
          burstMul = Math.min(2.5, burstMul * 1.1);
        }
      } else {
        // pause resets the counter; burstMul only decays after a longer gap
        // so a tiny stutter inside a burst doesn't drop back to 1x
        fastCount = 0;
        if (dt > 200) burstMul = 1;
      }
      lastEventTime = now;

      pendingDeltaY += e.deltaY * burstMul;
      pendingFocalX = e.clientX;
      pendingFocalY = e.clientY;
      if (!trayPromoted) {
        const trayEl = trayRef.current;
        if (trayEl) trayEl.style.willChange = "transform";
        trayPromoted = true;
      }
      setZoomBoost(true);
      schedule();

      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        burstMul = 1;
        fastCount = 0;
        lastEventTime = 0;
        if (trayPromoted) {
          const trayEl = trayRef.current;
          if (trayEl) trayEl.style.willChange = "";
          trayPromoted = false;
        }
        setZoomBoost(false);
        scheduleStoreCommit();
      }, 200);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    // snapshot the tray node so cleanup doesn't depend on the live ref
    const trayElForCleanup = trayRef.current;
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (settleTimer) clearTimeout(settleTimer);
      if (scrollAnimRaf) cancelAnimationFrame(scrollAnimRaf);
      if (trayPromoted && trayElForCleanup) {
        trayElForCleanup.style.willChange = "";
      }
    };
  }, [
    applyScale,
    scheduleStoreCommit,
    setZoomBoost,
    containerRef,
    sizerRef,
    trayRef,
    liveScaleRef,
    userScrolledRef,
    resumeTargetRef,
  ]);

  return { liveScaleTrigger, zoomBoostActive, applyScale };
}

export interface PdfZoomModeSyncArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  sizerRef: RefObject<HTMLDivElement | null>;
  trayRef: RefObject<HTMLDivElement | null>;
  zoomMode: "fit-width" | "fit-page" | "actual" | "auto" | "custom";
  zoomLevel: number;
  baselineWidth: number;
  containerHeight: number;
  containerWidth: number;
  liveScaleRef: RefObject<number>;
  applyScale: ApplyScale;
  getPageHeight: (pageNum: number) => number;
  getIntrinsicDims: (pageNum: number) => PageDimensions | null;
}

/**
 * Sync the live tray scale to the store's zoom mode/level (persisted
 * intent: fit-width, fit-page, or custom). Runs on doc open, container
 * resize, and toolbar zoom actions. Must be called AFTER the scroll-anchor
 * hook: its pivot write has to be the last layout-effect scroll write.
 */
export function usePdfZoomModeSync({
  containerRef,
  sizerRef,
  trayRef,
  zoomMode,
  zoomLevel,
  baselineWidth,
  containerHeight,
  containerWidth,
  liveScaleRef,
  applyScale,
  getPageHeight,
  getIntrinsicDims,
}: PdfZoomModeSyncArgs): void {
  // lastAppliedRef records what we last drove. Without it a getPageHeight
  // identity change (fires whenever a page reports new dims) would re-run
  // this mid-gesture and snap liveScale back to the mode target ("near 100%
  // snaps back to 1.0"). Re-apply only when the intent changes, plus the
  // layout values fit-page/auto/actual actually depend on.
  const lastAppliedRef = useRef<{
    mode: typeof zoomMode;
    level: number;
    baselineWidth: number;
    containerHeight: number;
    page1Width: number;
  } | null>(null);
  useLayoutEffect(() => {
    const containerEl = containerRef.current;
    const sizerEl = sizerRef.current;
    const trayEl = trayRef.current;
    if (!containerEl || !sizerEl || !trayEl) return;
    if (containerWidth === 0 || baselineWidth <= 0) return;

    // Page-1 intrinsic width (tray-local). page1Width / baselineWidth is
    // the scale that renders it at actual size, basis for actual/auto modes.
    const page1Dims = getIntrinsicDims(1);
    const page1Width = page1Dims ? page1Dims.width : 0;

    const last = lastAppliedRef.current;
    // What each mode's target scale depends on:
    //   fit-width: nothing (always 1). custom: zoomLevel.
    //   fit-page: baselineWidth, containerHeight, page-1 dims.
    //   auto/actual: baselineWidth + page-1 width.
    // Ignoring the irrelevant deps matters: a slight wheel-zoom past
    // fit-width leaves the store at level=100, a scrollbar appears and
    // shrinks containerHeight, and a height-gated sameIntent would snap
    // the scale back to 1.0.
    let sameIntent =
      last !== null && last.mode === zoomMode && last.level === zoomLevel;
    if (sameIntent && last !== null && zoomMode === "fit-page") {
      sameIntent =
        last.baselineWidth === baselineWidth &&
        last.containerHeight === containerHeight;
    }
    if (sameIntent && last !== null && (zoomMode === "auto" || zoomMode === "actual")) {
      // recompute once page-1 dims arrive or width changes
      sameIntent =
        last.baselineWidth === baselineWidth && last.page1Width === page1Width;
    }
    if (sameIntent) return;

    // actual-size scale, falls back to fit-width until page-1 dims known
    const actualScale = page1Width > 0 ? page1Width / baselineWidth : 1;

    let targetScale: number;
    if (zoomMode === "fit-width") {
      targetScale = 1;
    } else if (zoomMode === "fit-page") {
      const pageH = getPageHeight(1);
      const usableH = containerHeight - 24;
      targetScale = pageH > 0 ? usableH / pageH : 1;
    } else if (zoomMode === "actual") {
      targetScale = actualScale;
    } else if (zoomMode === "auto") {
      // page width, but never past actual size
      targetScale = Math.min(1, actualScale);
    } else {
      targetScale = zoomLevel / 100;
    }
    targetScale = clamp(targetScale, MIN_SCALE, MAX_SCALE);

    lastAppliedRef.current = {
      mode: zoomMode,
      level: zoomLevel,
      baselineWidth,
      containerHeight,
      page1Width,
    };

    if (Math.abs(targetScale - liveScaleRef.current) < 0.005) {
      // intent changed but resolved to the same scale, skip the DOM write
      return;
    }

    // pivot at viewport center for toolbar zooms
    const rect = containerEl.getBoundingClientRect();
    const focalX = rect.left + rect.width / 2;
    const focalY = rect.top + rect.height / 2;
    const sizerRect = sizerEl.getBoundingClientRect();
    const oldScale = liveScaleRef.current;
    const logicalX = (focalX - sizerRect.left) / oldScale;
    const logicalY = (focalY - sizerRect.top) / oldScale;
    applyScale(targetScale, logicalX, logicalY, focalX, focalY);
  }, [
    zoomMode,
    zoomLevel,
    baselineWidth,
    containerHeight,
    containerWidth,
    applyScale,
    getPageHeight,
    getIntrinsicDims,
    containerRef,
    sizerRef,
    trayRef,
    liveScaleRef,
  ]);
}
