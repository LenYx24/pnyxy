import { useState } from "react";
import { marked } from "marked";
import { Minus, Plus, Reply, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { usePostStore } from "@/stores/post-store";
import { useAuthStore } from "@/stores/auth-store";
import type { ForumCommentWithAuthor } from "@/types/forum";

const MAX_DEPTH = 5;

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
  return sanitizeHtml(marked.parse(md, { async: false }) as string);
}

function countDescendants(comment: ForumCommentWithAuthor): number {
  let n = 0;
  for (const child of comment.children ?? []) {
    n += 1 + countDescendants(child);
  }
  return n;
}

interface CommentNodeProps {
  comment: ForumCommentWithAuthor;
  postId: string;
  depth: number;
}

function CommentNode({ comment, postId, depth }: CommentNodeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const createComment = usePostStore((s) => s.createComment);
  const removeComment = usePostStore((s) => s.removeComment);
  const user = useAuthStore((s) => s.user);

  const handleSubmitReply = async () => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await createComment({
        post_id: postId,
        parent_id: comment.id,
        body_md: replyText.trim(),
      });
      setReplyText("");
      setReplying(false);
    } catch {
      // error handled by store
    } finally {
      setSubmitting(false);
    }
  };

  const isAuthor = user?.id === comment.author_id;
  const isDeleted = comment.is_removed;
  const descendants = countDescendants(comment);

  return (
    <div
      className={cn(
        "min-w-0",
        depth > 0 &&
          "ml-2 border-l border-glass-border/40 pl-2 sm:ml-5 sm:pl-4",
      )}
    >
      <div className="py-2">
        {/* Header: collapse toggle + author + timestamp. The fold
            button works on a deleted comment too, its children may
            still be the interesting content. */}
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand comment" : "Collapse comment"}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted/70 transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            {collapsed ? <Plus size={10} /> : <Minus size={10} />}
          </button>
          <span
            className={cn(
              "truncate font-medium",
              isDeleted ? "italic text-text-muted/70" : "text-text-secondary",
            )}
          >
            {isDeleted ? "[deleted]" : comment.author?.display_name ?? "Unknown"}
          </span>
          <span className="shrink-0">{timeAgo(comment.created_at)}</span>
          {collapsed && descendants > 0 && (
            <span className="shrink-0 text-text-muted/70">
              · {descendants} {descendants === 1 ? "reply" : "replies"} hidden
            </span>
          )}
        </div>

        {!collapsed && (
          <>
            {/* Body */}
            {isDeleted ? (
              <p className="mt-1 text-sm italic text-text-muted">
                [deleted by user]
              </p>
            ) : (
              <div
                className="prose-sm prose-invert mt-1 max-w-none break-words text-sm text-text-primary [&_a]:break-all [&_img]:max-w-full [&_pre]:overflow-x-auto"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(comment.body_md),
                }}
              />
            )}

            {/* Actions: hidden on deleted comments since reply/delete
                no longer apply to a tombstone. */}
            {!isDeleted && (
              <div className="mt-1.5 flex items-center gap-2">
                {depth < MAX_DEPTH && (
                  <button
                    onClick={() => setReplying(!replying)}
                    className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
                  >
                    <Reply size={12} />
                    Reply
                  </button>
                )}
                {isAuthor && (
                  <button
                    onClick={() => removeComment(comment.id)}
                    className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-danger cursor-pointer"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                )}
              </div>
            )}

            {/* Reply composer */}
            {replying && (
              <div className="mt-2 flex flex-col gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  className="h-20 w-full resize-none rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setReplying(false)}
                    className="rounded-md px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitReply}
                    disabled={!replyText.trim() || submitting}
                    className="rounded-md bg-accent/20 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/30 disabled:opacity-40 cursor-pointer"
                  >
                    {submitting ? "Posting..." : "Reply"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Children: hidden when collapsed to match Reddit behaviour. */}
      {!collapsed &&
        comment.children?.map((child) => (
          <CommentNode
            key={child.id}
            comment={child}
            postId={postId}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

interface CommentThreadProps {
  comments: ForumCommentWithAuthor[];
  postId: string;
}

export function CommentThread({ comments, postId }: CommentThreadProps) {
  if (comments.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        No comments yet. Be the first to share your thoughts.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {comments.map((comment) => (
        <CommentNode
          key={comment.id}
          comment={comment}
          postId={postId}
          depth={0}
        />
      ))}
    </div>
  );
}
