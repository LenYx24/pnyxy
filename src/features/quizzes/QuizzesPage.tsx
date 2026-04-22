import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, FileQuestion, Plus, Search } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useQuizStore } from "@/stores/quiz-store";
import { useAuthStore } from "@/stores/auth-store";

type Filter = "all" | "standalone" | "book";

export function QuizzesPage() {
  const { t } = useTranslation();
  const publicQuizzes = useQuizStore((s) => s.publicQuizzes);
  const myQuizzes = useQuizStore((s) => s.myQuizzes);
  const isLoading = useQuizStore((s) => s.isLoading);
  const fetchPublic = useQuizStore((s) => s.fetchPublic);
  const fetchMine = useQuizStore((s) => s.fetchMine);
  const user = useAuthStore((s) => s.user);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetchPublic({
      query: query.trim() || undefined,
      standaloneOnly: filter === "standalone",
    });
    if (user) fetchMine();
  }, [query, filter, user, fetchPublic, fetchMine]);

  const visible = useMemo(() => {
    return publicQuizzes.filter((q) => {
      if (filter === "book") {
        return q.uploaded_book_id || q.catalog_book_id;
      }
      return true;
    });
  }, [publicQuizzes, filter]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("quizzes.title")}
          </h1>
          <p className="text-sm text-text-muted">{t("quizzes.tagline")}</p>
        </div>
        <Link to="/quizzes/new">
          <Button variant="primary">
            <Plus size={16} />
            {t("quizzes.newQuiz")}
          </Button>
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("quizzes.search")}
            className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 pl-9 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple/50"
          />
        </div>
        <div className="flex rounded-lg border border-glass-border bg-glass-bg p-0.5">
          {(
            [
              { key: "all", label: t("quizzes.filter.all") },
              { key: "book", label: t("quizzes.filter.onBook") },
              { key: "standalone", label: t("quizzes.filter.standalone") },
            ] as { key: Filter; label: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                filter === tab.key
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {user && myQuizzes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
            {t("quizzes.yourQuizzes")}
          </h2>
          <QuizGrid quizzes={myQuizzes} showVisibility />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
          {t("quizzes.community")}
        </h2>
        {isLoading && visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-muted">
            {t("common.loading")}
          </p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <FileQuestion size={36} className="text-text-muted/50" />
            <p className="text-sm text-text-muted">
              {user
                ? t("quizzes.emptyCommunitySignedIn")
                : t("quizzes.emptyCommunitySignedOut")}
            </p>
          </div>
        ) : (
          <QuizGrid quizzes={visible} />
        )}
      </section>
    </div>
  );
}

function QuizGrid({
  quizzes,
  showVisibility,
}: {
  quizzes: { id: string; title: string; description: string | null; visibility?: string; question_count: number }[];
  showVisibility?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {quizzes.map((q) => (
        <Link key={q.id} to={`/quizzes/${q.id}`} className="block">
          <GlassCard className="h-full cursor-pointer p-4 transition-colors hover:border-accent-purple/40">
            <div className="flex items-start gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-purple/15 text-accent-purple">
                <FileQuestion size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-text-primary">
                  {q.title}
                </h3>
                <p className="text-xs text-text-muted">
                  {t("quizzes.quizCount", { count: q.question_count })}
                </p>
              </div>
              {showVisibility && q.visibility === "private" && (
                <span className="shrink-0 rounded bg-text-muted/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  {t("quizzes.private")}
                </span>
              )}
            </div>
            {q.description && (
              <p className="mt-2 line-clamp-2 text-xs text-text-secondary">
                {q.description}
              </p>
            )}
          </GlassCard>
        </Link>
      ))}
    </div>
  );
}

/** Exported for embedding the "Quizzes on this book" list inside a
 *  book's Learn tab. Usage:
 *    <BookQuizzesList catalogBookId={id} />  or  {...uploadedBookId=...}
 */
export function BookQuizzesList({
  catalogBookId,
  uploadedBookId,
}: {
  catalogBookId?: string;
  uploadedBookId?: string;
}) {
  const { t } = useTranslation();
  const publicQuizzes = useQuizStore((s) => s.publicQuizzes);
  const fetchPublic = useQuizStore((s) => s.fetchPublic);
  const myQuizzes = useQuizStore((s) => s.myQuizzes);
  const fetchMine = useQuizStore((s) => s.fetchMine);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    fetchPublic({ catalogBookId, uploadedBookId });
    if (user) fetchMine();
  }, [catalogBookId, uploadedBookId, user, fetchPublic, fetchMine]);

  const own = myQuizzes.filter(
    (q) =>
      (catalogBookId && q.catalog_book_id === catalogBookId) ||
      (uploadedBookId && q.uploaded_book_id === uploadedBookId),
  );
  const community = publicQuizzes.filter(
    (q) =>
      (catalogBookId && q.catalog_book_id === catalogBookId) ||
      (uploadedBookId && q.uploaded_book_id === uploadedBookId),
  );

  const newHref = (() => {
    const params = new URLSearchParams();
    if (catalogBookId) params.set("catalog_book_id", catalogBookId);
    if (uploadedBookId) params.set("uploaded_book_id", uploadedBookId);
    return `/quizzes/new?${params.toString()}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <BookOpen size={14} />
          {t("quizzes.bookQuizzesHeading")}
        </div>
        <Link to={newHref}>
          <Button variant="secondary" className="gap-1 px-2.5 py-1 text-xs">
            <Plus size={14} />
            {t("quizzes.addNew")}
          </Button>
        </Link>
      </div>

      {own.length === 0 && community.length === 0 ? (
        <p className="rounded-lg border border-glass-border bg-glass-bg/40 p-4 text-sm text-text-muted">
          {t("quizzes.bookQuizzesEmpty")}
        </p>
      ) : (
        <>
          {own.length > 0 && <QuizGrid quizzes={own} showVisibility />}
          {community.length > 0 && <QuizGrid quizzes={community} />}
        </>
      )}
    </div>
  );
}
