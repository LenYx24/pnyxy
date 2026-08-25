import type { pdfjs } from "react-pdf";

export const PAGE_GAP = 12;
export const A4_RATIO = 1.4142;
// pdf.js viewport units are PostScript points; CSS px at 100% = pt * 96/72
// (same CSS_UNITS pdf.js's own viewer uses for "actual size").
export const PDF_CSS_UNITS = 96 / 72;
// getPage() per page is cheap (metadata only) but a 1000-page book adds up,
// so resolve in awaited batches to keep the main thread responsive.
export const DIMS_BATCH_SIZE = 24;
export const STORE_COMMIT_DEBOUNCE_MS = 250;
// liveScale bounds, matches store ZOOM_MIN/MAX (25/1000)
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 10;

export function upperBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export interface PageDimensions {
  width: number;
  height: number;
}

// Unrotated CSS-px dims of every page, resolved once per document right
// after load and cached across re-opens (keyed by docId, validated by page
// count). Layout must come from these, not from per-page render
// measurements: a measured height replacing an A4 estimate mid-scroll would
// shift pageOffsets/totalContentHeight under the user's scrollbar drag.
export const resolvedDimsCache = new Map<string, PageDimensions[]>();

export async function resolveAllPageDims(
  pdf: pdfjs.PDFDocumentProxy,
  isCancelled: () => boolean,
): Promise<PageDimensions[] | null> {
  const n = pdf.numPages;
  const out: PageDimensions[] = new Array(n);
  for (let start = 1; start <= n; start += DIMS_BATCH_SIZE) {
    if (isCancelled()) return null;
    const end = Math.min(n, start + DIMS_BATCH_SIZE - 1);
    const batch: Promise<void>[] = [];
    for (let i = start; i <= end; i++) {
      batch.push(
        pdf.getPage(i).then((page) => {
          // rotation: 0 to match what PageSlot renders: it always passes
          // rotate={rotation}, which overrides the page's own /Rotate in
          // react-pdf, and getPageHeight swaps for the viewer rotation.
          const vp = page.getViewport({ scale: 1, rotation: 0 });
          out[i - 1] = {
            width: vp.width * PDF_CSS_UNITS,
            height: vp.height * PDF_CSS_UNITS,
          };
        }),
      );
    }
    await Promise.all(batch);
  }
  if (isCancelled()) return null;
  return out;
}
