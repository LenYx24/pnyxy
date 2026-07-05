import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Bot, Trash2 } from "lucide-react";
import { Button, ConfirmModal } from "@/components/ui";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { whiteboardDisplayTitle } from "@/lib/entity-title";
import { WhiteboardCanvas } from "./WhiteboardCanvas";
import { WhiteboardChatPanel } from "./WhiteboardChatPanel";

/**
 * Standalone whiteboard route, full-screen canvas with a back
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

  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const loadWhiteboards = useWhiteboardStore((s) => s.loadWhiteboards);
  const deleteWhiteboard = useWhiteboardStore((s) => s.deleteWhiteboard);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Direct landing on /whiteboards/:id may hit an empty list, load
  // so the back-link can resolve the bookId and the delete handler
  // has something to find.
  useEffect(() => {
    if (whiteboards.length === 0) void loadWhiteboards();
  }, [whiteboards.length, loadWhiteboards]);

  const whiteboard = whiteboards.find((w) => w.id === whiteboardId);
  const bookId = whiteboard?.bookId;

  const [chatOpen, setChatOpen] = useState(false);
  // Book-scoped when the board belongs to a book, else scoped to the board.
  const scopeId = bookId ? `book:${bookId}` : `wb:${whiteboardId}`;
  const scopeTitle = whiteboard
    ? whiteboardDisplayTitle(whiteboard, t)
    : "Whiteboard";

  const handleBack = () => {
    if (bookId) {
      navigate(`/books/${bookId}/whiteboards`);
    } else {
      navigate(-1);
    }
  };

  const handleDelete = () => {
    if (!whiteboardId) return;
    deleteWhiteboard(whiteboardId);
    if (bookId) {
      navigate(`/books/${bookId}/whiteboards`);
    } else {
      navigate("/workspace");
    }
  };

  if (!whiteboardId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-muted">{t("whiteboard.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-1rem)] flex-col">
      <header className="flex items-center justify-between gap-2 px-2 pb-2">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft size={16} />
          {bookId ? t("whiteboard.backToBook") : t("common.back")}
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => setChatOpen((v) => !v)}
            aria-label={t("whiteboard.chat.toggle", { defaultValue: "AI chat" })}
          >
            <Bot size={16} className={chatOpen ? "text-accent" : undefined} />
            <span className="hidden sm:inline">
              {t("whiteboard.chat.toggle", { defaultValue: "AI chat" })}
            </span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            aria-label={t("whiteboard.delete")}
          >
            <Trash2 size={16} className="text-danger" />
            <span className="hidden sm:inline">{t("whiteboard.delete")}</span>
          </Button>
        </div>
      </header>
      <div className="relative flex flex-1 overflow-hidden rounded-lg border border-glass-border">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <WhiteboardCanvas whiteboardId={whiteboardId} />
        </div>
        {chatOpen && (
          <div className="absolute inset-0 z-20 border-l border-glass-border bg-bg-secondary sm:static sm:z-auto sm:w-[340px] sm:shrink-0">
            <WhiteboardChatPanel
              scopeId={scopeId}
              scopeTitle={scopeTitle}
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>
      <ConfirmModal
        open={confirmOpen}
        title={t("whiteboard.deleteTitle")}
        body={t("whiteboard.deleteBody")}
        confirmLabel={t("common.delete")}
        danger
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
