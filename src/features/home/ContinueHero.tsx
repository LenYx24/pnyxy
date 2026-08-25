import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, Flame, MessageSquare, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { Button } from "@/components/ui";
import { loadLastOpenedBook } from "@/lib/last-opened-book";
import { useLibraryStore } from "@/stores/library-store";
import { useChatStore } from "@/stores/chat-store";
import { GOAL_SECONDS, useStreakStore } from "@/stores/streak-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import {
  loadResumePage,
  useResumePage,
} from "@/features/library/list-view/resume-page-cache";
import {
  getAuthor,
  getCoverUrl,
  getDocId,
  getPageCount,
  getTitle,
} from "@/features/library/list-view/helpers";
import type { UnifiedLibraryItem } from "@/types/catalog";

/**
 * "Continue where you left off" hero at the top of Home. Resolves the
 * device's last-opened book against the library store (falls back to
 * the most recently added book), shows cover + progress + the two
 * actions (read / ask about the book) and the streak on the right.
 * With an empty library it renders a quiet upload prompt instead.
 */
export function ContinueHero() {
  const books = useLibraryStore((s) => s.books);
  const getRecentBooks = useLibraryStore((s) => s.getRecentBooks);

  const entry = useMemo<UnifiedLibraryItem | null>(() => {
    const last = loadLastOpenedBook();
    if (last) {
      const hit = books.find((b) =>
        last.source === "catalog"
          ? b.source === "catalog" && b.catalog_book_id === last.id
          : b.source === "uploaded" && b.book.id === last.id,
      );
      if (hit) return hit;
    }
    return getRecentBooks(1)[0] ?? null;
  }, [books, getRecentBooks]);

  if (!entry) return <EmptyHero />;
  return <BookHero entry={entry} />;
}

function EmptyHero() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <section className="mb-6 flex flex-col items-start gap-3 rounded-page bg-bg-secondary p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted-2">
          {t("home.hero.caption")}
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold text-text-primary sm:text-3xl">
          {t("home.hero.emptyTitle")}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {t("home.hero.emptyBody")}
        </p>
      </div>
      <Button variant="primary" onClick={() => navigate("/library")}>
        <Upload size={16} strokeWidth={1.5} />
        {t("home.hero.emptyAction")}
      </Button>
    </section>
  );
}

function BookHero({ entry }: { entry: UnifiedLibraryItem }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openUploadedBook } = useOpenUploadedDocument();
  const { openCatalogBook } = useOpenCatalogBook();
  const createConversation = useChatStore((s) => s.createConversation);
  const getCurrentStreak = useStreakStore((s) => s.getCurrentStreak);
  const getTodayRecord = useStreakStore((s) => s.getTodayRecord);
  // subscribe so the numbers refresh when today's record changes
  useStreakStore((s) => s.dailyRecords);
  const [creatingChat, setCreatingChat] = useState(false);

  const docId = getDocId(entry);
  const title = getTitle(entry);
  const author = getAuthor(entry);
  const coverUrl = getCoverUrl(entry);
  const pageCount = getPageCount(entry);
  const resume = useResumePage(docId);

  // same resume lookup as the library detail panel (one cached read)
  useEffect(() => {
    void loadResumePage(docId);
  }, [docId]);

  const streak = getCurrentStreak();
  const today = getTodayRecord();
  const minutesLeft = Math.max(
    0,
    Math.ceil((GOAL_SECONDS - today.seconds) / 60),
  );

  const percent =
    resume && pageCount
      ? Math.min(100, Math.round((resume.page / pageCount) * 100))
      : 0;

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
    navigate("/library");
  };

  const askAboutBook = async () => {
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
      logError("home:newBookChat", err);
    } finally {
      setCreatingChat(false);
    }
  };

  return (
    <section className="mb-6 rounded-page bg-bg-secondary p-5 sm:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-stretch">
        {/* cover */}
        <div className="shrink-0">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              draggable={false}
              className="h-[210px] w-[150px] rounded-[6px] object-cover shadow-sm shadow-black/20"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-[210px] w-[150px] items-center justify-center rounded-[6px] bg-bg-tertiary text-text-muted shadow-sm shadow-black/20"
            >
              <BookOpen size={36} strokeWidth={1.25} />
            </div>
          )}
        </div>

        {/* copy + actions */}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted-2">
            {t("home.hero.caption")}
          </p>
          <h2 className="mt-1 line-clamp-2 font-display text-[30px] font-bold leading-tight text-text-primary">
            {title}
          </h2>
          <p className="mt-1.5 truncate text-sm text-text-secondary">
            {author}
            {resume && pageCount
              ? ` · ${t("home.hero.position", { current: resume.page, total: pageCount })}`
              : null}
          </p>

          <div
            className="mt-4 h-1.5 w-full max-w-md overflow-hidden rounded-chip bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t("home.hero.progress", { percent })}
          >
            <div
              className="h-full rounded-chip bg-accent transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            <Button variant="primary" onClick={openReader}>
              <BookOpen size={16} strokeWidth={1.5} />
              {t("home.hero.read")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void askAboutBook()}
              disabled={creatingChat}
            >
              <MessageSquare size={16} strokeWidth={1.5} />
              {t("home.hero.ask")}
            </Button>
          </div>
        </div>

        {/* streak */}
        <div className="flex shrink-0 items-center gap-3 border-t border-surface-3/60 pt-4 md:w-44 md:flex-col md:items-end md:justify-center md:border-l md:border-t-0 md:pl-5 md:pt-0 md:text-right">
          <div className="flex items-center gap-2">
            <Flame
              size={22}
              strokeWidth={1.5}
              className={cn(streak > 0 ? "text-streak" : "text-text-muted")}
            />
            <span className="font-display text-3xl font-bold leading-none text-text-primary">
              {streak}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            {t("home.hero.streakDays", { count: streak })}
          </p>
          <p className="text-xs text-text-secondary">
            {today.goalCompleted
              ? t("home.hero.goalDone")
              : t("home.hero.goalLeft", { minutes: minutesLeft })}
          </p>
        </div>
      </div>
    </section>
  );
}
