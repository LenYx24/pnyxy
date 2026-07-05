import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getReaderPalette } from "@/lib/reader-themes";
import { logError } from "@/lib/logger";
import { useTextSelection } from "@/hooks/use-text-selection";
import { HighlightLayer } from "../layers/HighlightLayer";
import { AiCitationLayer } from "../layers/AiCitationLayer";
import { CitationQuoteHighlightLayer } from "../layers/CitationQuoteHighlightLayer";
import { SearchHighlightLayer } from "../layers/SearchHighlightLayer";
import { CommentMarkers } from "../layers/CommentMarkers";
import { InlineDrawLayer } from "../layers/InlineDrawLayer";
import { ReadProgressStrip } from "../controls/ReadProgressStrip";
import { AnnotationContextMenu } from "../popovers/AnnotationContextMenu";
import { CommentPopover } from "../popovers/CommentPopover";
import {
  registerZoomControls,
  type ZoomGestureControls,
} from "../gestures/pinch-zoom-controller";
import { Loader2 } from "lucide-react";

interface PageSlotProps {
  pageNum: number;
  offsetTop: number;
  pageWidth: number;
  pageHeight: number;
  /** Rasterize width. Grow-only, so resize just CSS-scales the slot. */
  renderWidth: number;
  rotation: 0 | 90 | 180 | 270;
  onRenderSuccess: (pageNum: number) => void;
  onRenderError: (pageNum: number, error: Error) => void;
}

