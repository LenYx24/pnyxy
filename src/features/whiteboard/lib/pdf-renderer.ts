import { pdfjs } from "react-pdf";

export interface RenderedPage {
  pageNum: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/** Cheap per-page geometry (no rasterization) used to lay the pages out
 *  before any bitmap is rendered. */
export interface PageLayout {
  pageNum: number;
  width: number;
  height: number;
}

/**
 * Open a PDF document. The caller owns the returned proxy and must
 * `destroy()` it when done (see clearPdfBackground in the store).
 */
export async function loadPdfDocument(
  fileUrl: string,
): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument(fileUrl).promise;
}

/**
 * Compute each page's dimensions at the given scale WITHOUT rasterizing —
 * `getViewport` only reads the page's metadata, so this is cheap even for a
 * few-hundred-page book. Lets us lay out the whole document up front and
 * rasterize pages lazily as they scroll into view.
 */
export async function getPageLayouts(
  pdfDoc: pdfjs.PDFDocumentProxy,
  scale: number,
): Promise<PageLayout[]> {
  const layouts: PageLayout[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });
    layouts.push({ pageNum: i, width: viewport.width, height: viewport.height });
    // release the page's internal resources; we only needed the geometry
    page.cleanup();
  }
  return layouts;
}

/**
 * Rasterize a single PDF page to an ImageBitmap at the given scale.
 * Used on-demand by the lazy windowing in the whiteboard store.
 */
export async function renderSinglePage(
  pdfDoc: pdfjs.PDFDocumentProxy,
  pageNum: number,
  scale: number,
): Promise<ImageBitmap> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d")!;

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const bitmap = await createImageBitmap(canvas);
  page.cleanup();
  return bitmap;
}
