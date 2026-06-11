import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useCommunityStore } from "@/stores/community-store";
import { usePostStore } from "@/stores/post-store";
import { useAuthStore } from "@/stores/auth-store";
import { CommentThread } from "./CommentThread";

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

function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

export function PostPage() {
  const { slug, postId } = useParams<{ slug: string; postId: string }>();
  const navigate = useNavigate();

  const currentCommunity = useCommunityStore((s) => s.currentCommunity);
  const fetchCommunityBySlug = useCommunityStore((s) => s.fetchCommunityBySlug);

  const currentPost = usePostStore((s) => s.currentPost);
  const comments = usePostStore((s) => s.comments);
  const isLoading = usePostStore((s) => s.isLoading);
  const fetchPost = usePostStore((s) => s.fetchPost);
  const fetchComments = usePostStore((s) => s.fetchComments);
  const removePost = usePostStore((s) => s.removePost);
  const createComment = usePostStore((s) => s.createComment);
  const clearCurrentPost = usePostStore((s) => s.clearCurrentPost);
  const subscribeCommentUpdates = usePostStore((s) => s.subscribeCommentUpdates);

  const user = useAuthStore((s) => s.user);

  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (slug) fetchCommunityBySlug(slug);
  }, [slug, fetchCommunityBySlug]);

  useEffect(() => {
    if (postId) {
      fetchPost(postId);
      fetchComments(postId);
      const unsub = subscribeCommentUpdates(postId);
      return () => {
        unsub();
        clearCurrentPost();
      };
    }
  }, [postId, fetchPost, fetchComments, subscribeCommentUpdates, clearCurrentPost]);

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !postId) return;
    setSubmitting(true);
    try {
      await createComment({
        post_id: postId,
        body_md: commentText.trim(),
      });
      setCommentText("");
    } catch {
      // error handled by store
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading && !currentPost) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  if (!currentPost) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">Post not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate(`/forum/c/${slug}`)}>
          Back to community
        </Button>
      </div>
    );
  }

  const isAuthor = user?.id === currentPost.author_id;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back nav */}
      <button
        onClick={() => navigate(`/forum/c/${slug}`)}
        className="mb-4 flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
      >
        <ArrowLeft size={14} />
        {currentCommunity?.name ?? "Back"}
      </button>

      {/* Post */}
      <div className="rounded-xl border border-glass-border bg-glass-bg p-6 backdrop-blur-md">
        <h1 className="text-xl font-bold text-text-primary">
          {currentPost.title}
        </h1>

        <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">
            {currentPost.author?.display_name ?? "Unknown"}
          </span>
          <span>{timeAgo(currentPost.created_at)}</span>
          <span className="flex items-center gap-1">
            <MessageSquare size={12} />
            {currentPost.comment_count}
          </span>
          {isAuthor && (
            <button
              onClick={async () => {
                await removePost(currentPost.id);
                navigate(`/forum/c/${slug}`);
              }}
              className="flex items-center gap-1 text-danger transition-colors hover:text-danger cursor-pointer"
            >
              <Trash2 size={12} />
              Delete
            </button>
          )}
        </div>

        {/* Link */}
        {currentPost.kind === "link" && currentPost.link_url && (
          <a
            href={currentPost.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-1.5 text-sm text-accent-blue transition-colors hover:text-accent-blue/80"
          >
            <ExternalLink size={14} />
            {currentPost.link_url}
          </a>
        )}

        {/* Body */}
        {currentPost.body_md && (
          <div
            className="prose-sm prose-invert mt-4 max-w-none break-words text-sm text-text-primary [&_a]:break-all [&_img]:max-w-full [&_pre]:overflow-x-auto"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(currentPost.body_md),
            }}
          />
        )}
      </div>

      {/* Comment composer */}
      {user && (
        <div className="mt-6 rounded-xl border border-glass-border bg-glass-bg p-4 backdrop-blur-md">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Write a comment... (Markdown supported)"
            className="h-24 w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2.5 text-sm text-text-primary outline-none resize-y focus:border-accent"
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || submitting}
              className="rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-40 cursor-pointer"
            >
              {submitting ? "Posting..." : "Comment"}
            </button>
          </div>
        </div>
      )}

      {/* Comments */}
      <div className="mt-6">
        <h2 className="mb-4 text-sm font-semibold text-text-primary">
          Comments
        </h2>
        <CommentThread comments={comments} postId={currentPost.id} />
      </div>
    </div>
  );
}
