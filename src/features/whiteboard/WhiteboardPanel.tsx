import type { IDockviewPanelProps } from "dockview";
import { WhiteboardCanvas } from "./WhiteboardCanvas";

export function WhiteboardPanelWrapper(
  props: IDockviewPanelProps<{ whiteboardId?: string; pdfDocumentUrl?: string }>,
) {
  const whiteboardId = props.params?.whiteboardId;
  const pdfDocumentUrl = props.params?.pdfDocumentUrl;
  if (!whiteboardId) return null;
  return (
    <WhiteboardCanvas
      whiteboardId={whiteboardId}
      pdfDocumentUrl={pdfDocumentUrl}
    />
  );
}
