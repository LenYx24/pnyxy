import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DockviewApi } from "dockview";
import i18n from "@/lib/i18n";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { getFeatures } from "@/lib/use-features";

export interface ReaderDrawMode {
  /** Whiteboard-on-document panel is swapped in for the viewer. */
  isDrawMode: boolean;
  /** Reflect an externally restored layout (saved with the whiteboard active). */
  setIsDrawMode: (on: boolean) => void;
  toggleDrawMode: () => void;
}

/**
 * Whiteboard-on-page draw mode (swaps the viewer panel for a whiteboard over
 * the PDF) plus the inline-draw store binding to the active document.
 */
export function useReaderDrawMode(
  dockviewApiRef: RefObject<DockviewApi | null>,
  activeDocumentId: string | null,
): ReaderDrawMode {
  // Bind inline-draw to the active doc; deactivate on switch so draw mode doesn't carry over.
  const setInlineDrawBook = useInlineDrawStore((s) => s.setBook);
  const setInlineDrawActive = useInlineDrawStore((s) => s.setActive);
  useEffect(() => {
    setInlineDrawBook(activeDocumentId ?? null);
    if (!activeDocumentId) setInlineDrawActive(false);
  }, [activeDocumentId, setInlineDrawBook, setInlineDrawActive]);

  const [isDrawMode, setIsDrawMode] = useState(false);
  const drawWhiteboardIdRef = useRef<string | null>(null);

  const toggleDrawMode = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;

    // Add the replacement into the SAME group ("within") BEFORE removing the
    // original, so the group never goes empty and dockview keeps its proportions.
    if (isDrawMode) {
      const wbPanel = api.getPanel("pdfCanvasWhiteboard");
      if (!wbPanel) {
        setIsDrawMode(false);
        return;
      }
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
        position: { referencePanel: "pdfCanvasWhiteboard", direction: "within" },
      });
      api.removePanel(wbPanel);
      setIsDrawMode(false);
    } else {
      const activeDoc = useReaderStore.getState().getActiveDoc();
      if (!activeDoc?.meta?.fileUrl) return;

      // whiteboard-on-document needs a paginated format unless the experimental toggle is on
      if (!getFeatures().whiteboard) return;
      const allowAll = useSettingsStore.getState()
        .experimental_allowWhiteboardForAllFormats;
      if (!activeDoc.meta.capabilities.paginated && !allowAll) return;

      const viewerPanel = api.getPanel("pdfViewer");
      if (!viewerPanel) return;

      // reuse existing whiteboard or create one
      if (!drawWhiteboardIdRef.current) {
        const activeDocId =
          useReaderStore.getState().activeDocumentId ?? undefined;
        drawWhiteboardIdRef.current = useWhiteboardStore
          .getState()
          .createWhiteboard({ bookId: activeDocId });
      }

      api.addPanel({
        id: "pdfCanvasWhiteboard",
        component: "whiteboard",
        title: i18n.t("reader.page.panelPdfCanvas"),
        params: {
          whiteboardId: drawWhiteboardIdRef.current,
          pdfDocumentUrl: activeDoc.meta.fileUrl,
        },
        position: { referencePanel: "pdfViewer", direction: "within" },
      });
      api.removePanel(viewerPanel);
      setIsDrawMode(true);
    }
  }, [isDrawMode, dockviewApiRef]);

  return { isDrawMode, setIsDrawMode, toggleDrawMode };
}
