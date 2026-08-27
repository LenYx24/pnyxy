import type { IDockviewPanelProps } from "dockview";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WhiteboardCanvas } from "./WhiteboardCanvas";

export function WhiteboardPanelWrapper(
  props: IDockviewPanelProps<{
    whiteboardId?: string;
    pdfDocumentUrl?: string;
  }>,
) {
  const { t } = useTranslation();
  const whiteboardId = props.params?.whiteboardId;
  const pdfDocumentUrl = props.params?.pdfDocumentUrl;
  if (!whiteboardId) return null;
  // The draw-mode overlay passes pdfDocumentUrl and is toggled from the
  // toolbar; the standalone whiteboard panel has no other close affordance
  // (single-panel groups hide the dockview tab bar), so give it an X.
  const standalone = !pdfDocumentUrl;
  return (
    <div className="relative h-full w-full">
      <WhiteboardCanvas
        whiteboardId={whiteboardId}
        pdfDocumentUrl={pdfDocumentUrl}
      />
      {standalone && (
        <button
          type="button"
          onClick={() => props.api.close()}
          aria-label={t("common.close")}
          title={t("common.close")}
          className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md border border-glass-border bg-bg-secondary/90 text-text-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
