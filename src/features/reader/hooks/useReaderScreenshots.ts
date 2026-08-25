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
        allowTaint: true,
        scale: window.devicePixelRatio,
        backgroundColor: null,
      });
      saveCanvas(canvas);
    } catch (error) {
      logError("handleScreenshot", error);
      showToast(
        t("reader.screenshotFailed", {
          defaultValue: "Couldn't capture the screenshot. Please try again.",
        }),
        "error",
      );
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
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio,
        backgroundColor: null,
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      });
      saveCanvas(canvas);
    },
    [saveCanvas],
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
        const { default: html2canvas } = await import("html2canvas-pro");
        const canvas = await html2canvas(document.body, {
          useCORS: true,
          allowTaint: true,
          scale: window.devicePixelRatio,
          backgroundColor: null,
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        });
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
        showToast(
          t("reader.screenshotFailed", {
            defaultValue: "Couldn't capture the screenshot. Please try again.",
          }),
          "error",
        );
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
