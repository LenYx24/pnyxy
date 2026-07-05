import { useEffect, useMemo, useState } from "react";
import { useReaderStore } from "@/stores/reader-store";
import type { PageRect } from "@/types/annotation";

const HIGHLIGHT_DURATION_MS = 5000;
const FADE_START_MS = 3500;

interface CitationQuoteHighlightLayerProps {
  pageNum: number;
}

/** Transient amber highlight for a clicked citation chip's quote, fades out after ~5s. Renders nothing off the active page/doc or when the quote isn't found. */
export function CitationQuoteHighlightLayer({
  pageNum,
}: CitationQuoteHighlightLayerProps) {
  const citation = useReaderStore((s) => s.activeCitation);
  const setActiveCitation = useReaderStore((s) => s.setActiveCitation);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const adapter = useReaderStore((s) =>
    s.activeDocumentId
      ? s.documents.get(s.activeDocumentId)?.adapter
      : undefined,
  );

  const isForThisPage =
    !!citation &&
    citation.docId === activeDocumentId &&
    citation.page === pageNum;

  const [rects, setRects] = useState<PageRect[]>([]);

  // cancellable so a rapid second chip click doesn't paint stale rects
  useEffect(() => {
    if (!isForThisPage || !citation || !adapter?.search) {
      setRects([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const matches = await adapter.search!(citation.quote, {
          caseSensitive: false,
          wholeWord: false,
          regex: false,
        });
        if (cancelled) return;
        // adapter may return whole-doc matches; keep only the cited page's rects
        const pageRects: PageRect[] = [];
        for (const m of matches) {
          if (m.pageNum !== citation.page || !m.rects) continue;
          for (const r of m.rects) {
            if (r.pageNum === citation.page) pageRects.push(r);
          }
        }
        setRects(pageRects);
      } catch {
        if (!cancelled) setRects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isForThisPage, citation, adapter]);

  // clear the citation once faded so a later doc-switch doesn't flash the old quote.
  // timer keyed to citation.createdAt so page-virtualization remounts don't reset it
  useEffect(() => {
    if (!citation) return;
    const remaining =
      HIGHLIGHT_DURATION_MS - (Date.now() - citation.createdAt);
    if (remaining <= 0) {
      setActiveCitation(null);
      return;
    }
    const t = setTimeout(() => setActiveCitation(null), remaining);
    return () => clearTimeout(t);
  }, [citation, setActiveCitation]);

  // `forwards` keeps the faded-out state so a remount after fade doesn't flash it back to full
  const fadeStyle = useMemo<React.CSSProperties>(() => {
    if (!citation) return {};
    const elapsed = Date.now() - citation.createdAt;
    const delay = Math.max(0, FADE_START_MS - elapsed);
    const duration = Math.max(0, HIGHLIGHT_DURATION_MS - elapsed - delay);
    return {
      animation: `pnyxy-citation-fade ${duration}ms ease-out ${delay}ms forwards`,
    };
  }, [citation]);

  if (!isForThisPage || rects.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes pnyxy-citation-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes pnyxy-citation-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0); }
          50% { box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.35); }
        }
      `}</style>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 5, ...fadeStyle }}
      >
        {rects.map((rect, i) => (
          <div
            key={i}
            className="absolute rounded-[2px]"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
              backgroundColor: "rgba(251, 191, 36, 0.55)",
              outline: "2px solid rgba(245, 158, 11, 0.9)",
              outlineOffset: "1px",
              mixBlendMode: "multiply",
              animation:
                "pnyxy-citation-pulse 1.4s ease-in-out 2 forwards",
            }}
          />
        ))}
      </div>
    </>
  );
}
