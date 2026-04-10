import { MessageSquare } from "lucide-react";
import { useAnnotationStore } from "@/stores/annotation-store";
import { cn } from "@/lib/cn";

interface CommentMarkersProps {
  pageNum: number;
}

export function CommentMarkers({ pageNum }: CommentMarkersProps) {
  const comments = useAnnotationStore((s) => s.comments);
  const selectedAnnotationId = useAnnotationStore((s) => s.selectedAnnotationId);
  const setSelectedAnnotation = useAnnotationStore((s) => s.setSelectedAnnotation);

  const pageComments = Array.from(comments.values()).filter((c) =>
    c.selection.rects.some((r) => r.pageNum === pageNum),
  );

  if (pageComments.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }}>
      {pageComments.map((comment) => {
        const pageRects = comment.selection.rects.filter(
          (r) => r.pageNum === pageNum,
        );
        const topRect = pageRects.reduce((a, b) => (a.y < b.y ? a : b));
        const isSelected = selectedAnnotationId === comment.id;

        return (
          <div key={comment.id}>
            {/* Dotted underline under selection */}
            {pageRects.map((rect, i) => (
              <div
                key={`underline-${i}`}
                className="absolute"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${(rect.y + rect.height) * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: 2,
                  borderBottom: `2px dotted ${comment.resolved ? "rgba(107, 107, 128, 0.5)" : "rgba(139, 92, 246, 0.6)"}`,
                }}
              />
            ))}

            {/* Comment icon in right margin */}
            <button
              className={cn(
                "absolute pointer-events-auto cursor-pointer rounded-full p-1 transition-all",
                isSelected
                  ? "bg-accent-purple text-white shadow-lg scale-110"
                  : comment.resolved
                    ? "bg-glass-bg text-text-muted hover:bg-glass-hover"
                    : "bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/30",
              )}
              style={{
                right: -28,
                top: `${topRect.y * 100}%`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedAnnotation(isSelected ? null : comment.id);
              }}
              title={comment.resolved ? "Resolved comment" : "Comment"}
            >
              <MessageSquare size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
