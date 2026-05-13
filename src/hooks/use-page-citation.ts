import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useReaderStore } from "@/stores/reader-store";

/**
 * Returns a `MouseEvent` handler intended for an AI message
 * container. It intercepts clicks on `<a href="/reader/<id>?page=N">`
 * citations the markdown renderer emits and routes them intelligently:
 *
 *   1. If the reader already has the matching doc loaded and active,
 *      just call `goToPage(N)`. No navigation, no re-mount, instant
 *      jump while staying in whatever surface the user is in
 *      (e.g. the in-reader AI panel).
 *
 *   2. Otherwise, hand off to react-router's `navigate(href)`. The
 *      ReaderPage's `?page=` consumer (gated on `activeDocumentId
 *      === bookId` after the round-1 fix) takes it from there.
 *
 * Falling back to react-router instead of letting the browser follow
 * the anchor avoids a full page reload — the SPA shell stays mounted.
 */
export function usePageCitationDispatch() {
  const navigate = useNavigate();
  return useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const anchor = (e.target as HTMLElement)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Only intercept reader page citations. Other links (catalog
      // images, external URLs, etc.) keep their default behavior.
      const match = /^\/reader\/([^/?#]+)(?:\?|#|$)/.exec(href);
      if (!match) return;
      const url = new URL(href, window.location.origin);
      const docId = match[1];
      const pageStr = url.searchParams.get("page");
      const page = pageStr ? Number.parseInt(pageStr, 10) : NaN;
      if (!Number.isFinite(page) || page < 1) {
        // Plain doc link with no page — still let react-router
        // handle it instead of a hard reload.
        e.preventDefault();
        navigate(href);
        return;
      }

      // Optional `q=` payload — the model's `[p.N:"quote"]` chips
      // pass the verbatim passage so the reader can paint a
      // temporary highlight on arrival. Decoded once here; the
      // store slot triggers `CitationQuoteHighlightLayer`.
      const quote = url.searchParams.get("q") ?? "";
      const arm = useReaderStore.getState().setActiveCitation;
      if (quote) {
        arm({ docId, page, quote, createdAt: Date.now() });
      } else {
        arm(null);
      }

      e.preventDefault();
      const active = useReaderStore.getState().getActiveDoc();
      if (active && active.meta.id === docId) {
        useReaderStore.getState().goToPage(page);
        return;
      }
      navigate(href);
    },
    [navigate],
  );
}
