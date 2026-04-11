import { pdfjs } from "react-pdf";

export interface RenderedPage {
  pageNum: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * Render a single PDF page to an ImageBitmap at the given scale.
 */
async function renderPage(
  pdfDoc: pdfjs.PDFDocumentProxy,
  pageNum: number,
  scale: number,
): Promise<RenderedPage> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = new OffscreenCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d")!;

  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;

  const bitmap = await createImageBitmap(canvas);
  return {
    pageNum,
    bitmap,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * Load a PDF and render all pages at the given scale.
 * Returns rendered bitmaps for each page.
 */
export async function renderPdfPages(
  fileUrl: string,
  scale = 1.5,
  onProgress?: (loaded: number, total: number) => void,
): Promise<RenderedPage[]> {
  const loadingTask = pdfjs.getDocument(fileUrl);
  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;

  const results: RenderedPage[] = [];

  // Render pages sequentially to avoid memory spikes
  for (let i = 1; i <= totalPages; i++) {
    const rendered = await renderPage(pdfDoc, i, scale);
    results.push(rendered);
    onProgress?.(i, totalPages);
  }

  return results;
}
