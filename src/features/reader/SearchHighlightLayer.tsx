import { useMemo } from "react";
import { useSearchStore } from "@/stores/search-store";

interface SearchHighlightLayerProps {
  pageNum: number;
}

/**
 * PDF-only overlay. Paints the per-page rects on every search match.
 * The current match gets a brighter highlight + ring.
 */
export function SearchHighlightLayer({ pageNum }: SearchHighlightLayerProps) {
  const matches = useSearchStore((s) => s.matches);
  const currentIdx = useSearchStore((s) => s.currentIdx);

  // Filter to just this page before building the element list. The
  // total match count is capped by how much text fits on screen, so
  // this is cheap.
  const pageMatches = useMemo(() => {
    const out: { rects: { x: number; y: number; width: number; height: number }[]; idx: number }[] = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m.pageNum !== pageNum || !m.rects) continue;
      out.push({
        rects: m.rects.filter((r) => r.pageNum === pageNum),
        idx: i,
      });
    }
    return out;
  }, [matches, pageNum]);

  if (pageMatches.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 4 }}
    >
      {pageMatches.map(({ rects, idx }) =>
        rects.map((rect, i) => {
          const isCurrent = idx === currentIdx;
          return (
            <div
              key={`${idx}-${i}`}
              className="absolute"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
                backgroundColor: isCurrent
                  ? "rgba(255, 165, 0, 0.65)"
                  : "rgba(255, 235, 59, 0.45)",
                outline: isCurrent ? "2px solid rgba(255, 140, 0, 0.9)" : "none",
                mixBlendMode: "multiply",
              }}
            />
          );
        }),
      )}
    </div>
  );
}
