import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowBigUp,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  LogIn,
  MessagesSquare,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { renderMarkdown } from "@/lib/ai/markdown-message";
import { usePromptGalleryStore } from "@/stores/prompt-gallery-store";
import { useAuthStore } from "@/stores/auth-store";
import type { SharedAnswer } from "@/types/space";

export function PromptGalleryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { spaceId } = useParams();
  const user = useAuthStore((s) => s.user);
  const { answers, loading, error, fetchGallery, deleteShared } =
    usePromptGalleryStore();

  useEffect(() => {
    if (user) void fetchGallery(spaceId ?? null);
  }, [user, spaceId, fetchGallery]);

  const isScoped = Boolean(spaceId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <ArrowLeft size={16} />
          {t("common.back")}
        </button>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
            <MessagesSquare size={20} className="text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-text-primary">
                {isScoped ? t("gallery.titleScoped") : t("gallery.title")}
              </h1>
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-accent">
                {t("common.beta")}
              </span>
            </div>
            <p className="text-xs text-text-muted">{t("gallery.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Signed-out */}
      {!user ? (
        <section className="rounded-xl border border-glass-border bg-glass-bg/50 p-6 text-center">
          <p className="mb-4 text-text-secondary">
            {t("gallery.signInPrompt")}
          </p>
          <Link to="/auth">
            <Button>
              <LogIn size={16} />
              {t("auth.signIn")}
            </Button>
          </Link>
        </section>
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : answers.length === 0 ? (
        <div className="rounded-xl border border-glass-border bg-glass-bg/50 p-8 text-center">
          <MessagesSquare
            size={28}
            className="mx-auto mb-3 text-text-muted/60"
          />
          <p className="text-sm text-text-secondary">{t("gallery.empty")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {answers.map((a) => (
            <AnswerCard
              key={a.id}
              answer={a}
              canDelete={user.id === a.user_id}
              onDelete={() => void deleteShared(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const CLAMP_CHARS = 900;

function AnswerCard({
  answer,
  canDelete,
  onDelete,
}: {
  answer: SharedAnswer;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const votedIds = usePromptGalleryStore((s) => s.votedIds);
  const toggleVote = usePromptGalleryStore((s) => s.toggleVote);
  const hasVoted = votedIds.has(answer.id);

  const isLong = answer.answer.length > CLAMP_CHARS;
  const html = useMemo(
    () =>
      renderMarkdown(
        isLong && !expanded
          ? answer.answer.slice(0, CLAMP_CHARS) + "…"
          : answer.answer,
      ),
    [answer.answer, isLong, expanded],
  );

  const date = new Date(answer.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <article className="rounded-xl border border-glass-border bg-bg-secondary p-4 sm:p-5">
      {/* Question */}
      <div className="mb-3 flex items-start gap-2">
        <MessagesSquare
          size={16}
          className="mt-0.5 shrink-0 text-accent"
          aria-hidden
        />
        <h2 className="font-semibold text-text-primary break-words">
          {answer.question}
        </h2>
      </div>

      {/* Answer */}
      <div
        className="ai-message break-words text-sm text-text-secondary"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent/80 cursor-pointer"
        >
          {expanded ? (
            <>
              <ChevronUp size={14} />
              {t("gallery.showLess")}
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              {t("gallery.showMore")}
            </>
          )}
        </button>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center gap-3 border-t border-glass-border/60 pt-3 text-2xs text-text-muted">
        {answer.model && (
          <span className="inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-bg/40 px-2 py-0.5 font-mono">
            <Sparkles size={10} className="text-accent" />
            {answer.model}
          </span>
        )}
        <span>{date}</span>
        <button
          type="button"
          onClick={() => void toggleVote(answer.id)}
          aria-pressed={hasVoted}
          aria-label={t("gallery.upvote")}
          title={t("gallery.upvote")}
          className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-colors cursor-pointer ${
            hasVoted
              ? "bg-accent/10 text-accent"
              : "text-text-muted hover:bg-glass-hover hover:text-text-primary"
          }`}
        >
          <ArrowBigUp size={14} className={hasVoted ? "fill-accent" : ""} />
          {answer.upvotes}
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer"
            title={t("common.delete")}
          >
            <Trash2 size={12} />
            {t("common.delete")}
          </button>
        )}
      </div>
    </article>
  );
}