// One virtualized page + overlay layers. Rasterized at renderWidth, inner
// div CSS-scales to pageWidth so a resize doesn't re-rasterize.
const PageSlot = memo(function PageSlot({
  pageNum,
  offsetTop,
  pageWidth,
  pageHeight,
  renderWidth,
  rotation,
  onRenderSuccess,
  onRenderError,
}: PageSlotProps) {
  // Fall back to display width on the first frame before renderWidth is set.
  const effectiveRenderW = renderWidth > 0 ? renderWidth : pageWidth;
  const slotScale =
    effectiveRenderW > 0 ? pageWidth / effectiveRenderW : 1;
  const useSlotTransform = Math.abs(slotScale - 1) > 0.001;

  // guard against NaN offsetTop reaching the DOM
  const safeOffsetTop = Number.isFinite(offsetTop) ? offsetTop : 0;

  return (
    <div
      style={{
        position: "absolute",
        top: safeOffsetTop,
        left: 0,
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}
    >
      {/* Outer holds layout space; inner is the renderWidth canvas scaled down. */}
      <div style={{ width: pageWidth, height: pageHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transform: useSlotTransform
              ? `scale(${slotScale})`
              : undefined,
            transformOrigin: useSlotTransform ? "0 0" : undefined,
          }}
        >
          <Page
            pageNumber={pageNum}
            rotate={rotation}
            width={effectiveRenderW}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={
              <div style={{ height: pageHeight, width: effectiveRenderW }} />
            }
            // react-pdf Page has no default error UI, would render blank white
            error={
              <div
                style={{ height: pageHeight, width: effectiveRenderW }}
                className="flex items-center justify-center p-2 text-center text-2xs text-danger"
              >
                Page {pageNum} couldn't be displayed.
              </div>
            }
            onRenderSuccess={() => onRenderSuccess(pageNum)}
            onRenderError={(error) => onRenderError(pageNum, error)}
          />
          <HighlightLayer pageNum={pageNum} />
          <AiCitationLayer pageNum={pageNum} />
          <CitationQuoteHighlightLayer pageNum={pageNum} />
          <SearchHighlightLayer pageNum={pageNum} />
          <CommentMarkers pageNum={pageNum} />
          <InlineDrawLayer pageNum={pageNum} />
        </div>
      </div>
    </div>
  );
});

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const PAGE_GAP = 12;
const A4_RATIO = 1.4142;
const STORE_COMMIT_DEBOUNCE_MS = 250;
// liveScale bounds, matches store ZOOM_MIN/MAX (25/1000)
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

function upperBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface PageDimensions {
  width: number;
  height: number;
}

interface PdfViewerProps {
  documentId?: string;
}

export function PdfViewer({ documentId }: PdfViewerProps) {
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");

  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const setScrollOffset = useReaderStore((s) => s.setScrollOffset);
  const clearScrollRequest = useReaderStore((s) => s.clearScrollRequest);
  const setZoomLevel = useReaderStore((s) => s.setZoomLevel);

  const meta = doc?.meta ?? null;
  const totalPages = doc?.totalPages ?? 0;
  const zoomMode = doc?.zoomMode ?? "fit-width";
  const zoomLevel = doc?.zoomLevel ?? 100;
  const rotation = doc?.pageRotation ?? 0;
  const scrollToPage = doc?.scrollToPage ?? null;
  const invertColors = useSettingsStore((s) => s.pdfInvertColors);
  const readerTheme = useSettingsStore((s) => s.readerTheme);

  const offsetReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  useTextSelection(containerRef);

  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  // Measured page dims by page number. State (not ref) so getPageHeight
  // reads it during render.
  const [dimensions, setDimensions] = useState<Map<number, PageDimensions>>(
    () => new Map(),
  );
  const rafRef = useRef<number>(0);

  // Source of truth for visual zoom. Lives in ref + DOM; mirrored to the
  // store only after idle so gesture frames don't churn React.
  const liveScaleRef = useRef(1);
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

  // Target of the last programmatic scroll write, so handleScroll can tell
  // our writes from user scrolls. Consumed single-shot.
  const programmaticScrollTargetRef = useRef<{ top: number; left: number } | null>(null);
  /** Whether the last scroll was ours. Single-shot, consumer clears it. */
  const lastScrollWasProgrammaticRef = useRef(false);
  /** Write a programmatic scroll and arm the marker. Clamp to live max
   *  (browser clamps too) so the matcher survives a past-edge target. */
  const writeProgrammaticScroll = (
    el: HTMLElement,
    top: number,
    left: number = el.scrollLeft,
  ) => {
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const ct = clamp(top, 0, maxTop);
    const cl = clamp(left, 0, maxLeft);
    programmaticScrollTargetRef.current = { top: ct, left: cl };
    el.scrollTop = ct;
    el.scrollLeft = cl;
  };
  /** True (and consumes the marker) when the scroll matches the last
   *  programmatic target within 1px. Callers skip user-scroll side effects. */
  const consumeProgrammaticScroll = (el: HTMLElement): boolean => {
    const target = programmaticScrollTargetRef.current;
    if (!target) return false;
    const matches =
      Math.abs(el.scrollTop - target.top) <= 1 &&
      Math.abs(el.scrollLeft - target.left) <= 1;
    if (matches) {
      programmaticScrollTargetRef.current = null;
      return true;
    }
    return false;
  };
  const resumeTargetRef = useRef<{
    page: number;
    offset: number;
    expiresAt: number;
  } | null>(null);

  // Page + in-page fraction pinned to the viewport TOP, refreshed on every
  // user scroll. Width-independent so it survives a panel resize: after
  // pages reflow we restore scrollTop to keep this point at the top.
  // Persisted currentPage/scrollOffset can't drive this (they're centre-based).
  const topAnchorRef = useRef<{ page: number; fraction: number } | null>(
    null,
  );

  // True once the user drives the scroll themselves. Disarms the resume
  // re-snap for the current view. Gated on input intent, not scroll-position
  // matching: the re-snap's own programmatic write can land last in a frame
  // and get mis-read as "ours", so resumeTargetRef would never clear. Reset
  // by the scroll-to-page effect (doc open, TOC / search / citation jump).
  const userScrolledRef = useRef(false);

  // Exact scrollTop the resume system last wrote. A scrollbar drag fires no
  // wheel/pointer event, and our re-snap can overwrite the dragged position
  // in the same frame, so userScrolledRef never trips for a drag. The tell
  // is drift: if el.scrollTop differs from our last write on a re-snap tick,
  // the user moved it. (Pages are absolutely positioned in a fixed-height
  // tray, so reflow never moves scrollTop.)
  const lastResumeWriteRef = useRef<number | null>(null);

  const prevRotationRef = useRef(rotation);
  useLayoutEffect(() => {
    if (prevRotationRef.current === rotation) return;
    prevRotationRef.current = rotation;
    // rotation swaps width/height, so cached dims are stale; re-measure
    setDimensions(new Map());
  }, [rotation]);

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
  }, []);

  // baselineWidth = tray-local width of every page at 1x scale. Tray CSS
  // transform handles visual zoom; per-slot transform bridges baselineWidth
  // (display) vs renderWidth (raster). With the -48 padding, fit-width == 1x.
  const baselineWidth = containerWidth > 0 ? containerWidth - 48 : 600;

  // renderWidth = the width react-pdf rasterizes at. Grow-only: shrinking
  // keeps the larger canvas and CSS-down-scales, so resize-down never
  // re-rasterizes. Capped because canvas backing is W * devicePixelRatio;
  // an uncapped Retina render hits ~187 MB/page and tanks scrolling.
  // See react-pdf issues #1760, #1705, #875.
  const RENDER_GROWTH_HEADROOM = 1.1;
  const RENDER_WIDTH_CAP = 1800;
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
    setRenderWidth((prev) => (target > prev ? target : prev));
  }, [baselineWidth]);

  // Estimate page height from cached dims or A4 ratio. A stray cache entry
  // with width=0 / non-finite values would propagate NaN into pageOffsets
  // and every downstream top: style, so validate and fall back to A4.
  const getPageHeight = useCallback(
    (pageNum: number): number => {
      const cached = dimensions.get(pageNum);
      if (
        cached &&
        Number.isFinite(cached.width) &&
        Number.isFinite(cached.height) &&
        cached.width > 0 &&
        cached.height > 0
      ) {
        const scale = baselineWidth / cached.width;
        const height = cached.height * scale;
        if (Number.isFinite(height) && height > 0) return height;
      }
      const fallback = baselineWidth * A4_RATIO;
      return Number.isFinite(fallback) && fallback > 0
        ? fallback
        : 600 * A4_RATIO;
    },
    [baselineWidth, dimensions],
  );

  // pageOffsets and totalContentHeight are tray-local (pre-scale) coords.
  // Multiply by liveScale to get container-scroll coords.
  const pageOffsets = useMemo(() => {
    if (totalPages === 0) return [];
    const offsets: number[] = [0];
    for (let i = 1; i < totalPages; i++) {
      offsets.push(offsets[i - 1] + getPageHeight(i) + PAGE_GAP);
    }
    return offsets;
  }, [totalPages, getPageHeight]);

  const totalContentHeight = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return 0;
    return pageOffsets[totalPages - 1] + getPageHeight(totalPages) + PAGE_GAP;
  }, [totalPages, pageOffsets, getPageHeight]);

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
  // JSX-declared unscaled values (that caused a visual snap).
  //
  // Skip the write when dims already match: an identical re-write can still
  // trigger the browser's scroll-clamping pass mid-drag, which showed up as
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
  const applyScale = useCallback(
    (
      newScale: number,
      logicalX: number,
      logicalY: number,
      focalViewportX: number,
      focalViewportY: number,
    ) => {
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
      setLiveScaleTrigger((prev) =>
        Math.abs(prev - clampedScale) > 0.005 ? clampedScale : prev,
      );
    },
    [],
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
  }, [docId, setZoomLevel]);

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
    [setZoomBoost],
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
  }, [scheduleStoreCommit, setZoomBoost]);

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
    [applyScale, scheduleStoreCommit],
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
  }, [beginGesture, updateGesture, endGesture, setAbsolute]);

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
        // (without the cap 50% zoom moved 2x the distance and felt floaty).
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
        // threshold let touchpad tail events (deltaY 5-30) fall through to
        // native scroll mid-animation and made the viewport vibrate.
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
  }, [applyScale, scheduleStoreCommit, setZoomBoost]);

  // Visible pages, virtualized in tray-local coords (scrollTop / scale).
  const [scrollTop, setScrollTop] = useState(0);

  const [scrollVelocity, setScrollVelocity] = useState(0);
  const lastScrollSampleRef = useRef<{ y: number; t: number } | null>(null);
  const velocityDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
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

  const renderedPages = useMemo(() => {
    if (jumpPrefetchPages.size === 0) return visiblePages;
    const set = new Set(visiblePages);
    for (const p of jumpPrefetchPages) set.add(p);
    return Array.from(set).sort((a, b) => a - b);
  }, [visiblePages, jumpPrefetchPages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Identify our own programmatic write by matching against the last
    // target; a match consumes the marker so the next event reads as user.
    // Must run synchronously on the raw event, not in the rAF below: a user
    // scroll has to cancel an in-flight resume anchor before the re-snap
    // effect re-applies it, else dragging the scrollbar snapped back.
    const isProgrammatic = consumeProgrammaticScroll(el);
    lastScrollWasProgrammaticRef.current = isProgrammatic;
    if (!isProgrammatic) {
      userScrolledRef.current = true;
      resumeTargetRef.current = null;
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const st = el.scrollTop;
      setScrollTop(st);

      const now = performance.now();
      const prev = lastScrollSampleRef.current;
      if (prev) {
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

      if (isProgrammatic) return;
      if (pageOffsets.length === 0) return;

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
  }, [containerHeight, pageOffsets, getPageHeight, setCurrentPage, docId]);

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
  }, [scrollToPage, pageOffsets, clearScrollRequest, docId, getPageHeight]);

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
  }, [pageOffsets, getPageHeight]);

  // Re-anchor on container WIDTH change (e.g. dragging a side-panel
  // divider). In fit-width/custom modes a width change resizes every page
  // and shifts pageOffsets, so a fixed scrollTop would land on a different
  // page and jump. fit-page is handled by the store-sync effect below.
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
    if (zoomMode === "fit-page") return; // applyScale owns this re-anchor
    if (scrollToPage !== null || resumeTargetRef.current) return; // resume owns the scroll
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
  }, [baselineWidth, zoomMode, scrollToPage, pageOffsets, getPageHeight, docId]);

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
  }, [scrollTop, pageOffsets, getPageHeight, containerHeight, setScrollOffset, docId]);

  // Sync the live tray scale to the store's zoom mode/level (persisted
  // intent: fit-width, fit-page, or custom). Runs on doc open, container
  // resize, and toolbar zoom actions.
  //
  // lastAppliedRef records what we last drove. Without it a getPageHeight
  // identity change (fires whenever a page reports new dims) re-runs this
  // mid-gesture and snaps liveScale back to the mode target ("near 100%
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
    const page1Dims = dimensions.get(1);
    const page1Width =
      page1Dims && Number.isFinite(page1Dims.width) && page1Dims.width > 0
        ? page1Dims.width
        : 0;

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
    dimensions,
  ]);

  const handlePageRenderSuccess = useCallback((pageNum: number) => {
    const el = containerRef.current;
    if (!el) return;
    const pageEl = el.querySelector(
      `[data-page-number="${pageNum}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    // rect is post-scale viewport px; divide by liveScale for tray-local size
    const scale = liveScaleRef.current || 1;
    const intrinsicW = rect.width / scale;
    const intrinsicH = rect.height / scale;
    setDimensions((prev) => {
      const cached = prev.get(pageNum);
      if (
        cached &&
        Math.abs(cached.width - intrinsicW) < 0.5 &&
        Math.abs(cached.height - intrinsicH) < 0.5
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(pageNum, { width: intrinsicW, height: intrinsicH });
      return next;
    });
  }, []);

  const handlePageRenderError = useCallback(
    (pageNum: number, error: Error) => {
      logError(`pdf:pageRenderError:page-${pageNum}:${docId ?? "?"}`, error);
    },
    [docId],
  );

  const documentOptions = useMemo(
    () => ({
      // CJK character maps for PDFs that reference them.
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      // base-14 fonts; without these, non-embedding PDFs shift text
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      // pdf.js 5 wasm decoders. Missing this, JPX-image PDFs throw
      // "JpxError: OpenJPEG failed to initialize" and render blank white.
      wasmUrl: "/pdf-assets/wasm/",
      // XFA forms, skip parsing for the textbooks/novels that don't use it
      enableXfa: false,
      // CSP-friendly, no eval
      isEvalSupported: false,
      // use OS-installed fonts when present instead of the bundled ones
      useSystemFonts: true,
    }),
    [],
  );

  if (!meta) return null;

  // Initial inline styles render at scale(1) / baseline width; the
  // store-sync effect runs before paint and pushes the correct scale via
  // applyScale. From then on imperative writes keep the DOM ahead of React.
  return (
    // Wrapper so ReadProgressStrip can position against the viewport instead
    // of scrolling away inside the scroll container.
    <div className="relative h-full w-full">
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-pdf-viewer
      data-active-viewer
      // pdfGutter recolours the space around the page. The page raster can't
      // be themed in place, so the gutter carries the sepia/dark-mode feel.
      style={{
        touchAction: "pan-x pan-y",
        backgroundColor: getReaderPalette(readerTheme).pdfGutter,
        // Standard scrollbar props (not the global ::-webkit-scrollbar rule):
        // the tray's transform:scale makes this a GPU-composited scroller,
        // and the compositor ignores the -webkit pseudo (falling back to the
        // fat OS bar mid-scroll) but does honour scrollbar-width/color.
        scrollbarWidth: "thin",
        scrollbarColor: "var(--color-glass-border) transparent",
        // Disable native scroll-anchoring: in a virtualized scroller its
        // scrollTop adjustments fight both the user's drag and our math.
        overflowAnchor: "none",
      }}
      className="h-full w-full overflow-auto"
    >
      <Document
        file={meta.fileUrl}
        loading={
          <div className="flex items-center justify-center h-full gap-2 text-text-secondary">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading PDF...</span>
          </div>
        }
        error={
          <div className="text-danger text-sm p-4 text-center">
            Failed to load PDF. The file may be corrupted.
          </div>
        }
        onLoadError={(error) =>
          logError(`pdf:documentLoadError:${docId ?? "?"}`, error)
        }
        onSourceError={(error) =>
          logError(`pdf:documentSourceError:${docId ?? "?"}`, error)
        }
        options={documentOptions}
      >
        {/* Centers the sizer when narrower, scrolls horizontally when wider.
            `safe center` is required: plain `center` makes an overflowing
            sizer bleed both sides but overflow-auto only exposes the right,
            leaving the left unreachable. `safe center` falls back to `start`. */}
        <div
          style={{
            display: "flex",
            justifyContent: "safe center",
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          {/* Sizer dims are set imperatively, not via JSX style, so gesture
              re-renders don't overwrite the scaled size with unscaled JSX
              values and snap the visual back to 1x. */}
          <div
            ref={sizerRef}
            style={{
              flexShrink: 0,
              position: "relative",
            }}
          >
            <div
              ref={trayRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: baselineWidth,
                height: totalContentHeight,
                transformOrigin: "0 0",
                transform: "scale(1)",
                // Page tint precedence: theme's pdfPageFilter first (dark
                // theme inverts + hue-rotates), else the pdfInvertColors toggle.
                filter:
                  getReaderPalette(readerTheme).pdfPageFilter ??
                  (invertColors ? "invert(1) hue-rotate(180deg)" : undefined),
              }}
            >
              {renderedPages.map((pageNum) => (
                <PageSlot
                  key={pageNum}
                  pageNum={pageNum}
                  offsetTop={pageOffsets[pageNum - 1]}
                  pageWidth={baselineWidth}
                  pageHeight={getPageHeight(pageNum)}
                  renderWidth={renderWidth}
                  rotation={rotation}
                  onRenderSuccess={handlePageRenderSuccess}
                  onRenderError={handlePageRenderError}
                />
              ))}
            </div>
          </div>
        </div>
      </Document>
      <AnnotationContextMenu />
      <CommentPopover />
    </div>
      <ReadProgressStrip />
    </div>
  );
}
