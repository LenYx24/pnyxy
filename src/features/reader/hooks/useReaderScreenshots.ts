import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/ui-store";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import type { ScreenshotRect } from "../popovers/ScreenshotRectSelector";

export interface ReaderScreenshots {
  /** Whole-viewer capture, saved + copied to clipboard. */
  handleScreenshot: () => Promise<void>;
  rectScreenshotActive: boolean;
  handleRectScreenshotStart: () => void;
  handleRectScreenshotCapture: (rect: ScreenshotRect) => Promise<void>;
  cancelRectScreenshot: () => void;
  rectToAiActive: boolean;
  handleRectToAiStart: () => void;
  handleRectToAiCapture: (rect: ScreenshotRect) => Promise<void>;
  cancelRectToAi: () => void;
}

/**
 * Composite a client-space rectangle directly from the react-pdf page
 * canvases it overlaps, instead of rasterizing the whole page with
 * html2canvas. pdf.js paints each page from the PDF's own bytes, so those
 * canvases are same-origin and never tainted. html2canvas over document.body
 * is not: it reuses whatever cross-origin <img> the browser already cached
 * without CORS (book covers, avatars, anywhere on the page, even outside the
 * crop) and that taints the whole output, so toDataURL throws SecurityError.
 * Chrome serves the tainted cached image where Firefox re-fetches it with
 * CORS, which is why the same crop worked in Firefox / on another account.
 * Returns null when there is no PDF viewer or the rect misses every page
 * canvas, so callers fall back to html2canvas (EPUB / text viewers).
 */
function capturePdfCanvasRect(rect: ScreenshotRect): HTMLCanvasElement | null {
  const viewer = document.querySelector<HTMLElement>("[data-pdf-viewer]");
  if (!viewer) return null;
  const pageCanvases = Array.from(
    viewer.querySelectorAll<HTMLCanvasElement>("canvas.react-pdf__Page__canvas"),
  );
  if (pageCanvases.length === 0) return null;

  const dpr = window.devicePixelRatio || 1;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.width * dpr));
  out.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  // PDF pages are white; fill so page gaps / margins aren't transparent-black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);

  let drewAny = false;
  for (const canvas of pageCanvases) {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // Intersection of the crop rect and this page, in client coords.
    const ix = Math.max(rect.left, box.left);
    const iy = Math.max(rect.top, box.top);
    const ix2 = Math.min(rect.left + rect.width, box.right);
    const iy2 = Math.min(rect.top + rect.height, box.bottom);
    if (ix2 <= ix || iy2 <= iy) continue;

    // CSS px -> source canvas pixels: the canvas is rasterized larger than its
    // displayed box (dpr) and may also be CSS-scaled by the slot transform.
    const sScaleX = canvas.width / box.width;
    const sScaleY = canvas.height / box.height;
    ctx.drawImage(
      canvas,
      (ix - box.left) * sScaleX,
      (iy - box.top) * sScaleY,
      (ix2 - ix) * sScaleX,
      (iy2 - iy) * sScaleY,
      (ix - rect.left) * dpr,
      (iy - rect.top) * dpr,
      (ix2 - ix) * dpr,
      (iy2 - iy) * dpr,
    );
    drewAny = true;
  }
  return drewAny ? out : null;
}

/** The three html2canvas paths: full viewer, drag-rect download, drag-rect to AI chat. */
export function useReaderScreenshots(): ReaderScreenshots {
  const { t } = useTranslation();
  const [rectScreenshotActive, setRectScreenshotActive] = useState(false);
  // Separate flag from the download rect so the two capture modes don't cross-wire.
  const [rectToAiActive, setRectToAiActive] = useState(false);

  const saveCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const link = document.createElement("a");
    link.download = `screenshot-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    // also copy to clipboard; fails silently if permission is denied (http origin, no focus)
    try {
      canvas.toBlob((blob) => {
        if (!blob || !navigator.clipboard?.write) return;
        navigator.clipboard
          .write([new ClipboardItem({ "image/png": blob })])
          .catch(() => {});
      }, "image/png");
    } catch {
      // ClipboardItem missing or blocked
    }
  }, []);

  const handleScreenshot = useCallback(async () => {
    const viewer =
      document.querySelector<HTMLElement>("[data-active-viewer]") ??
      document.querySelector<HTMLElement>("[data-pdf-viewer]");
    if (!viewer) return;

    try {
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(viewer, {
        useCORS: true,
        allowTaint: false,
        scale: window.devicePixelRatio,
        backgroundColor: null,
      });
      saveCanvas(canvas);
    } catch (error) {
      logError("handleScreenshot", error);
      showToast(t("reader.screenshotFailed"), "error");
    }
  }, [saveCanvas, t]);

  const handleRectScreenshotStart = useCallback(() => {
    setRectScreenshotActive(true);
  }, []);
  const cancelRectScreenshot = useCallback(() => {
    setRectScreenshotActive(false);
  }, []);

  const handleRectScreenshotCapture = useCallback(
    async (rect: ScreenshotRect) => {
      setRectScreenshotActive(false);
      // let the overlay unmount before rasterizing so it isn't captured
      await new Promise((resolve) => requestAnimationFrame(resolve));
      try {
        // PDF: composite straight from the page canvases (taint-free). Other
        // viewers fall back to html2canvas over the body.
        let canvas = capturePdfCanvasRect(rect);
        if (!canvas) {
          const { default: html2canvas } = await import("html2canvas-pro");
          canvas = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            scale: window.devicePixelRatio,
            backgroundColor: null,
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          });
        }
        saveCanvas(canvas);
      } catch (error) {
        logError("handleRectScreenshotCapture", error);
        showToast(t("reader.screenshotFailed"), "error");
      }
    },
    [saveCanvas, t],
  );

  // "Crop area for AI": overlay + html2canvas, but the PNG goes into the chat
  // composer's pending attachments (scanned PDFs, figures, image-only pages).
  const handleRectToAiStart = useCallback(() => {
    setRectToAiActive(true);
  }, []);
  const cancelRectToAi = useCallback(() => {
    setRectToAiActive(false);
  }, []);

  const handleRectToAiCapture = useCallback(
    async (rect: ScreenshotRect) => {
      setRectToAiActive(false);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      try {
        // PDF: composite straight from the page canvases (taint-free, no
        // SecurityError from cached cross-origin covers/avatars). Other
        // viewers fall back to html2canvas over the body.
        let canvas = capturePdfCanvasRect(rect);
        if (!canvas) {
          const { default: html2canvas } = await import("html2canvas-pro");
          canvas = await html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            scale: window.devicePixelRatio,
            backgroundColor: null,
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
          });
        }
        // base64 PNG, same shape as uploaded image attachments
        const dataUrl = canvas.toDataURL("image/png");
        const idx = dataUrl.indexOf(",");
        const data = idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
        useUIStore.getState().pushChatAttachment({
          kind: "image",
          media_type: "image/png",
          data,
          name: `page-${Date.now()}.png`,
        });
        // open the chat panel so the attachment is visible (null on /chat)
        useUIStore.getState().openReaderAiChat?.();
      } catch (error) {
        logError("handleRectToAiCapture", error);
        showToast(t("reader.screenshotFailed"), "error");
      }
    },
    [t],
  );

  return {
    handleScreenshot,
    rectScreenshotActive,
    handleRectScreenshotStart,
    handleRectScreenshotCapture,
    cancelRectScreenshot,
    rectToAiActive,
    handleRectToAiStart,
    handleRectToAiCapture,
    cancelRectToAi,
  };
}
