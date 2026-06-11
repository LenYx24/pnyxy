import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ListChecks, MessageSquare, Shapes, GraduationCap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useChatStore } from "@/stores/chat-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useVocabStore } from "@/stores/vocab-store";
import { cn } from "@/lib/cn";
import { useBook } from "./BookPageContext";

interface RelatedQuiz {
  id: string;
  title: string;
}
interface RelatedChat {
  id: string;
  title: string;
}

/**
 * "Related in your library" — the second grouping axis (alongside the
 * filetree's folder placement): everything ABOUT this book, regardless
 * of which folder it lives in. Aggregates by each type's existing book
 * link (no schema change):
 *   - quizzes  → uploaded_book_id / catalog_book_id  (Supabase)
 *   - chats    → source_doc_id  (file hash for uploaded, catalog id)  (Supabase)
 *   - whiteboards → WhiteboardData.bookId  (local store)
 *   - flashcards  → vocab sourceDocumentId  (local store)
 *
 * Notes are intentionally absent: they carry no book link today (the
 * note sync always nulls book_id — notes are book-agnostic by design),
 * so there's nothing to match until that's revisited.
 */
export function RelatedToBook() {
  const data = useBook();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isUploaded = data.source === "uploaded";
  const bookRowId = data.book.id;
  // chats + vocab match the reader's document id: a PDF file hash for
  // uploaded books, the catalog UUID for catalog books.
  const docId = isUploaded ? data.book.file_hash : data.book.id;

  const openConversation = useChatStore((s) => s.openConversation);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const loadWhiteboards = useWhiteboardStore((s) => s.loadWhiteboards);
  const vocabEntries = useVocabStore((s) => s.entries);
  const loadEntries = useVocabStore((s) => s.loadEntries);

  const [quizzes, setQuizzes] = useState<RelatedQuiz[]>([]);
  const [chats, setChats] = useState<RelatedChat[]>([]);

  useEffect(() => {
    void loadWhiteboards();
    void loadEntries();
  }, [loadWhiteboards, loadEntries]);

  // Fetch the user's quizzes + chats linked to this book.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setQuizzes([]);
          setChats([]);
        }
        return;
      }

      const quizCol = isUploaded ? "uploaded_book_id" : "catalog_book_id";
      const [quizRes, chatRes] = await Promise.all([
        supabase
          .from("quizzes")
          .select("id, title")
          .eq("user_id", user.id)
          .eq(quizCol, bookRowId)
          .order("updated_at", { ascending: false }),
        docId
          ? supabase
              .from("chat_conversations")
              .select("id, title")
              .eq("user_id", user.id)
              .eq("source_doc_id", docId)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (quizRes.error) logError("related:quizzes", quizRes.error);
      if (chatRes.error) logError("related:chats", chatRes.error);
      if (cancelled) return;
      setQuizzes((quizRes.data ?? []) as RelatedQuiz[]);
      setChats((chatRes.data ?? []) as RelatedChat[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isUploaded, bookRowId, docId]);

  const relatedWhiteboards = useMemo(
    () => whiteboards.filter((w) => w.bookId === bookRowId),
    [whiteboards, bookRowId],
  );
  const vocabCount = useMemo(() => {
    if (!docId) return 0;
    let n = 0;
    for (const e of vocabEntries.values()) {
      if (e.sourceDocumentId === docId) n++;
    }
    return n;
  }, [vocabEntries, docId]);

  const total =
    quizzes.length + chats.length + relatedWhiteboards.length + vocabCount;
  if (total === 0) return null;

  const openChat = (id: string) => {
    void openConversation(id);
    navigate("/chat");
  };

  return (
    <section className="rounded-lg border border-glass-border bg-glass-bg p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">
        {t("book.related.heading")}
      </h3>
      <div className="space-y-1.5">
        {quizzes.map((q) => (
          <RelatedRow
            key={`quiz:${q.id}`}
            icon={<ListChecks size={14} className="text-warning/80" />}
            label={q.title || t("library.allBooks.untitledQuiz")}
            kind={t("library.allBooks.quizLabel")}
            onClick={() => navigate(`/quizzes/${q.id}`)}
          />
        ))}
        {chats.map((c) => (
          <RelatedRow
            key={`chat:${c.id}`}
            icon={<MessageSquare size={14} className="text-sky-400/80" />}
            label={c.title || t("library.allBooks.untitledChat")}
            kind={t("library.allBooks.chatLabel")}
            onClick={() => openChat(c.id)}
          />
        ))}
        {relatedWhiteboards.map((w) => (
          <RelatedRow
            key={`whiteboard:${w.id}`}
            icon={<Shapes size={14} className="text-success/80" />}
            label={w.title || t("library.allBooks.untitledWhiteboard")}
            kind={t("library.allBooks.whiteboardLabel")}
            onClick={() => navigate(`/whiteboards/${w.id}`)}
          />
        ))}
        {vocabCount > 0 && (
          <RelatedRow
            icon={<GraduationCap size={14} className="text-pink-400/80" />}
            label={t("book.related.flashcards", { count: vocabCount })}
            kind={t("book.related.flashcardsKind")}
            onClick={() => navigate("/vocabulary")}
          />
        )}
      </div>
    </section>
  );
}

function RelatedRow({
  icon,
  label,
  kind,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  kind: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        "hover:bg-glass-hover cursor-pointer",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
        {label}
      </span>
      <span className="shrink-0 text-2xs uppercase tracking-wide text-text-muted">
        {kind}
      </span>
    </button>
  );
}
