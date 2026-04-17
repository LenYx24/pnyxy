import { useNavigate } from "react-router";
import { MessageSquare, Link as LinkIcon, FileText } from "lucide-react";
import { GlassCard } from "@/components/ui";
import type { ForumPostWithAuthor } from "@/types/forum";

interface PostCardProps {
  post: ForumPostWithAuthor;
  communitySlug: string;
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

  const preview =
    post.kind === "link"
      ? post.link_url
      : post.body_md
        ? post.body_md.length > 150
          ? post.body_md.slice(0, 150) + "..."
          : post.body_md
        : null;

  return (
    <GlassCard
      className="cursor-pointer p-4"
      onClick={() => navigate(`/forum/c/${communitySlug}/p/${post.id}`)}
    >
      <div className="flex items-start gap-3">
        {/* Kind icon */}
        <div className="mt-0.5 shrink-0 text-text-muted">
          {post.kind === "link" ? <LinkIcon size={16} /> : <FileText size={16} />}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">
            {post.title}
          </h3>

          {preview && (
            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
              {preview}
            </p>
          )}

          <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
            <span>{post.author?.display_name ?? "Unknown"}</span>
            <span>{timeAgo(post.created_at)}</span>
            <span className="flex items-center gap-1">
              <MessageSquare size={12} />
              {post.comment_count}
            </span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
