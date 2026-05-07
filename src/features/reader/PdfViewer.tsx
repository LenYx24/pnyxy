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
import { useTextSelection } from "@/hooks/use-text-selection";
import { HighlightLayer } from "./HighlightLayer";
import { SearchHighlightLayer } from "./SearchHighlightLayer";
import { CommentMarkers } from "./CommentMarkers";
import { AnnotationContextMenu } from "./AnnotationContextMenu";
import { CommentPopover } from "./CommentPopover";
import {
  registerPinchTarget,
  clearPinchTransform,
  beginPinch,
  updatePinch,
  endPinch,
} from "./pinch-zoom-controller";
import { Loader2 } from "lucide-react";

interface PageSlotProps {
  pageNum: number;
  offsetTop: number;
  pageHeight: number;
  /** Visible width of the page on screen — drives layout / virtual
   *  scroll positioning. For fit-width this is `containerWidth - 48`;
   *  for custom zoom this scales with zoomLevel. */
  effectivePageWidth: number;
  /** Width at which react-pdf actually rasterises the canvas.
   *  *Constant* for a given container size — set to ~1.5× the
   *  fit-width baseline so every zoom level can be reached by CSS
   *  transform on the slot below, never by re-rasterisation. The
   *  page is rasterised once when it first scrolls into view and
   *  re-rasterised only when the container itself resizes. This is
   *  the trick that makes zoom flash-free and pinch-instant
   *  (Google Maps / Chrome built-in PDF viewer style): displayed
   *  scale is purely a CSS multiplier on the rasterised canvas. */
  effectiveRenderWidth: number;
  /** Rotation in degrees (0/90/180/270). Forwarded to react-pdf so
   *  the rasterized canvas comes back already rotated; the page's
   *  viewport width/height are swapped for 90°/270°, which the
   *  outer layout consumes via `getPageHeight`. */
  rotation: 0 | 90 | 180 | 270;
  onRenderSuccess: (pageNum: number) => void;
}

// Renders one virtualized page + its overlay layers. Memoized so a scroll-
// driven parent re-render doesn't redraw every visible page; only pages
// whose primitive props actually change re-render.
const PageSlot = memo(function PageSlot({
  pageNum,
  offsetTop,
  pageHeight,
  effectivePageWidth,
  effectiveRenderWidth,
  rotation,
  onRenderSuccess,
}: PageSlotProps) {
  // Always pass `width` to react-pdf — the render width is constant
  // for a given container, so a height-driven fit-page mode just
  // means the slot's display width is smaller than the rendered
  // width, which the CSS transform below handles uniformly. We don't
  // use the height prop anywhere now: every mode boils down to "page
  // is rasterised at renderWidth, then CSS-scaled to displayWidth".
  const pageProps =
    effectiveRenderWidth > 0
      ? { width: effectiveRenderWidth }
      : { width: undefined };

  // visualScale = displayWidth / renderWidth.
  //   = 1 only by coincidence (when zoomLevel happens to land at the
  //     constant render baseline).
  //   > 1 when the user has zoomed in past the render baseline
  //     — text gets soft when this exceeds ~1.4 and we should bump
  //     the render baseline; out of scope here, the v2 lever.
  //   < 1 most of the time at fit-width — the canvas is rasterised
  //     larger than displayed, so text stays crisp.
  // transform-origin "top center" so the slot's top edge stays anchored
  // at offsetTop and horizontal centering is preserved (the slot's
  // outer flex container centers the inner box pre-transform; without
  // this origin the visual would drift right of center after scale).
  const useTransform =
    effectiveRenderWidth > 0 &&
    Math.abs(effectivePageWidth - effectiveRenderWidth) > 0.5;
  const visualScale = useTransform
    ? effectivePageWidth / effectiveRenderWidth
    : 1;

  return (
    <div
      style={{
        position: "absolute",
        top: offsetTop,
        left: 0,
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          transform: useTransform ? `scale(${visualScale})` : undefined,
          transformOrigin: useTransform ? "top center" : undefined,
          // Hint the compositor so the in-flight CSS scale runs on
          // the GPU layer and stays smooth.
          willChange: useTransform ? "transform" : undefined,
        }}
      >
        <Page
          pageNumber={pageNum}
          rotate={rotation}
          {...pageProps}
          loading={
            <div
              className="flex items-center justify-center gap-2 text-text-secondary"
              style={{ height: pageHeight, width: effectivePageWidth }}
            >
              <Loader2 size={16} className="animate-spin" />
            </div>
          }
          onRenderSuccess={() => onRenderSuccess(pageNum)}
        />
        <HighlightLayer pageNum={pageNum} />
        <SearchHighlightLayer pageNum={pageNum} />
        <CommentMarkers pageNum={pageNum} />
      </div>
    </div>
  );
});

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const PAGE_GAP = 12;
const A4_RATIO = 1.4142; // height/width for A4

// First index `i` in a sorted ascending array where arr[i] > target.
// Returns arr.length if no such element exists.
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

// Removed `smoothScrollTo` helper. Programmatic scrolls (resume,
// TOC nav, page input, citation jumps) now snap instantly — the
// 300 ms ease was just a delay, and on initial doc-open it could
// land on the wrong scroll position when virtualized pages rendered
// at different heights than the A4 estimates the animation was
// targeting. The resume-target re-snap loop in PdfViewer handles
// the layout-settle case directly.

