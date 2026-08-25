import { useCallback } from "react";
import { useReaderStore } from "@/stores/reader-store";
import { logError } from "@/lib/logger";

/**
 * Printing. The on-screen PDF viewer is virtualized (only the pages near the
 * viewport are in the DOM), so window.print() + the @media print CSS would
 * drop most of the document. For PDFs we instead stream the original file
 * into a hidden iframe and print that, the browser's built-in PDF viewer
 * paginates every page. Non-paginated formats (EPUB/text) fall back to the
 * in-page print path.
 */
export function useReaderPrint(): () => void {
  return useCallback(() => {
    const doc = useReaderStore.getState().getActiveDoc();
    const fileUrl = doc?.meta.fileUrl;
    if (doc?.meta.format === "pdf" && fileUrl) {
      document.getElementById("pnyxy-print-frame")?.remove();
      const iframe = document.createElement("iframe");
      iframe.id = "pnyxy-print-frame";
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
      iframe.src = fileUrl;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (err) {
          logError("reader:print:iframe", err);
          window.print();
        }
      };
      document.body.appendChild(iframe);
      return;
    }
    window.print();
  }, []);
}
