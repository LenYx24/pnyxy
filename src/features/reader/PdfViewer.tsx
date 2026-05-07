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
import { registerPinchTarget } from "./pinch-zoom-controller";
import { Loader2 } from "lucide-react";

type ZoomMode = "fit-width" | "fit-page" | "custom";

interface PageSlotProps {
  pageNum: number;
  offsetTop: number;
  pageHeight: number;
  /** Visible width of the page on screen — drives layout / virtual
   *  scroll positioning. For fit-width this is `containerWidth - 48`;
   *  for custom zoom this scales with zoomLevel. */
  effectivePageWidth: number;
  /** Width at which react-pdf actually rasterises the canvas. Lags
   *  effectivePageWidth by a debounce window so user-driven zoom
   *  changes don't immediately tear down + redraw the canvas — the
   *  CSS transform below scales the lagged canvas to display size,
   *  buying us a flash-free zoom change. Equal to effectivePageWidth
   *  most of the time; only differs during the in-flight settle
   *  window. Ignored in fit-page mode (height-driven). */
  effectiveRenderWidth: number;
  zoomMode: ZoomMode;
  /** Rotation in degrees (0/90/180/270). Forwarded to react-pdf so
   *  the rasterized canvas comes back already rotated; the page's
   *  viewport width/height are swapped for 90°/270°, which the
   *  outer layout consumes via `getPageHeight`. */
  rotation: 0 | 90 | 180 | 270;
  containerHeight: number;
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
  zoomMode,
  rotation,
  containerHeight,
  onRenderSuccess,
}: PageSlotProps) {
  // fit-page is height-driven, so it bypasses the lazy-raster lag —
  // the height prop is what determines the canvas size, and the
  // transform-based bridge below would have to invert through aspect
  // ratio for it. Width-based modes use `effectiveRenderWidth` so the
  // canvas only re-rasterises when the lag settles.
  const pageProps =
    zoomMode === "fit-page"
      ? { height: containerHeight > 0 ? containerHeight - 24 : undefined }
      : { width: effectiveRenderWidth > 0 ? effectiveRenderWidth : undefined };

  // visualScale = displayWidth / renderWidth.
  //   = 1 when renderWidth has caught up (steady state).
  //   > 1 when the user just zoomed in: canvas is at the smaller (old)
  //     resolution and CSS-scaled up to the new display size — slightly
  //     blurry until the debounce fires and re-rasterises crisply.
  //   < 1 when the user just zoomed out: canvas oversampled, sharp.
  // transform-origin "top center" so the slot's top edge stays anchored
  // at offsetTop and horizontal centering is preserved (the slot's
  // outer flex container centers the inner box pre-transform; without
  // this origin the visual would drift right of center after scale).
  const useTransform =
    zoomMode !== "fit-page" &&
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

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

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

function smoothScrollTo(
  element: HTMLElement,
  target: number,
  duration: number,
): void {
  const start = element.scrollTop;
  const distance = target - start;
  const startTime = performance.now();

  function step(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    element.scrollTop = start + distance * easeInOutCubic(progress);
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

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

  // Lazy rasterisation: react-pdf only re-rasterises when this value
  // changes, but the layout / virtual-scroll math always uses the
  // up-to-date `effectivePageWidth`. The gap between the two is
  // bridged by a CSS transform on each PageSlot — so when the user
  // zooms (or pinches and commits) the canvas stays at its current
  // resolution and is visually scaled up/down in the same frame,
  // *no* re-raster flash. After the user has settled for ~250ms we
  // catch `effectiveRenderWidth` up to `effectivePageWidth` and
  // react-pdf rerenders crisply at the new size — exactly once per
  // zoom event instead of once per frame of the gesture.
  //
  // Bypass entirely in fit-page mode: fit-page is height-driven and
  // pinch-to-zoom in that mode commits to custom mode anyway, so the
  // lag would only delay the re-fit on container resize.
  const [effectiveRenderWidth, setEffectiveRenderWidth] = useState(0);
  useEffect(() => {
    if (effectivePageWidth <= 0) return;
    if (zoomMode === "fit-page") {
      // No lag in fit-page; keep the value in sync so a subsequent
      // mode switch back into a width-driven mode has a baseline.
      if (effectiveRenderWidth !== effectivePageWidth) {
        setEffectiveRenderWidth(effectivePageWidth);
      }
      return;
    }
    // First valid value: sync immediately so the very first paint
    // doesn't apply a spurious transform.
    if (effectiveRenderWidth === 0) {
      setEffectiveRenderWidth(effectivePageWidth);
      return;
    }
    if (effectiveRenderWidth === effectivePageWidth) return;
    // Container-resize path: jump renderWidth to displayWidth in
    // one frame so a window resize doesn't sit at a stale
    // resolution. Pinch / zoom-button paths come through the same
    // hook but are debounced via the timer below.
    const t = setTimeout(() => {
      setEffectiveRenderWidth(effectivePageWidth);
    }, 250);
    return () => clearTimeout(t);
  }, [effectivePageWidth, effectiveRenderWidth, zoomMode]);

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
    [effectivePageWidth, zoomMode, containerHeight],
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
  const pageScrollBehavior = useSettingsStore((s) => s.pageScrollBehavior);
  const scrollAnimationDuration = useSettingsStore(
    (s) => s.scrollAnimationDuration,
  );

  // Scroll-to-page effect
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

      // Suppress scroll-handler page updates during programmatic scroll
      programmaticScrollRef.current = true;

      if (pageScrollBehavior === "instant") {
        el.scrollTop = targetOffset;
        programmaticScrollRef.current = false;
      } else {
        smoothScrollTo(el, targetOffset, scrollAnimationDuration);

        // Release the flag once scrolling settles (no scroll events for 150ms)
        let settleTimer: ReturnType<typeof setTimeout>;
        const onScrollEnd = () => {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            programmaticScrollRef.current = false;
            el.removeEventListener("scroll", onScrollEnd);
          }, 150);
        };
        el.addEventListener("scroll", onScrollEnd);
        // Fallback: release after animation duration + buffer
        setTimeout(() => {
          programmaticScrollRef.current = false;
          el.removeEventListener("scroll", onScrollEnd);
        }, scrollAnimationDuration + 200);
      }
    }
    clearScrollRequest(docId ?? undefined);
  }, [scrollToPage, pageOffsets, clearScrollRequest, pageScrollBehavior, scrollAnimationDuration, docId, getPageHeight]);

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

      if (anchorRef.current && containerRef.current && pageOffsets.length > 0) {
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

  // Handle page render success — cache dimensions
  const handlePageRenderSuccess = useCallback((pageNum: number) => {
    const el = containerRef.current;
    if (!el) return;
    const pageEl = el.querySelector(
      `[data-page-number="${pageNum}"]`,
    ) as HTMLElement | null;
    if (pageEl) {
      const rect = pageEl.getBoundingClientRect();
      dimensionsRef.current.set(pageNum, {
        width: rect.width,
        height: rect.height,
      });
    }
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
              zoomMode={zoomMode}
              rotation={rotation}
              containerHeight={containerHeight}
              onRenderSuccess={handlePageRenderSuccess}
            />
          ))}
        </div>
      </Document>
      <AnnotationContextMenu />
      <CommentPopover />
    </div>
  );
}
