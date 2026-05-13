import { useEffect, useMemo, useState } from "react";
import { useReaderStore } from "@/stores/reader-store";
import type { PageRect } from "@/types/annotation";

const HIGHLIGHT_DURATION_MS = 5000;
const FADE_START_MS = 3500;

interface CitationQuoteHighlightLayerProps {
  pageNum: number;
}

/**
 * Transient highlight for LLM citation chips with a quote payload
 * (`[p.N:"…"]`). When the user clicks the chip, the click
 * dispatcher writes a citation into `reader-store.activeCitation`;
 * this layer asks the active doc's adapter to search the quote on
 * its target page, then paints the matched rects with a pulsing
 * amber highlight that fades out after ~5s.
 *
 * Visually distinct from the regular `HighlightLayer` (user
 * highlights, multiply blend) and from `SearchHighlightLayer`
 * (search hit list) — it's a one-shot "the AI is pointing here"
 * marker, not persistent annotation.
 *
 * Off the active page → renders nothing. Wrong doc → nothing.
 * Quote not found → nothing (the page-jump itself already
 * happened in the dispatcher, so the user lands on the right page
 * regardless).
 */
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

  // Run the search whenever a fresh citation lands. Cancellable so
  // a rapid second click on another chip doesn't paint stale rects
  // from the first lookup.
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
        // Restrict to the cited page. The adapter may return matches
        // from the whole doc (the search store usually wants that);
        // here we only want the rects on the target page.
        const pageRects: PageRect[] = [];
        for (const m of matches) {
          if (m.pageNum !== citation.page || !m.rects) continue;
          for (const r of m.rects) {
            if (r.pageNum === citation.page) pageRects.push(r);
          }
        }
        setRects(pageRects);
      } catch {
        // Adapter search can fail for malformed regex / unsupported
        // queries — citations always go through as plain text, so
        // this branch is mostly belt-and-suspenders. Land on the
        // page without a highlight.
        if (!cancelled) setRects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isForThisPage, citation, adapter]);

  // Auto-clear the citation slot once the highlight has fully faded
  // so a later doc-switch + chat-click doesn't briefly flash the
  // previous quote. Tied to the citation timestamp rather than to
  // this layer's mount so re-mounts (page virtualization) don't
  // reset the timer.
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

  // CSS-driven fade: keyframes baked inline so the layer doesn't
  // need a global stylesheet entry. The animation duration matches
  // HIGHLIGHT_DURATION_MS; `forwards` keeps the final state (faded
  // out) so a re-mount after the fade doesn't pop the highlight
  // back to full brightness.
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
