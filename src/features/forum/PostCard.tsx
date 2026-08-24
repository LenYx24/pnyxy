import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { MessageSquare, Link as LinkIcon, FileText, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import { usePostStore } from "@/stores/post-store";
import { useConfirm } from "@/hooks/use-confirm";
import type { ForumPostWithAuthor } from "@/types/forum";

interface PostCardProps {
  post: ForumPostWithAuthor;
  /**
   * The community slug. When omitted, a community badge is rendered
   * (used by the cross-community feed). When provided, we hide the
   * badge, the user is already inside that community.
   */
  communitySlug?: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function PostCard({ post, communitySlug }: PostCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const removePost = usePostStore((s) => s.removePost);
  const { confirm, ConfirmModalElement } = useConfirm();
  const slug = communitySlug ?? post.community?.slug ?? "";
  const showCommunityBadge = !communitySlug && !!post.community;
  const isAuthor = !!user && user.id === post.author_id;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: t("forum.post.deleteTitle", { defaultValue: "Delete this post?" }),
      body: t("forum.post.deleteBody", {
        defaultValue: "This removes your post for everyone. This can't be undone.",
      }),
      confirmLabel: t("common.delete", { defaultValue: "Delete" }),
      danger: true,
    });
    if (!ok) return;
    await removePost(post.id);
  };

  const preview =
    post.kind === "link"
      ? post.link_url
      : post.body_md
        ? post.body_md.length > 150
          ? post.body_md.slice(0, 150) + "..."
          : post.body_md
        : null;

  const handleOpen = () => {
    if (!slug) return;
    navigate(`/forum/c/${slug}/p/${post.id}`);
  };

  // Voting isn't wired up yet, so we show the cached score as a plain
  // count without interactive vote arrows.
  return (
    <article
      onClick={handleOpen}
      className={cn(
        "flex gap-2 overflow-hidden rounded-lg border border-glass-border bg-glass-bg/50 transition-colors hover:bg-glass-hover",
        slug && "cursor-pointer",
      )}
    >
      {/* Left rail: score column */}
      <div className="flex w-10 shrink-0 flex-col items-center justify-start border-r border-glass-border/40 bg-glass-bg/30 py-2 text-text-muted">
        <span className="text-xs font-semibold tabular-nums text-text-secondary">
          {post.score_cached}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 py-2.5 pr-3">
        {/* Top meta row: community badge + author + time */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-text-muted">
          {showCommunityBadge && post.community && (
            <Link
              to={`/forum/c/${post.community.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-accent hover:underline"
            >
              c/{post.community.slug}
            </Link>
          )}
          <span>· posted by</span>
          <span className="font-medium text-text-secondary">
            {post.author?.display_name ?? "Unknown"}
          </span>
          <span>· {timeAgo(post.created_at)}</span>
        </div>

        {/* Title */}
        <h3 className="mt-0.5 flex items-start gap-2 text-sm font-semibold text-text-primary">
          <span className="mt-0.5 shrink-0 text-text-muted">
            {post.kind === "link" ? (
              <LinkIcon size={14} />
            ) : (
              <FileText size={14} />
            )}
          </span>
          <span className="line-clamp-2">{post.title}</span>
        </h3>

        {/* Preview */}
        {preview && (
          <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
            {preview}
          </p>
        )}

        {/* Footer */}
        <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <MessageSquare size={12} />
            {post.comment_count}{" "}
            {post.comment_count === 1 ? "comment" : "comments"}
          </span>
          {isAuthor && (
            <button
              type="button"
              onClick={handleDelete}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger cursor-pointer"
              aria-label={t("common.delete", { defaultValue: "Delete" })}
            >
              <Trash2 size={12} />
              <span>{t("common.delete", { defaultValue: "Delete" })}</span>
            </button>
          )}
        </div>
      </div>
      {ConfirmModalElement}
    </article>
  );
}
