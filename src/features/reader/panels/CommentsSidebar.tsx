import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, Check, X } from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useReaderStore } from "@/stores/reader-store";
import { cn } from "@/lib/cn";
import type { Comment } from "@/types/annotation";

interface CommentsSidebarProps {
  /** Close the comments panel. Omitted when rendered outside a dockview panel. */
  onClose?: () => void;
}

export function CommentsSidebar({ onClose }: CommentsSidebarProps) {
  const { t } = useTranslation();
  const comments = useAnnotationStore((s) => s.comments);
  const selectedAnnotationId = useAnnotationStore(
    (s) => s.selectedAnnotationId,
  );
  const setSelectedAnnotation = useAnnotationStore(
    (s) => s.setSelectedAnnotation,
  );
  const goToPage = useReaderStore((s) => s.goToPage);

  // Group comments by page number
  const groupedComments = useMemo(() => {
    const groups = new Map<number, Comment[]>();
    for (const comment of comments.values()) {
      const pageNum = comment.selection.rects[0]?.pageNum ?? 0;
      const existing = groups.get(pageNum) || [];
      existing.push(comment);
      groups.set(pageNum, existing);
    }
    // Sort by page number
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [comments]);

  const handleCommentClick = (comment: Comment) => {
    const pageNum = comment.selection.rects[0]?.pageNum;
    if (pageNum) {
      goToPage(pageNum);
    }
    setSelectedAnnotation(comment.id);
  };

  const header = onClose ? (
    <div className="flex shrink-0 items-center justify-between border-b border-glass-border px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <MessageSquare size={14} />
        {t("reader.comments.title")}
      </span>
      <button
        type="button"
        onClick={onClose}
        title={t("reader.comments.close")}
        aria-label={t("reader.comments.close")}
        className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  ) : null;

  if (comments.size === 0) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <MessageSquare size={32} className="text-text-muted mb-3" />
          <p className="text-sm text-text-secondary">
            {t("reader.comments.empty")}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {t("reader.comments.emptyHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 overflow-y-auto">
        {groupedComments.map(([pageNum, pageComments]) => (
          <div key={pageNum}>
            <div className="sticky top-0 bg-bg-secondary/80  px-3 py-1.5 border-b border-glass-border">
              <span className="text-xs font-medium text-text-muted">
                Page {pageNum}
              </span>
            </div>
            {pageComments.map((comment) => {
              const isSelected = selectedAnnotationId === comment.id;
              return (
                <button
                  key={comment.id}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b border-glass-border transition-colors cursor-pointer",
                    isSelected ? "bg-accent/10" : "hover:bg-glass-hover",
                    comment.resolved && "opacity-60",
                  )}
                  onClick={() => handleCommentClick(comment)}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-text-muted line-clamp-1 italic mb-1">
                        &ldquo;{comment.selection.text}&rdquo;
                      </p>
                      <p className="text-sm text-text-primary line-clamp-2">
                        {comment.messages[0]?.text}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {comment.messages.length > 1 && (
                          <span className="text-2xs text-text-muted">
                            {comment.messages.length} messages
                          </span>
                        )}
                        {comment.resolved && (
                          <span className="flex items-center gap-0.5 text-2xs text-success">
                            <Check size={10} /> Resolved
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
