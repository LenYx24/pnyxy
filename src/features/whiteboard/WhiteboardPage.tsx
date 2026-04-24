import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui";
import { WhiteboardCanvas } from "./WhiteboardCanvas";

/**
 * Standalone whiteboard route — full-screen canvas with a back
 * button. Lets users open any whiteboard outside the reader, which
 * is the only way shell books (no file) can use whiteboards: they
 * have nothing to open in the reader, so whiteboards are instead
 * created from the book detail page and opened here.
 *
 * When navigated from a catalog/uploaded book, the caller can also
 * pass a `?pdfUrl=` query param to use that file as the background.
 * Shell books just render a blank canvas.
 */
export function WhiteboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { whiteboardId } = useParams<{ whiteboardId: string }>();

  if (!whiteboardId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-muted">{t("whiteboard.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-1rem)] flex-col">
      <header className="flex items-center gap-2 px-2 pb-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t("common.back")}
        </Button>
      </header>
      <div className="relative flex-1 overflow-hidden rounded-lg border border-glass-border">
        <WhiteboardCanvas whiteboardId={whiteboardId} />
      </div>
    </div>
  );
}
