import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Check,
  ExternalLink,
  GraduationCap,
  Loader2,
  Newspaper,
  Plus,
  Video,
  Headphones,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { useLibraryStore } from "@/stores/library-store";
import { useConfirm } from "@/hooks/use-confirm";
import { promptOpenAiLink } from "@/lib/ai/ai-link-prompt";
import type {
  RecommendedBook,
  RecommendedVideo,
} from "@/lib/ai/extract-recommendations";
import { cn } from "@/lib/cn";

export function RecommendationCards({
  books,
  videos,
}: {
  books?: RecommendedBook[];
  videos?: RecommendedVideo[];
}) {
  return (
    <div className="mt-3 space-y-2">
      {books?.map((b, i) => (
        <BookCard key={`b-${i}`} book={b} />
      ))}
      {videos?.map((v, i) => (
        <VideoCard key={`v-${i}`} video={v} />
      ))}
    </div>
  );
}

// Book card with "Add to library"

function BookCard({ book }: { book: RecommendedBook }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const [state, setState] = useState<"idle" | "saving" | "added" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!user || state === "saving" || state === "added") return;
    setState("saving");
    setErrorMsg(null);
    try {
      const orgId = useOrgStore.getState().currentOrgId;
      if (!orgId) {
        throw new Error(
          t("chat.recommend.noActiveOrg", {
            defaultValue:
              "You need an active workspace to add books — sign in or create one.",
          }),
        );
      }
      const { error } = await supabase.from("books").insert({
        user_id: user.id,
        org_id: orgId,
        title: book.title,
        author: book.author || null,
        page_count: null,
        metadata: {
          isbn: book.isbn,
          description: book.description,
          year: book.year,
          manual_entry: true,
          source: "ai_recommendation",
        },
      });
      if (error) throw error;
      await fetchLibrary(true);
      setState("added");
    } catch (err) {
      logError("RecommendationCards:addBook", err);
      setErrorMsg(err instanceof Error ? err.message : "Save failed.");
      setState("error");
    }
  };

  return (
    <article className="rounded-xl border border-glass-border bg-glass-bg/40 p-3">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <BookOpen size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-text-primary truncate">
            {book.title}
          </p>
          <p className="text-xs text-text-muted truncate">
            {book.author}
            {book.year ? ` · ${book.year}` : ""}
            {book.level ? ` · ${book.level}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!user || state === "saving" || state === "added"}
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors cursor-pointer",
            state === "added"
              ? "border-success/40 bg-success/10 text-success"
              : "border-glass-border bg-bg-primary/40 text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            (!user || state === "saving") && "cursor-not-allowed opacity-60",
          )}
          title={
            !user
              ? t("chat.recommend.signInToSave", {
                  defaultValue: "Sign in to save",
                })
              : t("chat.recommend.addToLibrary", {
                  defaultValue: "Add as a placeholder book",
                })
          }
        >
          {state === "saving" ? (
            <Loader2 size={11} className="animate-spin" />
          ) : state === "added" ? (
            <Check size={11} />
          ) : (
            <Plus size={11} />
          )}
          {state === "added"
            ? t("chat.recommend.added", { defaultValue: "Added" })
            : t("chat.recommend.add", { defaultValue: "Add to library" })}
        </button>
      </header>
      {book.description && (
        <p className="mt-2 text-xs text-text-secondary leading-relaxed">
          {book.description}
        </p>
      )}
      {state === "error" && errorMsg && (
        <p className="mt-2 text-2xs text-danger">{errorMsg}</p>
      )}
    </article>
  );
}

// Video / course card

function VideoCard({ video }: { video: RecommendedVideo }) {
  const { t } = useTranslation();
  const { confirm, ConfirmModalElement } = useConfirm();

  const Icon =
    video.kind === "course"
      ? GraduationCap
      : video.kind === "article"
        ? Newspaper
        : video.kind === "podcast"
          ? Headphones
          : Video;

  const handleOpen = () => {
    if (!video.url) return;
    void promptOpenAiLink(video.url, confirm, t);
  };

  return (
    <article className="rounded-xl border border-glass-border bg-glass-bg/40 p-3">
      <header className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            video.kind === "course"
              ? "bg-warning/15 text-warning"
              : video.kind === "article"
                ? "bg-blue-500/15 text-blue-400"
                : video.kind === "podcast"
                  ? "bg-purple-500/15 text-purple-400"
                  : "bg-danger/15 text-danger",
          )}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-text-primary truncate">
            {video.title}
          </p>
          <p className="text-xs text-text-muted truncate">
            {video.channel}
            {video.duration ? ` · ${video.duration}` : ""}
            {video.level ? ` · ${video.level}` : ""}
          </p>
        </div>
        {video.url && (
          <button
            type="button"
            onClick={handleOpen}
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <ExternalLink size={11} />
            {t("chat.recommend.open", { defaultValue: "Open" })}
          </button>
        )}
      </header>
      {video.description && (
        <p className="mt-2 text-xs text-text-secondary leading-relaxed">
          {video.description}
        </p>
      )}
      {ConfirmModalElement}
    </article>
  );
}
