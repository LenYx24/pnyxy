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
import { Loader2 } from "lucide-react";

type ZoomMode = "fit-width" | "fit-page" | "custom";

interface PageSlotProps {
  pageNum: number;
  offsetTop: number;
  pageHeight: number;
  effectivePageWidth: number;
  zoomMode: ZoomMode;
  zoomLevel: number;
  containerWidth: number;
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
  zoomMode,
  zoomLevel,
  containerWidth,
  containerHeight,
  onRenderSuccess,
}: PageSlotProps) {
  const pageProps =
    zoomMode === "fit-width"
      ? { width: containerWidth > 0 ? containerWidth - 48 : undefined }
      : zoomMode === "fit-page"
        ? { height: containerHeight > 0 ? containerHeight - 24 : undefined }
        : { scale: zoomLevel / 100 };

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
      <div style={{ position: "relative" }}>
        <Page
          pageNumber={pageNum}
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
  const clearScrollRequest = useReaderStore((s) => s.clearScrollRequest);

  const meta = doc?.meta ?? null;
  const totalPages = doc?.totalPages ?? 0;
  const zoomMode = doc?.zoomMode ?? "fit-width";
  const zoomLevel = doc?.zoomLevel ?? 100;
  const scrollToPage = doc?.scrollToPage ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  useTextSelection(containerRef);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const dimensionsRef = useRef<Map<number, PageDimensions>>(new Map());
  const rafRef = useRef<number>(0);
  const prevZoomRef = useRef({ zoomMode, zoomLevel });
  const anchorRef = useRef<{ page: number; fraction: number } | null>(null);
  const programmaticScrollRef = useRef(false);

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

  const visiblePages = useMemo(() => {
    if (totalPages === 0 || pageOffsets.length === 0) return [];

    const viewportTop = scrollTop - containerHeight; // overscan = 1 viewport
    const viewportBottom = scrollTop + containerHeight * 2;

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
  }, [scrollTop, containerHeight, totalPages, pageOffsets, getPageHeight]);

  // Scroll handler — RAF-throttled, updates current page
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const st = el.scrollTop;
      setScrollTop(st);

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

    const targetOffset = pageOffsets[scrollToPage - 1];
    if (targetOffset !== undefined) {
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
  }, [scrollToPage, pageOffsets, clearScrollRequest, pageScrollBehavior, scrollAnimationDuration, docId]);

  // Save anchor before zoom changes (on every scroll update)
  useEffect(() => {
    if (pageOffsets.length === 0 || containerHeight === 0) return;
    const viewportCenter = scrollTop + containerHeight / 2;
    const idx = Math.max(0, upperBound(pageOffsets, viewportCenter) - 1);
    const pageTop = pageOffsets[idx];
    const pageHeight = getPageHeight(idx + 1);
    if (viewportCenter >= pageTop && viewportCenter <= pageTop + pageHeight) {
      anchorRef.current = {
        page: idx + 1,
        fraction: (viewportCenter - pageTop) / pageHeight,
      };
    }
  }, [scrollTop, pageOffsets, getPageHeight, containerHeight]);

  // Clear cached dimensions when zoom changes so stale sizes don't corrupt layout
  useLayoutEffect(() => {
    const prev = prevZoomRef.current;
    if (prev.zoomMode !== zoomMode || prev.zoomLevel !== zoomLevel) {
      dimensionsRef.current.clear();

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
      prevZoomRef.current = { zoomMode, zoomLevel };
    }
  }, [zoomMode, zoomLevel, pageOffsets, getPageHeight, containerHeight]);

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
      // touch-pan-y blocks the browser's native pinch-zoom on this
      // element so our two-finger pinch handler (in the parent
      // viewerRef) can drive setZoomLevel instead. Without this, on
      // mobile the browser would zoom the layout viewport and our
      // pinch listener would never get a chance to run.
      className="h-full w-full touch-pan-y overflow-auto bg-bg-primary"
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
          style={{
            height: totalContentHeight,
            position: "relative",
            width: zoomMode === "fit-page" ? "100%" : effectivePageWidth,
            margin: "0 auto",
          }}
        >
          {visiblePages.map((pageNum) => (
            <PageSlot
              key={pageNum}
              pageNum={pageNum}
              offsetTop={pageOffsets[pageNum - 1]}
              pageHeight={getPageHeight(pageNum)}
              effectivePageWidth={effectivePageWidth}
              zoomMode={zoomMode}
              zoomLevel={zoomLevel}
              containerWidth={containerWidth}
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
