import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ListChecks,
  MessageSquare,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { chipClass } from "@/components/ui/classes";
import { cn } from "@/lib/cn";
import { useFeatures } from "@/lib/use-features";
import { bookIdSegment } from "@/lib/slugify";
import { logError } from "@/lib/logger";
import { conversationDisplayTitle, whiteboardDisplayTitle } from "@/lib/entity-title";
import { useChatStore } from "@/stores/chat-store";
import { useQuizStore } from "@/stores/quiz-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useLibraryStore } from "@/stores/library-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import type { UnifiedLibraryItem } from "@/types/catalog";
import {
  ROW_SEPARATOR_CLASS,
  formatRelative,
  getCoverUrl,
  getDocId,
  getPageCount,
  getTitle,
} from "./helpers";
import { loadResumePage, useResumePage } from "./resume-page-cache";

const MAX_CHIPS = 6;

interface LinkedItem {
  key: string;
  icon: LucideIcon;
  title: string;
  meta: string;
  open: () => void;
}

interface BookDetailPanelProps {
  entry: UnifiedLibraryItem;
}

/**
 * Inline detail row under an expanded book: cover, reading position,
 * the Continue / New chat / Quiz actions and chips for everything
 * linked to the book (chats by source_doc_id, quizzes and whiteboards
 * by book id, each behind its feature flag). Reads only what the
 * stores already hold; the single extra read is the resume state for
 * the current page.
 */
