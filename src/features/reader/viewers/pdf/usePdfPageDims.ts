import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { pdfjs } from "react-pdf";
import { logError } from "@/lib/logger";
import {
  A4_RATIO,
  PAGE_GAP,
  resolveAllPageDims,
  resolvedDimsCache,
  type PageDimensions,
} from "./pdf-layout";

export interface PdfPageDimsArgs {
  docId: string | null | undefined;
  totalPages: number;
  rotation: 0 | 90 | 180 | 270;
  baselineWidth: number;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Live tray scale; render measurements divide by it for tray-local size. */
  liveScaleRef: RefObject<number>;
}

export interface PdfPageDims {
  /** Authoritative unrotated dims for every page once resolved, else null. */
  resolvedDims: PageDimensions[] | null;
  getIntrinsicDims: (pageNum: number) => PageDimensions | null;
  getPageHeight: (pageNum: number) => number;
  /** Tray-local (pre-scale) top of every page. */
  pageOffsets: number[];
  /** Tray-local (pre-scale) total height. */
  totalContentHeight: number;
  handleDocumentLoadSuccess: (pdf: pdfjs.PDFDocumentProxy) => void;
  handlePageRenderSuccess: (pageNum: number) => void;
}

/**
 * Page geometry for the virtualized PDF tray. Every page's dims are
 * resolved from pdf.js right after load (and cached per document); until
 * then per-page render measurements and an A4 estimate stand in.
 */
export function usePdfPageDims({
  docId,
  totalPages,
  rotation,
  baselineWidth,
  containerRef,
  liveScaleRef,
}: PdfPageDimsArgs): PdfPageDims {
  // Measured page dims by page number. State (not ref) so getPageHeight
  // reads it during render.
  const [dimensions, setDimensions] = useState<Map<number, PageDimensions>>(
    () => new Map(),
  );
  // Authoritative unrotated dims for every page (index = pageNum - 1), set
  // once resolveAllPageDims finishes. Null until then (estimate path). Once
  // set, page layout never changes again for this document.
  const [resolvedDims, setResolvedDims] = useState<PageDimensions[] | null>(
    () => (docId ? (resolvedDimsCache.get(docId) ?? null) : null),
  );
  // Mirror for handlePageRenderSuccess, which react-pdf calls after commit.
  const resolvedDimsRef = useRef<PageDimensions[] | null>(resolvedDims);
  useLayoutEffect(() => {
    resolvedDimsRef.current = resolvedDims;
  }, [resolvedDims]);
  // Bumped when the document changes/unmounts so an in-flight resolve for a
  // previous document is dropped instead of landing on the new one.
  const dimsJobRef = useRef(0);

  const prevRotationRef = useRef(rotation);
  useLayoutEffect(() => {
    if (prevRotationRef.current === rotation) return;
    prevRotationRef.current = rotation;
    // rotation swaps width/height, so measured dims are stale; re-measure.
    // Resolved dims are stored unrotated and swapped in getPageHeight.
    // Reset before paint so no slot lays out with the stale orientation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDimensions(new Map());
  }, [rotation]);

  // New document: drop the previous document's dims (measured + resolved)
  // and cancel any resolve still running for it.
  const prevDocIdRef = useRef(docId);
  useLayoutEffect(() => {
    if (prevDocIdRef.current === docId) return;
    prevDocIdRef.current = docId;
    dimsJobRef.current += 1;
    // Reset before paint so the new document never lays out on old dims.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDimensions(new Map());
    setResolvedDims(docId ? (resolvedDimsCache.get(docId) ?? null) : null);
  }, [docId]);
  useEffect(() => {
    return () => {
      dimsJobRef.current += 1;
    };
  }, []);

  // Resolve every page's dims right after the document loads. Until it
  // finishes the A4-estimate / measured path below stands in.
  const handleDocumentLoadSuccess = useCallback(
    (pdf: pdfjs.PDFDocumentProxy) => {
      const key = docId;
      if (key) {
        const cached = resolvedDimsCache.get(key);
        if (cached && cached.length === pdf.numPages) {
          setResolvedDims(cached);
          return;
        }
      }
      const job = ++dimsJobRef.current;
      const isCancelled = () => dimsJobRef.current !== job;
      void resolveAllPageDims(pdf, isCancelled)
        .then((dims) => {
          if (!dims || isCancelled()) return;
          if (key) resolvedDimsCache.set(key, dims);
          setResolvedDims(dims);
        })
        .catch((error: unknown) => {
          // keep the estimate path; pages still lay out, just less stable
          logError(`pdf:resolvePageDims:${docId ?? "?"}`, error);
        });
    },
    [docId],
  );

  // Estimate page height from cached dims or A4 ratio. A stray cache entry
  // with width=0 / non-finite values would propagate NaN into pageOffsets
  // and every downstream top: style, so validate and fall back to A4.
  const swapForRotation = rotation === 90 || rotation === 270;
  // Intrinsic (tray-independent) dims of a page: resolved pdf.js dims first
  // (rotation applied here), measured dims as the pre-resolve stand-in.
  const getIntrinsicDims = useCallback(
    (pageNum: number): PageDimensions | null => {
      const resolved = resolvedDims?.[pageNum - 1];
      const d = resolved
        ? swapForRotation
          ? { width: resolved.height, height: resolved.width }
          : resolved
        : dimensions.get(pageNum);
      if (
        d &&
        Number.isFinite(d.width) &&
        Number.isFinite(d.height) &&
        d.width > 0 &&
        d.height > 0
      ) {
        return d;
      }
      return null;
    },
    [resolvedDims, swapForRotation, dimensions],
  );

  const getPageHeight = useCallback(
    (pageNum: number): number => {
      const cached = getIntrinsicDims(pageNum);
      if (cached) {
        const scale = baselineWidth / cached.width;
        const height = cached.height * scale;
        if (Number.isFinite(height) && height > 0) return height;
      }
      const fallback = baselineWidth * A4_RATIO;
      return Number.isFinite(fallback) && fallback > 0
        ? fallback
        : 600 * A4_RATIO;
    },
    [baselineWidth, getIntrinsicDims],
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

  const handlePageRenderSuccess = useCallback(
    (pageNum: number) => {
      // Layout is fixed by the resolved dims; a render measurement must not
      // touch it, or the layout would move under a scrollbar drag.
      if (resolvedDimsRef.current) return;
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
    },
    [containerRef, liveScaleRef],
  );

  return {
    resolvedDims,
    getIntrinsicDims,
    getPageHeight,
    pageOffsets,
    totalContentHeight,
    handleDocumentLoadSuccess,
    handlePageRenderSuccess,
  };
}
