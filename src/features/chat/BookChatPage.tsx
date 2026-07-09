import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { bookIdSegment, parseBookIdSegment } from "@/lib/slugify";
import { useBookData } from "@/features/book/useBookData";
import { ChatPage } from "./ChatPage";

/**
 * Full-screen, book-scoped LLM page. Reached from a book's "Chat" entry
 * point. Resolves the book, derives its reader document id (the same key
 * chats are tagged with — a PDF file hash for uploaded books, the catalog
 * UUID for catalog books, falling back to the book row id for reference-only
 * uploads with no file yet), and hands it to a scoped {@link ChatPage}.
 */
export function BookChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bookId: rawBookId } = useParams<{ bookId: string }>();
  const { id: bookId } = useMemo(
    () =>
      rawBookId
        ? parseBookIdSegment(rawBookId)
        : { id: undefined, slug: null },
    [rawBookId],
  );
  const { data, loading, notFound } = useBookData(bookId);

  if (loading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <Loader2 size={28} className="animate-spin text-accent/80" />
      </div>
    );
  }

  if (notFound || !data || !bookId) {
    return (
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-text-muted">{t("book.notFound")}</p>
        <button
          onClick={() => navigate("/library")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/80 cursor-pointer"
        >
          <ArrowLeft size={14} />
          {t("book.goBack")}
        </button>
      </div>
    );
  }

  // chats + reader share this document id (file hash for uploaded, catalog id
  // for catalog; book row id when a reference-only upload has no file hash yet)
  const docId =
    data.source === "uploaded"
      ? data.book.file_hash || data.book.id
      : data.book.id;
  const backTo = `/books/${bookIdSegment(data.book.id, data.book.title)}`;

  return (
    <ChatPage
      key={docId}
      scope={{ docId, docTitle: data.book.title, backTo }}
    />
  );
}