export function BookDetailPanel({ entry }: BookDetailPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const features = useFeatures();
  const { openUploadedBook } = useOpenUploadedDocument();
  const { openCatalogBook } = useOpenCatalogBook();
  const openConversation = useChatStore((s) => s.openConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const conversations = useChatStore((s) => s.conversations);
  const quizzes = useQuizStore((s) => s.myQuizzes);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const isInProgress = useLibraryStore((s) => s.inProgressDocIds.has(getDocId(entry)));

  const docId = getDocId(entry);
  const bookRowId = entry.source === "catalog" ? entry.catalog_book_id : entry.book.id;
  const title = getTitle(entry);
  const pageCount = getPageCount(entry);
  const resume = useResumePage(docId);
  const [creatingChat, setCreatingChat] = useState(false);

  // Reading position: one small read per doc, cached across expands.
  useEffect(() => {
    if (isInProgress) void loadResumePage(docId);
  }, [docId, isInProgress]);

  const bookPagePath = `/books/${bookIdSegment(bookRowId, title)}`;

  const openReader = () => {
    if (entry.source === "uploaded") {
      if (entry.book.storage_path) {
        void openUploadedBook(entry);
        return;
      }
    } else if (entry.catalog_book.download_url || entry.catalog_book.ia_id) {
      void openCatalogBook(entry.catalog_book);
      return;
    }
    navigate(bookPagePath);
  };

  const handleNewChat = async () => {
    if (creatingChat) return;
    setCreatingChat(true);
    try {
      await createConversation("", entry.folder_id, {
        docId,
        docTitle: title,
        page: null,
      });
      navigate("/chat");
    } catch (err) {
      logError("library:newBookChat", err);
    } finally {
      setCreatingChat(false);
    }
  };

  const linked = useMemo<LinkedItem[]>(() => {
    const out: LinkedItem[] = [];
    for (const c of conversations) {
      if (c.source_doc_id !== docId) continue;
      out.push({
        key: `chat:${c.id}`,
        icon: MessageSquare,
        title: conversationDisplayTitle(c, t),
        meta: `${t("library.allBooks.chatLabel")} · ${formatRelative(c.updated_at, t)}`,
        open: () => {
          void openConversation(c.id);
          navigate("/chat");
        },
      });
    }
    if (features.quizzes) {
      for (const q of quizzes) {
        const linkedId = entry.source === "uploaded" ? q.uploaded_book_id : q.catalog_book_id;
        if (linkedId !== bookRowId) continue;
        out.push({
          key: `quiz:${q.id}`,
          icon: ListChecks,
          title: q.title.trim() || t("library.allBooks.untitledQuiz"),
          meta: `${t("library.allBooks.quizQuestionCount", { count: q.question_count })} · ${formatRelative(q.updated_at, t)}`,
          open: () => navigate(`/quizzes/${q.id}`),
        });
      }
    }
    if (features.whiteboard) {
      for (const w of whiteboards) {
        if (w.bookId !== bookRowId) continue;
        out.push({
          key: `whiteboard:${w.id}`,
          icon: Shapes,
          title: whiteboardDisplayTitle(w, t),
          meta: `${t("library.allBooks.whiteboardLabel")} · ${formatRelative(new Date(w.updatedAt).toISOString(), t)}`,
          open: () => navigate(`/whiteboards/${w.id}`),
        });
      }
    }
    return out;
  }, [
    conversations,
    quizzes,
    whiteboards,
    features.quizzes,
    features.whiteboard,
    docId,
    bookRowId,
    entry.source,
    navigate,
    openConversation,
    t,
  ]);

  const statusParts: string[] = [];
  if (resume && pageCount) {
    statusParts.push(t("library.list.detail.position", { current: resume.page, total: pageCount }));
  } else if (pageCount) {
    statusParts.push(t("library.list.pagesLong", { count: pageCount }));
  }
  if (resume) {
    statusParts.push(t("library.list.detail.lastRead", { when: formatRelative(resume.updatedAt, t) }));
  } else if (isInProgress) {
    statusParts.push(t("library.list.detail.inProgress"));
  } else {
    statusParts.push(t("library.list.detail.notStarted"));
  }

  const coverUrl = getCoverUrl(entry);
  const shownChips = linked.slice(0, MAX_CHIPS);
  const overflow = linked.length - shownChips.length;

  return (
    <div
      className={cn("px-3 pb-3", ROW_SEPARATOR_CLASS)}
      onClick={(e) => e.stopPropagation()}
    >
    <div className="flex flex-col gap-4 rounded-panel bg-bg-tertiary px-4 py-4 md:ml-[92px] md:flex-row md:gap-6 md:py-[18px]">
      {/* Cover */}
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          draggable={false}
          className="h-[126px] w-[90px] shrink-0 rounded-[5px] object-cover shadow-page"
        />
      ) : (
        <div className="flex h-[126px] w-[90px] shrink-0 items-center justify-center rounded-[5px] bg-surface-3 shadow-page">
          <BookOpen size={28} className="text-text-muted" strokeWidth={1.5} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <span className="text-[13px] text-text-muted">{statusParts.join(" · ")}</span>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="px-4 py-2 text-[13px]" onClick={openReader}>
            {t("library.list.detail.continue")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="px-3.5 py-2 text-[13px]"
            onClick={() => void handleNewChat()}
            disabled={creatingChat}
          >
            <MessageSquare size={16} strokeWidth={1.5} />
            {t("library.list.detail.newChat")}
          </Button>
          {features.quizzes && (
            <Button
              size="sm"
              variant="secondary"
              className="px-3.5 py-2 text-[13px]"
              onClick={() => navigate(`${bookPagePath}/exams`)}
            >
              {t("library.list.detail.quiz")}
            </Button>
          )}
        </div>

        <div className="pt-1 text-2xs font-semibold uppercase tracking-wider text-text-muted-2">
          {t("library.list.detail.linked", { count: linked.length })}
        </div>

        {linked.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {shownChips.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.open}
                title={`${item.title} · ${item.meta}`}
                className={cn(
                  chipClass,
                  "max-w-full cursor-pointer bg-bg-secondary transition-colors hover:bg-surface-3 hover:text-text-primary sm:max-w-[280px]",
                )}
              >
                <item.icon size={16} className="shrink-0 text-text-muted" strokeWidth={1.5} />
                <span className="truncate">{item.title}</span>
                <span className="shrink-0 text-text-muted-2">{item.meta}</span>
              </button>
            ))}
            {overflow > 0 && (
              <button
                type="button"
                onClick={() => navigate(`${bookPagePath}/chat`)}
                className={cn(chipClass, "cursor-pointer bg-bg-secondary text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary")}
              >
                +{overflow}
              </button>
            )}
          </div>
        ) : (
          <span className="text-xs text-text-muted">{t("library.list.detail.noLinked")}</span>
        )}
      </div>
    </div>
    </div>
  );
}

/** Row-level progress cell: bar + percent when the resume page is
 *  known, otherwise 0% (never opened) or a plain "reading" marker. */
export function BookProgressCell({ entry }: { entry: UnifiedLibraryItem }) {
  const { t } = useTranslation();
  const docId = getDocId(entry);
  const resume = useResumePage(docId);
  const isInProgress = useLibraryStore((s) => s.inProgressDocIds.has(docId));
  const pageCount = getPageCount(entry);

  if (isInProgress && !(resume && pageCount)) {
    return (
      <span className="truncate text-xs text-text-muted">
        {t("library.list.detail.inProgress")}
      </span>
    );
  }
  const pct =
    resume && pageCount ? Math.min(100, Math.round((resume.page / pageCount) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 rounded-full bg-surface-3">
        <div className="h-1 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-[30px] text-xs text-text-muted">{pct}%</span>
    </div>
  );
}
