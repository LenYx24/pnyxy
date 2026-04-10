import { useAnnotationStore } from "@/stores/annotation-store";
import type { HighlightColor } from "@/types/annotation";
import { cn } from "@/lib/cn";

const COLOR_MAP: Record<HighlightColor, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  orange: "#fb923c",
};

interface HighlightLayerProps {
  pageNum: number;
}

export function HighlightLayer({ pageNum }: HighlightLayerProps) {
  const highlights = useAnnotationStore((s) => s.highlights);
  const selectedAnnotationId = useAnnotationStore(
    (s) => s.selectedAnnotationId,
  );

  const pageHighlights = Array.from(highlights.values()).filter((h) =>
    h.selection.rects.some((r) => r.pageNum === pageNum),
  );

  if (pageHighlights.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 3 }}
    >
      {pageHighlights.map((highlight) =>
        highlight.selection.rects
          .filter((r) => r.pageNum === pageNum)
          .map((rect, i) => {
            const isSelected = selectedAnnotationId === highlight.id;
            return (
              <div
                key={`${highlight.id}-${i}`}
                data-highlight-id={highlight.id}
                className={cn(
                  "absolute pointer-events-none transition-opacity",
                  isSelected && "ring-2 ring-white/40 rounded-sm",
                )}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  backgroundColor: COLOR_MAP[highlight.color],
                  opacity: isSelected ? 0.5 : 0.35,
                  mixBlendMode: "multiply",
                }}
              />
            );
          }),
      )}
    </div>
  );
}
