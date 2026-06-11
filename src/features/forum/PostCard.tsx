import { Link, useNavigate } from "react-router";
import { ArrowDown, ArrowUp, MessageSquare, Link as LinkIcon, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ForumPostWithAuthor } from "@/types/forum";

interface PostCardProps {
  post: ForumPostWithAuthor;
  /**
   * The community slug. When omitted, a community badge is rendered
   * (used by the cross-community feed). When provided, we hide the
   * badge — the user is already inside that community.
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
  const navigate = useNavigate();
  const slug = communitySlug ?? post.community?.slug ?? "";
  const showCommunityBadge = !communitySlug && !!post.community;

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

  // Voting isn't wired up yet; the arrows are visual placeholders for
  // now. Score still reflects the cached value from the DB.
  return (
    <article
      onClick={handleOpen}
      className={cn(
        "flex gap-2 overflow-hidden rounded-lg border border-glass-border bg-glass-bg/50 transition-colors hover:bg-glass-hover",
        slug && "cursor-pointer",
      )}
    >
      {/* Left rail — score column */}
      <div className="flex w-10 shrink-0 flex-col items-center justify-start gap-0.5 border-r border-glass-border/40 bg-glass-bg/30 py-2 text-text-muted">
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Upvote"
          title="Voting coming soon"
          className="rounded p-0.5 transition-colors hover:bg-glass-hover hover:text-accent cursor-not-allowed"
        >
          <ArrowUp size={14} />
        </button>
        <span className="text-xs font-semibold tabular-nums text-text-secondary">
          {post.score_cached}
        </span>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Downvote"
          title="Voting coming soon"
          className="rounded p-0.5 transition-colors hover:bg-glass-hover hover:text-accent-blue cursor-not-allowed"
        >
          <ArrowDown size={14} />
        </button>
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
        </div>
      </div>
    </article>
  );
}
