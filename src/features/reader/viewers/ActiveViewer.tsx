import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { PdfViewer } from "./PdfViewer";
import { PdfReflowView } from "./PdfReflowView";
import { TextViewer } from "./TextViewer";
import { EpubViewer } from "./EpubViewer";

/**
 * Dispatches to the format-appropriate viewer for a given document id,
 * defaulting to the active document.
 */
export function ActiveViewer({ documentId }: { documentId?: string }) {
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const resolvedId = documentId ?? activeDocumentId ?? undefined;
  const doc = useDocumentState(resolvedId ?? "");
  const format = doc?.meta.format;
  const pdfReflowMode = useSettingsStore((s) => s.pdfReflowMode);

  if (!resolvedId || !doc) return <PdfViewer documentId={resolvedId} />;

  switch (format) {
    case "pdf":
      return pdfReflowMode ? (
        <PdfReflowView documentId={resolvedId} />
      ) : (
        <PdfViewer documentId={resolvedId} />
      );
    case "text":
    case "markdown":
      return <TextViewer documentId={resolvedId} />;
    case "epub":
      return <EpubViewer documentId={resolvedId} />;
    default:
      return <PdfViewer documentId={resolvedId} />;
  }
}