interface PageDimensions {
  width: number;
  height: number;
}

interface PdfViewerProps {
  documentId?: string;
}

export function PdfViewer({ documentId }: PdfViewerProps) {
  // If no documentId passed, use active document
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");

  const setCurrentPage = useReaderStore((s) => s.setCurrentPage);
  const setScrollOffset = useReaderStore((s) => s.setScrollOffset);
  const clearScrollRequest = useReaderStore((s) => s.clearScrollRequest);
  const commitLiveZoom = useReaderStore((s) => s.commitLiveZoom);

  const meta = doc?.meta ?? null;
  const totalPages = doc?.totalPages ?? 0;
  const zoomMode = doc?.zoomMode ?? "fit-width";
  const zoomLevel = doc?.zoomLevel ?? 100;
  const rotation = doc?.pageRotation ?? 0;
  const scrollToPage = doc?.scrollToPage ?? null;
  const invertColors = useSettingsStore((s) => s.pdfInvertColors);
  // Throttle "report current scroll fraction to the store" so user
  // scrolling doesn't fire 60 state updates / sec.
  const offsetReportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pinchTargetRef = useRef<HTMLDivElement>(null);
  useTextSelection(containerRef);

  // Hand the inner page-tray DOM node to the pinch controller so the
  // mobile gesture handler can drive transforms imperatively (no React
  // re-renders during the pinch).
  useEffect(() => {
    registerPinchTarget(pinchTargetRef.current);
    return () => registerPinchTarget(null);
  }, []);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const dimensionsRef = useRef<Map<number, PageDimensions>>(new Map());
  // dimensionsRef is a *ref* (writes don't trigger re-render) so a
  // bare write in handlePageRenderSuccess doesn't cause pageOffsets
  // to recompute — the layout stays at A4 estimates forever. This
  // counter is bumped whenever a render lands new dims, and is
  // included in getPageHeight's deps so the layout pipeline picks
  // up the correction. Without it, scrollToPage on doc open lands
  // at an estimated offset and stays there even after the target
  // page renders with its real height.
  const [dimsVersion, setDimsVersion] = useState(0);
  const rafRef = useRef<number>(0);
  // Tracks the previous zoom snapshot. We also stash the prior
  // `effectivePageWidth` so that on a zoom step we can scale cached
  // page dimensions proportionally instead of clearing them — which
  // is the cure for the "blink" where pages briefly collapsed to
  // 0 height while react-pdf re-rasterised at the new scale.
  const prevZoomRef = useRef({
    zoomMode,
    zoomLevel,
    effectivePageWidth: 0,
  });
  const anchorRef = useRef<{ page: number; fraction: number } | null>(null);
  // When the user zooms via Ctrl+wheel / trackpad pinch on desktop,
  // we want the same tray-content point under the cursor to stay
  // under the cursor after the zoom — Google PDF / Maps behavior.
  // We can't anchor by raw tray-relative pixels: PAGE_GAP (12 px) is
  // a fixed constant that *doesn't* scale with zoom, so cumulative
  // tray-Y coordinates don't scale uniformly — by page N the math
  // is off by ≈ N × 12 px. Anchor by (page index, fraction inside
  // the page) instead — that goes through the same getPageHeight +
  // pageOffsets pipeline that drives layout, so it's correct even
  // with PAGE_GAP, tray centering, or any other layout quirk.
  const cursorAnchorRef = useRef<{
    pageIdx: number;
    pageFraction: number;
    xFraction: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);
  // Resume target tracker. Set on a scrollToPage event; consumed by
  // the resume-restore useLayoutEffect, which re-snaps scrollTop as
  // virtualized pages render and their real heights replace the
  // initial A4 estimates. Cleared by user scroll input or watchdog
  // expiry, so we don't fight a manual scroll mid-window.
  const resumeTargetRef = useRef<{
    page: number;
    offset: number;
    expiresAt: number;
  } | null>(null);
  // Debug visualization of the cursor-pivot anchor. Each wheel-zoom
  // pulse paints a tiny red dot at the captured cursor position; the
  // user can compare it to where they actually wheel-zoomed and tell
  // us if the anchor's drifting. The `seq` field forces a re-render
  // even when the user repeatedly zooms at the *same* coords — the
  // dot key changes, the fade animation restarts. Remove the dot
  // (`debugDotSeqRef`, `setDebugZoomDot`, the JSX) once the offset
  // is understood.
  const [debugZoomDot, setDebugZoomDot] = useState<{
    x: number;
    y: number;
    seq: number;
  } | null>(null);
  const debugDotSeqRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  // Rotation snapshot — when this changes, every cached page
  // dimension is stale (90°/270° swaps width/height; 0°/180° keeps
  // the bounding box but the raster still has to come back). Clear
  // the cache so handlePageRenderSuccess re-measures.
  const prevRotationRef = useRef(rotation);
  useLayoutEffect(() => {
    if (prevRotationRef.current === rotation) return;
    dimensionsRef.current.clear();
    prevRotationRef.current = rotation;
  }, [rotation]);

  // Track container size — debounced to prevent flicker during panel resize
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerWidth(el.clientWidth);
    setContainerHeight(el.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Debounce: only commit new dimensions after resize settles
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }, 150);
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(resizeTimerRef.current);
    };
  }, []);

  // Ctrl+wheel cursor-pivot zoom — Google PDF / Maps style.
  // ctrlKey also fires on trackpad pinch (macOS / Windows report
  // pinch as a synthetic ctrl+wheel), so the same path handles mouse
  // wheel + Ctrl and trackpad pinch. Attached as a native listener
  // with passive:false so preventDefault actually stops browser-level
  // page zoom — React's onWheel is passive by default.
  //
  // **Imperative-during-gesture, commit-on-settle.** This is the
  // "Option A" architecture from the snappiness writeup. Each wheel
  // event accumulates `accumScale` and applies a CSS transform
  // directly to the page tray DOM via the pinch-zoom-controller —
  // *no React state change, no re-render*. After 150 ms of no wheel
  // events, the gesture commits via commitLiveZoom: React renders
  // the new zoomLevel once, the existing zoom-change useLayoutEffect
  // clears the imperative transform, and the cursor-pivot scroll
  // adjusts so the same content stays under the cursor. Total React
  // work per gesture: one render, regardless of how many wheel
  // events fired. Should be at-or-near native PDF viewer feel.
  //
  // The pinch controller already has the begin/update/end DOM
  // surface for this — desktop wheel just drives it from a different
  // event source than the mobile touch handler.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Per-gesture state. Lives across wheel events while the gesture
    // is active; reset on settle commit.
    let active = false;
    let accumScale = 1;
    let focalX = 0;
    let focalY = 0;
    let anchor: {
      pageIdx: number;
      pageFraction: number;
      xFraction: number;
    } | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let baseDisplayWidth = 0;
    // rAF-coalesce updatePinch so fast trackpad pinches (which can
    // fire 60+ wheel events / sec) don't slam the compositor with
    // multiple style writes per frame. Each event accumulates the
    // scale; one rAF callback flushes the latest value to the DOM.
    let updatePending = false;
    const flushUpdate = () => {
      updatePending = false;
      if (!active) return;
      updatePinch(accumScale, focalX, focalY);
    };
    const scheduleUpdate = () => {
      if (updatePending) return;
      updatePending = true;
      requestAnimationFrame(flushUpdate);
    };

    const settle = () => {
      settleTimer = null;
      if (!active) return;
      const final = endPinch();
      active = false;
      if (!anchor) return;
      // Hand the captured cursor anchor to the zoom-change
      // useLayoutEffect, which will use it for the post-commit scroll
      // pivot. Without this, the existing useLayoutEffect would fall
      // back to the page-fraction anchor (viewport-center based).
      cursorAnchorRef.current = {
        pageIdx: anchor.pageIdx,
        pageFraction: anchor.pageFraction,
        xFraction: anchor.xFraction,
        viewportX: focalX,
        viewportY: focalY,
      };
      anchor = null;
      // Debug pulse on commit (one per gesture instead of one per
      // wheel event — easier to read at fast pinch speeds).
      setDebugZoomDot({ x: focalX, y: focalY, seq: debugDotSeqRef.current++ });
      // commitLiveZoom multiplies current zoomLevel by the gesture
      // scale, and accepts the pre-gesture displayed width so it can
      // compute the post-commit zoomLevel correctly even when the
      // gesture started in fit-width / fit-page mode.
      commitLiveZoom(
        final.scale,
        docId ?? undefined,
        final.startWidth || baseDisplayWidth,
      );
      accumScale = 1;
    };

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) {
        // Non-zoom wheel = regular scroll. Mouse wheels fire large
        // stepped deltas (typically ±100 px per detent on Linux/Win,
        // ±120 on Windows, ±~166 with line-mode); trackpads fire
        // many small smooth deltas (often <30) and feel right with
        // browser-default speed. Boost the mouse-wheel case so a
        // single detent moves further down the page — matches the
        // user's "make my wheel scroll more" ask without making
        // trackpad scrolling overly twitchy.
        if (Math.abs(e.deltaY) >= 40) {
          e.preventDefault();
          el.scrollBy({
            top: e.deltaY * 2.5,
            left: e.deltaX * 2.5,
            behavior: "auto",
          });
        }
        return;
      }
      e.preventDefault();
      const tray = pinchTargetRef.current;
      if (!tray) return;

      if (!active) {
        // First event of a gesture: capture anchor + start the
        // imperative pinch. The pinch controller sets transform-
        // origin at (focalX, focalY) on the tray; subsequent
        // updatePinch calls scale around that point.
        const trayRect = tray.getBoundingClientRect();
        const cursorTrayX = e.clientX - trayRect.left;
        const cursorTrayY = e.clientY - trayRect.top;
        const offsets = pageOffsetsRef.current;
        const heightFor = pageHeightRef.current;
        const pageIdx =
          offsets.length > 0
            ? Math.max(
                0,
                Math.min(
                  offsets.length - 1,
                  upperBound(offsets, cursorTrayY) - 1,
                ),
              )
            : 0;
        const pageStart = offsets[pageIdx] ?? 0;
        const pageHeight = heightFor(pageIdx + 1) || 1;
        // Clamp the captured fractions to [0, 1]. When the tray is
        // narrower than the container (margin: 0 auto centering),
        // the cursor can land in the empty gutter outside the tray
        // — raw cursorTrayX would be negative or > trayWidth, making
        // the post-zoom anchor a "ghost" point outside the actual
        // content. After the zoom commit (especially crossing the
        // fit-width threshold where the tray flips from centered to
        // left-aligned), that ghost anchor used to snap the page to
        // the left edge. Clamping to [0, 1] anchors to the nearest
        // real edge of the tray instead — degraded but visually
        // consistent: zoom-near-left-gutter still pivots from the
        // tray's left edge rather than from empty space.
        anchor = {
          pageIdx,
          pageFraction: Math.max(
            0,
            Math.min(1, (cursorTrayY - pageStart) / pageHeight),
          ),
          xFraction:
            trayRect.width > 0
              ? Math.max(0, Math.min(1, cursorTrayX / trayRect.width))
              : 0.5,
        };
        focalX = e.clientX;
        focalY = e.clientY;
        baseDisplayWidth = trayRect.width;
        accumScale = 1;
        active = true;
        beginPinch(focalX, focalY);
      }

      // Multiplicative step per event. Range 0.85–1.15 per event
      // keeps a single mouse-wheel detent at about ±15 % visible
      // change; trackpad pinches accumulate smoothly because each
      // tiny event adds a tiny multiplier.
      const stepFactor = Math.exp(-e.deltaY * 0.005);
      const clampedStep = Math.max(0.85, Math.min(1.15, stepFactor));
      accumScale *= clampedStep;
      // Clamp the cumulative scale so we can't slingshot to 0.05× or
      // 50× over a long gesture.
      accumScale = Math.max(0.1, Math.min(10, accumScale));
      // Schedule one rAF-coalesced DOM write per frame, regardless
      // of how many wheel events arrived since the last frame.
      scheduleUpdate();

      // Reset the settle timer on every event. The gesture commits
      // 150 ms after the last wheel event — long enough that fast
      // continuous scrolling doesn't commit mid-gesture, short enough
      // that the user feels the crispness land promptly when they
      // stop.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, 150);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
      if (settleTimer) clearTimeout(settleTimer);
      // If a gesture was mid-flight at unmount, drop the imperative
      // transform so the next mount doesn't inherit a stale style.
      if (active) {
        endPinch();
        clearPinchTransform();
      }
    };
  }, [docId, commitLiveZoom]);

  // Compute effective page width based on zoom mode
  const effectivePageWidth = useMemo(() => {
    switch (zoomMode) {
      case "fit-width":
        return containerWidth > 0 ? containerWidth - 48 : 600;
      case "fit-page": {
        // Estimate width from target height; actual width depends on page aspect ratio
        const fitHeight = containerHeight > 0 ? containerHeight - 24 : 800;
        return fitHeight / A4_RATIO;
      }
      case "custom":
        return (600 * zoomLevel) / 100;
    }
  }, [zoomMode, zoomLevel, containerWidth, containerHeight]);

  // Constant rasterisation width: ~1.5× the fit-width baseline.
  // react-pdf rasterises each page to this width *once* (per
  // container size); every zoom level after that is reached by CSS
  // transform on the slot below, no re-rasterisation. This is the
  // trick that makes zoom and pinch flash-free — a previous version
  // tried debounced lazy-raster, which only delayed the flash from
  // mid-gesture to 250 ms post-gesture. The new approach simply
  // never re-rasterises during user zoom.
  //
  // The 1.5× multiplier is the quality / memory trade: at fit-width
  // the canvas is downscaled by CSS (crisp), and we have headroom to
  // ~150 % zoom before CSS upscaling starts visibly blurring text.
  // Above that the user can ask for a "render at current zoom"
  // refresh (future v2). Memory: a 1.5× page at A4 ≈ 7 MB; with
  // ~5 visible pages, ~35 MB peak — fine on every device we target.
  const RENDER_QUALITY_MULTIPLIER = 1.5;
  const effectiveRenderWidth = useMemo(() => {
    if (containerWidth <= 0) return 0;
    // The fit-width baseline (containerWidth - 48) is the smallest
    // sensible target and a stable anchor — it doesn't depend on
    // zoomLevel, so the rasterised canvas survives every zoom
    // change. Capped at 2400 px so an extra-wide window doesn't
    // pin a 3× canvas in memory; pages render plenty crisp at
    // 2400 even on a 4K screen.
    return Math.min(
      (containerWidth - 48) * RENDER_QUALITY_MULTIPLIER,
      2400,
    );
  }, [containerWidth]);

  // Estimate page height from cached dimensions or A4 ratio
  const getPageHeight = useCallback(
    (pageNum: number): number => {
      // In fit-page mode, height is fixed to the container
      if (zoomMode === "fit-page") {
        return containerHeight > 0 ? containerHeight - 24 : 800;
      }
      const cached = dimensionsRef.current.get(pageNum);
      if (cached) {
        const scale = effectivePageWidth / cached.width;
        return cached.height * scale;
      }
      return effectivePageWidth * A4_RATIO;
    },
    // dimsVersion is read implicitly via dimensionsRef — keeping it
    // in deps is what cascades a render-success → fresh getPageHeight
    // → fresh pageOffsets → re-snap of the resume scroll target.
    [effectivePageWidth, zoomMode, containerHeight, dimsVersion],
  );

  // Compute cumulative page offsets
  const pageOffsets = useMemo(() => {
    if (totalPages === 0) return [];
    const offsets: number[] = [0];
    for (let i = 1; i < totalPages; i++) {
      offsets.push(offsets[i - 1] + getPageHeight(i) + PAGE_GAP);
    }
    return offsets;
  }, [totalPages, getPageHeight]);

  // "useLatest" pattern: the wheel handler is attached once on
  // mount, but it needs to call into pageOffsets / getPageHeight
  // which are recomputed on every zoom. A ref tracks the current
  // render's values and the effect closure reads `current` at
  // gesture time. Updating `current` directly each render is the
  // standard pattern for this; react-hooks/immutability flags the
  // mutation, suppress with an explanatory comment.
  const pageOffsetsRef = useRef(pageOffsets);
  // eslint-disable-next-line react-hooks/immutability -- useLatest pattern; see above.
  pageOffsetsRef.current = pageOffsets;
  const pageHeightRef = useRef(getPageHeight);
  // eslint-disable-next-line react-hooks/immutability -- useLatest pattern; see above.
  pageHeightRef.current = getPageHeight;

  // Total content height
  const totalContentHeight = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return 0;
    return pageOffsets[totalPages - 1] + getPageHeight(totalPages) + PAGE_GAP;
  }, [totalPages, pageOffsets, getPageHeight]);

  // Determine visible pages based on scroll position (virtualization)
  const [scrollTop, setScrollTop] = useState(0);

  // Track scroll velocity (px/ms) so we can dynamically widen the
  // render window during a fast fling / middle-click drag. Without
  // this the user sees blank pages for a brief moment because the
  // static 1+2 overscan can't keep up with a 5000+ px/sec scroll.
  // The velocity peaks while the user is dragging and decays back
  // to zero a few hundred ms after they stop — at which point the
  // overscan returns to its calm-reading default.
  const [scrollVelocity, setScrollVelocity] = useState(0);
  const lastScrollSampleRef = useRef<{ y: number; t: number } | null>(null);
  const velocityDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const visiblePages = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return [];

    // Calm reading (default): 1 viewport above, 2 below. Reading
    // goes downward, so the static prefetch is biased that way.
    // Fast scroll: when velocity exceeds ~1.5 px/ms (a fling, a
    // middle-click drag, a Page-Down spam) we expand to 4 viewports
    // in the scroll direction. Pages enter the render queue ahead
    // of the scroll instead of having to catch up.
    const fastScroll = scrollVelocity > 1.5;
    const aheadFactor = fastScroll
      ? Math.min(6, 2 + scrollVelocity * 0.8) // grows with velocity, capped
      : 2;
    // Direction: +scrollVelocity = scrolling down, -scrollVelocity = up.
    // We expand on the side the user is heading toward.
    const goingDown = scrollVelocity >= 0;
    const aboveFactor = goingDown ? 1 : aheadFactor;
    const belowFactor = goingDown ? aheadFactor : 1;
    const viewportTop = scrollTop - containerHeight * aboveFactor;
    const viewportBottom = scrollTop + containerHeight * (1 + belowFactor);

    // Binary search for the first page that could overlap the viewport.
    // pageOffsets is sorted ascending; first page with top > viewportTop
    // is the upper bound, so the candidate first visible page is one before.
    const ub = upperBound(pageOffsets, viewportTop);
    let startIdx = Math.max(0, ub - 1);
    // The page just before may not actually overlap (if its bottom < viewportTop).
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
  ]);

  // Pages to keep rendered specifically because the user just asked
  // to *jump* there (TOC click, page input, bookmark, search hit).
  // Without this, the target page only enters `visiblePages` AFTER
  // the scroll animation lands — the user sees blank space mid-jump
  // while pdf.js catches up. Adding the target ± 1 to the render
  // tree the moment `scrollToPage` is set kicks the render off in
  // parallel with the smooth-scroll animation, so the page is ready
  // (or nearly so) when the scroll arrives.
  const jumpPrefetchPages = useMemo(() => {
    if (scrollToPage === null) return new Set<number>();
    const set = new Set<number>();
    for (let p = scrollToPage - 1; p <= scrollToPage + 1; p++) {
      if (p >= 1 && p <= totalPages) set.add(p);
    }
    return set;
  }, [scrollToPage, totalPages]);

  // Final render list: visible pages ∪ jump prefetch. Sorted so the
  // DOM order stays stable as visibility changes (prevents flicker).
  const renderedPages = useMemo(() => {
    if (jumpPrefetchPages.size === 0) return visiblePages;
    const set = new Set(visiblePages);
    for (const p of jumpPrefetchPages) set.add(p);
    return Array.from(set).sort((a, b) => a - b);
  }, [visiblePages, jumpPrefetchPages]);

  // Scroll handler — RAF-throttled, updates current page
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const st = el.scrollTop;
      setScrollTop(st);

      // User-initiated scroll mid-resume cancels the resume target —
      // the user has overridden where they want to be, and we
      // shouldn't keep re-snapping them back to the saved position.
      if (!programmaticScrollRef.current) {
        resumeTargetRef.current = null;
      }

      // Sample velocity from the last position+timestamp pair. Sign
      // is preserved (+ = scrolling down, − = up) so the overscan
      // can extend on the side the user is heading toward. Decay
      // back to zero 250ms after the last scroll event so the
      // prefetch window relaxes when the user stops.
      const now = performance.now();
      const prev = lastScrollSampleRef.current;
      if (prev) {
        const dt = now - prev.t;
        if (dt > 0) {
          const dy = st - prev.y;
          // Dampen with the previous reading so a single jittery
          // sample doesn't flap the overscan.
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

      // Skip page detection during programmatic scrolls to avoid feedback loops
      if (programmaticScrollRef.current) return;

      // Find page whose center is closest to viewport center.
      // Binary-search the page that contains the viewport center, then
      // also check its neighbour above for the actual closest center.
      if (pageOffsets.length === 0) return;
      const viewportCenter = st + containerHeight / 2;
      const ub = upperBound(pageOffsets, viewportCenter);
      const containingIdx = Math.max(0, ub - 1);
      const candidates =
        containingIdx + 1 < pageOffsets.length
          ? [containingIdx, containingIdx + 1]
          : [containingIdx];

      let closestPage = candidates[0] + 1;
      let closestDist = Infinity;
      for (const idx of candidates) {
        const pageCenter = pageOffsets[idx] + getPageHeight(idx + 1) / 2;
        const dist = Math.abs(pageCenter - viewportCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = idx + 1;
        }
      }

      setCurrentPage(closestPage, docId ?? undefined);
    });
  }, [containerHeight, pageOffsets, getPageHeight, setCurrentPage, docId]);

  // Read scroll settings
  // Scroll-to-page effect — fires for both initial doc-open resume
  // and explicit navigation (TOC / page input / search hit / chat
  // citation). Always instant: the user's mental model is "I'm
  // continuing from where I was" or "take me to page X" — a 300 ms
  // smooth animation is just delay either way, and on initial open
  // it can land at the wrong scrollTop because virtualized pages
  // haven't rendered yet, so pageOffsets is built from A4 estimates.
  // The resume-target tracker below catches that case: pages render,
  // their real heights replace the estimates, the layout shifts, we
  // re-snap to keep the user on the page they asked for.
  useEffect(() => {
    if (scrollToPage === null || pageOffsets.length === 0) return;
    const el = containerRef.current;
    if (!el) return;

    const pageTop = pageOffsets[scrollToPage - 1];
    if (pageTop !== undefined) {
      // Pixel-precise resume: add `scrollOffset * pageHeight` so we
      // land exactly where the user left off, not just the page top.
      // Read the offset imperatively at fire time — having it as a
      // reactive dep would re-trigger this scroll effect every time
      // the user scrolls. The store resets scrollOffset to 0 on
      // imperative navigation (TOC click / next / prev / goToPage)
      // so this only adjusts on the very first scroll after open.
      const pageHeight = getPageHeight(scrollToPage);
      const offset =
        useReaderStore.getState().documents.get(docId ?? "")?.scrollOffset ?? 0;
      const targetOffset = pageTop + offset * pageHeight;

      programmaticScrollRef.current = true;
      el.scrollTop = targetOffset;
      setScrollTop(targetOffset);
      // Release programmatic flag promptly — instant scroll settles
      // in the same paint frame.
      setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 50);

      // Track this as a resume target. The re-snap useLayoutEffect
      // below picks up every pageOffsets change within the watchdog
      // window and corrects scrollTop to keep the user on the
      // intended page. Cleared by user scroll input (so a manual
      // scroll mid-window wins) or by watchdog expiry.
      resumeTargetRef.current = {
        page: scrollToPage,
        offset,
        expiresAt: Date.now() + 2000,
      };
    }
    clearScrollRequest(docId ?? undefined);
  }, [scrollToPage, pageOffsets, clearScrollRequest, docId, getPageHeight]);

  // Re-snap on layout settle. As virtualized pages render and their
  // real heights replace the A4 estimates, pageOffsets recomputes and
  // this fires; we move scrollTop so the resume target page stays at
  // the same fractional position. Watchdog-bounded so we don't
  // overpower the user's intent later in the session.
  useLayoutEffect(() => {
    const target = resumeTargetRef.current;
    if (!target) return;
    if (Date.now() > target.expiresAt) {
      resumeTargetRef.current = null;
      return;
    }
    const el = containerRef.current;
    if (!el || pageOffsets.length === 0) return;
    const pageTop = pageOffsets[target.page - 1];
    if (pageTop === undefined) return;
    const pageHeight = getPageHeight(target.page);
    const desired = pageTop + target.offset * pageHeight;
    if (Math.abs(el.scrollTop - desired) <= 1) return;
    programmaticScrollRef.current = true;
    el.scrollTop = desired;
    setScrollTop(desired);
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 50);
  }, [pageOffsets, getPageHeight]);

  // Save anchor before zoom changes (on every scroll update). Same
  // (page, fraction) pair feeds the resume-state cloud sync via a
  // throttled report — we re-use the anchor math instead of computing
  // it twice.
  useEffect(() => {
    if (pageOffsets.length === 0 || containerHeight === 0) return;
    const viewportCenter = scrollTop + containerHeight / 2;
    const idx = Math.max(0, upperBound(pageOffsets, viewportCenter) - 1);
    const pageTop = pageOffsets[idx];
    const pageHeight = getPageHeight(idx + 1);
    if (viewportCenter >= pageTop && viewportCenter <= pageTop + pageHeight) {
      const fraction = (viewportCenter - pageTop) / pageHeight;
      anchorRef.current = { page: idx + 1, fraction };
      // Skip during programmatic scrolls (initial resume / TOC jump
      // / smooth-scroll-to-page) so we don't overwrite the just-
      // restored offset with whatever transient value the smooth
      // animation passes through.
      if (!programmaticScrollRef.current) {
        if (offsetReportTimerRef.current) clearTimeout(offsetReportTimerRef.current);
        offsetReportTimerRef.current = setTimeout(() => {
          setScrollOffset(fraction, docId ?? undefined);
        }, 250);
      }
    }
  }, [scrollTop, pageOffsets, getPageHeight, containerHeight, setScrollOffset, docId]);

  // On zoom change, instead of *clearing* cached page dimensions
  // (which collapses every page slot to 0 height for the frame between
  // "user clicked zoom" and "react-pdf finished re-rasterising"), we
  // SCALE the cached dims by the size ratio. Layout stays consistent;
  // pages render at the new resolution under the same scaffolding,
  // and the user sees a smooth transition instead of the blank flash.
  // `handlePageRenderSuccess` overwrites each entry with the real
  // measured size as the new render lands, correcting any sub-pixel
  // drift from the proportional scale.
  useLayoutEffect(() => {
    const prev = prevZoomRef.current;
    const zoomChanged =
      prev.zoomMode !== zoomMode || prev.zoomLevel !== zoomLevel;

    if (zoomChanged) {
      // User-driven zoom overrides the post-open resume window —
      // without clearing this, the resume re-snap useLayoutEffect
      // fires on the same pageOffsets recompute and yanks the user
      // back to the saved page, fighting the cursor-pivot scroll.
      // Symptom: every other zoom tick "snaps to page 1" before the
      // next tick zooms again. The user's zoom intent wins.
      resumeTargetRef.current = null;
      const ratio =
        prev.effectivePageWidth > 0 && effectivePageWidth > 0
          ? effectivePageWidth / prev.effectivePageWidth
          : 0;
      if (ratio > 0 && Math.abs(ratio - 1) > 0.001) {
        const next = new Map<number, PageDimensions>();
        for (const [page, dim] of dimensionsRef.current) {
          next.set(page, {
            width: dim.width * ratio,
            height: dim.height * ratio,
          });
        }
        dimensionsRef.current = next;
      } else if (ratio === 0) {
        // No prior baseline (component just mounted) — clearing is
        // safer than keeping stale dims.
        dimensionsRef.current.clear();
      }

      // Cursor-pivot scroll: takes precedence over the page-fraction
      // anchor when this zoom step came from Ctrl+wheel / trackpad
      // pinch. We captured (pageIdx, pageFraction, xFraction, viewportX,
      // viewportY) before commit. After React's commit, pageOffsets
      // and getPageHeight reflect the new zoom. Rebuild the cursor's
      // tray-Y from those (correct even with the constant-pixel
      // PAGE_GAP, which a raw-pixel tray-Y × ratio would mis-handle),
      // measure the tray's new viewport rect, and adjust scroll so
      // the same content point lands back where the cursor is.
      const cursorAnchor = cursorAnchorRef.current;
      if (
        cursorAnchor &&
        containerRef.current &&
        pinchTargetRef.current &&
        pageOffsets.length > 0
      ) {
        cursorAnchorRef.current = null;
        const trayRectAfter = pinchTargetRef.current.getBoundingClientRect();
        const newPageStart =
          pageOffsets[Math.min(cursorAnchor.pageIdx, pageOffsets.length - 1)] ??
          0;
        const newPageHeight = getPageHeight(cursorAnchor.pageIdx + 1);
        const newTrayY = newPageStart + cursorAnchor.pageFraction * newPageHeight;
        const newTrayX = cursorAnchor.xFraction * trayRectAfter.width;
        const newCursorViewportX = trayRectAfter.left + newTrayX;
        const newCursorViewportY = trayRectAfter.top + newTrayY;
        const dx = newCursorViewportX - cursorAnchor.viewportX;
        const dy = newCursorViewportY - cursorAnchor.viewportY;
        containerRef.current.scrollLeft += dx;
        containerRef.current.scrollTop += dy;
        setScrollTop(containerRef.current.scrollTop);
      } else if (
        anchorRef.current &&
        containerRef.current &&
        pageOffsets.length > 0
      ) {
        const { page, fraction } = anchorRef.current;
        const pageIdx = page - 1;
        if (pageIdx >= 0 && pageIdx < pageOffsets.length) {
          const newPageHeight = getPageHeight(page);
          const targetScroll =
            pageOffsets[pageIdx] +
            fraction * newPageHeight -
            containerHeight / 2;
          containerRef.current.scrollTop = Math.max(0, targetScroll);
          setScrollTop(containerRef.current.scrollTop);
        }
      }
      // The pinch controller may have left a tray-level transform on
      // the DOM if the zoom change came from a touch gesture. Now
      // that React has committed the new per-slot transforms (which
      // produce the same visual scale via a different anchor), drop
      // the gesture transform in the same paint frame — that's what
      // makes the swap from gesture-time to settled-state continuous
      // without a "no-scale" flash. Safe no-op when no pinch was
      // active (toolbar / keyboard zooms).
      clearPinchTransform();
      prevZoomRef.current = { zoomMode, zoomLevel, effectivePageWidth };
    } else if (
      prev.effectivePageWidth !== effectivePageWidth &&
      effectivePageWidth > 0
    ) {
      // Zoom didn't change, but the effective page width did (most
      // commonly: the very first valid containerWidth measurement, or
      // a panel resize). Keep the baseline up to date so the *next*
      // zoom change has a ratio to work with — without this, the
      // first-ever zoom click after open would always fall through
      // to the clear-and-rerender path.
      prevZoomRef.current = { zoomMode, zoomLevel, effectivePageWidth };
    }
  }, [
    zoomMode,
    zoomLevel,
    effectivePageWidth,
    pageOffsets,
    getPageHeight,
    containerHeight,
  ]);

  // Handle page render success — cache dimensions and bump
  // dimsVersion so the layout pipeline picks up the real heights.
  // Skip the bump when the new dims are within 0.5 px of the old
  // ones; saves a redundant pageOffsets recompute on jitter / sub-
  // pixel rounding from re-renders that don't actually change the
  // rasterised size.
  const handlePageRenderSuccess = useCallback((pageNum: number) => {
    const el = containerRef.current;
    if (!el) return;
    const pageEl = el.querySelector(
      `[data-page-number="${pageNum}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    const cached = dimensionsRef.current.get(pageNum);
    const changed =
      !cached ||
      Math.abs(cached.width - rect.width) > 0.5 ||
      Math.abs(cached.height - rect.height) > 0.5;
    if (!changed) return;
    dimensionsRef.current.set(pageNum, {
      width: rect.width,
      height: rect.height,
    });
    setDimsVersion((v) => v + 1);
  }, []);

  const documentOptions = useMemo(
    () => ({ cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true }),
    [],
  );

  if (!meta) return null;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      data-pdf-viewer
      data-active-viewer
      // touch-action: pan-x pan-y allows native scroll on BOTH
      // axes (so a zoomed-in PDF can be panned horizontally with
      // one finger like a map) while still blocking the browser's
      // native pinch-zoom — pinch is `pinch-zoom`, not part of
      // pan-*, so it stays disabled and our two-finger handler in
      // the parent viewerRef can drive the pinch controller instead.
      style={{ touchAction: "pan-x pan-y" }}
      className="h-full w-full overflow-auto bg-bg-primary"
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
          <div className="text-red-400 text-sm p-4 text-center">
            Failed to load PDF. The file may be corrupted.
          </div>
        }
        options={documentOptions}
      >
        <div
          ref={pinchTargetRef}
          style={{
            height: totalContentHeight,
            position: "relative",
            width: zoomMode === "fit-page" ? "100%" : effectivePageWidth,
            margin: "0 auto",
            // Night mode: invert the rasterized canvas + hue-rotate so
            // image colors are roughly preserved (the second filter
            // cancels the inversion's hue shift). The transform on
            // this same div lives on `style.transform` and is set
            // imperatively by the pinch controller, so the two don't
            // conflict.
            filter: invertColors
              ? "invert(1) hue-rotate(180deg)"
              : undefined,
          }}
        >
          {renderedPages.map((pageNum) => (
            <PageSlot
              key={pageNum}
              pageNum={pageNum}
              offsetTop={pageOffsets[pageNum - 1]}
              pageHeight={getPageHeight(pageNum)}
              effectivePageWidth={effectivePageWidth}
              effectiveRenderWidth={effectiveRenderWidth}
              rotation={rotation}
              onRenderSuccess={handlePageRenderSuccess}
            />
          ))}
        </div>
      </Document>
      <AnnotationContextMenu />
      <CommentPopover />
      {debugZoomDot && (
        <DebugZoomDot
          key={debugZoomDot.seq}
          x={debugZoomDot.x}
          y={debugZoomDot.y}
          onExpire={() => setDebugZoomDot(null)}
        />
      )}
    </div>
  );
}

/** Temporary visualization for the cursor-pivot anchor. The dot
 *  appears at the captured viewport coords for 800 ms, then unmounts
 *  itself. `position: fixed` means the PdfViewer's overflow and any
 *  transforms can't clip it. Remove once the cursor-zoom alignment
 *  is confirmed. */
function DebugZoomDot({
  x,
  y,
  onExpire,
}: {
  x: number;
  y: number;
  onExpire: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onExpire, 800);
    return () => clearTimeout(t);
  }, [onExpire]);
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: x - 8,
        top: y - 8,
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "rgba(239, 68, 68, 0.85)",
        boxShadow: "0 0 0 2px rgba(255,255,255,0.9)",
        pointerEvents: "none",
        zIndex: 9999,
        // Tiny CSS-only fade-out using opacity transition. Fired the
        // instant the element mounts; no keyframes needed.
        opacity: 1,
        transition: "opacity 800ms ease-out",
      }}
      ref={(el) => {
        if (!el) return;
        // One frame after mount, drop opacity to 0 — fade visible.
        requestAnimationFrame(() => {
          el.style.opacity = "0";
        });
      }}
    />
  );
}
