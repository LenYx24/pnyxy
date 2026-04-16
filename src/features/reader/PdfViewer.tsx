import {
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

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-assets/pdf.worker.min.mjs";

const PAGE_GAP = 12;
const A4_RATIO = 1.4142; // height/width for A4

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
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

    // Set initial size synchronously
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

  // Get page rendering props
  const getPageProps = useCallback(() => {
    switch (zoomMode) {
      case "fit-width":
        return { width: containerWidth > 0 ? containerWidth - 48 : undefined };
      case "fit-page":
        return {
          height: containerHeight > 0 ? containerHeight - 24 : undefined,
        };
      case "custom":
        return { scale: zoomLevel / 100 };
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

    const pages: number[] = [];
    for (let i = 0; i < totalPages; i++) {
      const pageTop = pageOffsets[i];
      const pageBottom = pageTop + getPageHeight(i + 1);
      if (pageBottom >= viewportTop && pageTop <= viewportBottom) {
        pages.push(i + 1);
      }
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

      // Find page whose center is closest to viewport center
      if (pageOffsets.length === 0) return;
      const viewportCenter = st + containerHeight / 2;
      let closestPage = 1;
      let closestDist = Infinity;

      for (let i = 0; i < pageOffsets.length; i++) {
        const pageCenter = pageOffsets[i] + getPageHeight(i + 1) / 2;
        const dist = Math.abs(pageCenter - viewportCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closestPage = i + 1;
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
    for (let i = 0; i < pageOffsets.length; i++) {
      const pageTop = pageOffsets[i];
      const pageHeight = getPageHeight(i + 1);
      const pageBottom = pageTop + pageHeight;
      if (viewportCenter >= pageTop && viewportCenter <= pageBottom) {
        anchorRef.current = {
          page: i + 1,
          fraction: (viewportCenter - pageTop) / pageHeight,
        };
        break;
      }
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
          style={{
            height: totalContentHeight,
            position: "relative",
            width: zoomMode === "fit-page" ? "100%" : effectivePageWidth,
            margin: "0 auto",
          }}
        >
          {visiblePages.map((pageNum) => (
            <div
              key={pageNum}
              style={{
                position: "absolute",
                top: pageOffsets[pageNum - 1],
                left: 0,
                width: "100%",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div style={{ position: "relative" }}>
                <Page
                  pageNumber={pageNum}
                  {...getPageProps()}
                  loading={
                    <div
                      className="flex items-center justify-center gap-2 text-text-secondary"
                      style={{
                        height: getPageHeight(pageNum),
                        width: effectivePageWidth,
                      }}
                    >
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  }
                  onRenderSuccess={() => handlePageRenderSuccess(pageNum)}
                />
                <HighlightLayer pageNum={pageNum} />
                <SearchHighlightLayer pageNum={pageNum} />
                <CommentMarkers pageNum={pageNum} />
              </div>
            </div>
          ))}
        </div>
      </Document>
      <AnnotationContextMenu />
      <CommentPopover />
    </div>
  );
}
