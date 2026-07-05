import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Trash2, X } from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { cn } from "@/lib/cn";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;

  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const POPOVER_WIDTH = 288;

export function CommentPopover() {
  const selectedAnnotationId = useAnnotationStore(
    (s) => s.selectedAnnotationId,
  );
  const comments = useAnnotationStore((s) => s.comments);
  const addReply = useAnnotationStore((s) => s.addReply);
  const resolveComment = useAnnotationStore((s) => s.resolveComment);
  const removeComment = useAnnotationStore((s) => s.removeComment);
  const setSelectedAnnotation = useAnnotationStore(
    (s) => s.setSelectedAnnotation,
  );

  const [replyText, setReplyText] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const comment = selectedAnnotationId
    ? comments.get(selectedAnnotationId)
    : null;

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedAnnotation(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setSelectedAnnotation]);

  // Close on click outside. We identify "inside the popover" via the
  // `data-comment-popover` attribute on the root rather than by
  // `popoverRef.current.contains(target)`, the ref-based check is
  // sensitive to attachment timing (portal + React StrictMode double-
  // mount can leave `popoverRef.current` pointing at a stale node for
  // a frame, causing every click *inside* the popover to dismiss it).
  // The attribute-based form mirrors what AnnotationContextMenu uses
  // for the same reason.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-comment-popover]")) return;
      if (target.closest("[data-annotation-context-menu]")) return;
      // Also leave the popover open when the click landed on a
      // CommentMarker, toggling the same marker should dismiss it,
      // but that path is handled by the marker's own onClick (which
      // calls setSelectedAnnotation(null) explicitly). For clicks on
      // *other* markers we let the normal dismissal happen so the
      // newly-clicked marker re-opens the popover for its comment.
      setSelectedAnnotation(null);
    };
    if (comment) {
      // Defer one tick so the click that opened the popover (via a
      // CommentMarker) doesn't itself close it.
      const timer = setTimeout(() => {
        document.addEventListener("mousedown", handleClick);
      }, 100);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("mousedown", handleClick);
      };
    }
  }, [comment, setSelectedAnnotation]);

  const handleSubmitReply = useCallback(() => {
    if (!comment || !replyText.trim()) return;
    addReply(comment.id, replyText.trim());
    setReplyText("");
    textareaRef.current?.focus();
  }, [comment, replyText, addReply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmitReply();
      }
    },
    [handleSubmitReply],
  );

  if (!comment) return null;

  // Find the first rect with finite coordinates. A historically
  // corrupted comment (saved when its source page had zero
  // dimensions, dividing by 0) can carry NaN positions; those
  // rects would otherwise propagate into the `top`/`left` styles
  // and trigger React's "invalid value for the `top` css style
  // property" warnings every time the popover mounts.
  const firstRect = comment.selection.rects.find(
    (r) =>
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.width) &&
      Number.isFinite(r.height),
  );
  if (!firstRect) return null;

  // Find the page element to compute absolute position
  const pageEl = document.querySelector(
    `[data-page-number="${firstRect.pageNum}"]`,
  ) as HTMLElement | null;

  let left: number;
  let top: number;

  if (pageEl) {
    const pageBounds = pageEl.getBoundingClientRect();
    const rawTop = pageBounds.top + firstRect.y * pageBounds.height;
    const rawLeft = pageBounds.right + 8;

    // Clamp to viewport
    top = Math.max(60, Math.min(rawTop, window.innerHeight - 300));

    // If popover would overflow the right side, place it to the left of the page
    if (rawLeft + POPOVER_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, pageBounds.left - POPOVER_WIDTH - 8);
    } else {
      left = rawLeft;
    }
  } else {
    // Fallback: center in viewport
    left = Math.max(8, (window.innerWidth - POPOVER_WIDTH) / 2);
    top = window.innerHeight / 2 - 150;
  }

  const popoverContent = (
    <div
      ref={popoverRef}
      data-comment-popover
      className="rounded-lg border border-glass-border bg-bg-secondary/95 backdrop-blur-md shadow-xl overflow-hidden"
      style={{
        position: "fixed",
        zIndex: 100,
        left,
        top,
        width: POPOVER_WIDTH,
      }}
    >
      {/* Quoted text */}
      <div className="border-b border-glass-border px-3 py-2">
        <p className="text-xs text-text-muted line-clamp-2 italic">
          &ldquo;{comment.selection.text}&rdquo;
        </p>
      </div>

      {/* Messages thread */}
      <div className="max-h-60 overflow-y-auto px-3 py-2 space-y-2">
        {comment.messages.map((msg) => (
          <div key={msg.id}>
            <p
              className={cn(
                "text-sm",
                comment.resolved ? "text-text-muted" : "text-text-primary",
              )}
            >
              {msg.text}
            </p>
            <span className="text-2xs text-text-muted">
              {formatTime(msg.createdAt)}
            </span>
          </div>
        ))}
      </div>

      {/* Reply input */}
      {!comment.resolved && (
        <div className="border-t border-glass-border px-3 py-2">
          <textarea
            ref={textareaRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Reply..."
            className="w-full h-12 rounded border border-glass-border bg-glass-bg px-2 py-1.5 text-xs text-text-primary outline-none resize-none focus:border-accent"
          />
          <div className="flex justify-end mt-1">
            <button
              className="rounded bg-accent/20 px-2 py-1 text-xs text-accent hover:bg-accent/30 transition-colors cursor-pointer disabled:opacity-40"
              disabled={!replyText.trim()}
              onClick={handleSubmitReply}
            >
              Reply
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center border-t border-glass-border px-2 py-1.5 gap-1">
        <button
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors cursor-pointer",
            comment.resolved
              ? "text-success bg-success/10 hover:bg-success/20"
              : "text-text-muted hover:text-text-secondary hover:bg-glass-hover",
          )}
          onClick={() => resolveComment(comment.id)}
          title={comment.resolved ? "Unresolve" : "Resolve"}
        >
          <Check size={12} />
          {comment.resolved ? "Resolved" : "Resolve"}
        </button>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-danger/60 hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
          onClick={() => removeComment(comment.id)}
          title="Delete comment"
        >
          <Trash2 size={12} />
        </button>
        <button
          className="rounded px-1.5 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          onClick={() => setSelectedAnnotation(null)}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );

  // Portal to document.body so dockview overflow doesn't clip it
  return createPortal(popoverContent, document.body);
}
