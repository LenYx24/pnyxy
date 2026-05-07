import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { BookPageContext } from "./BookPageContext";
import { BookPageSidebar } from "./BookPageSidebar";
import { PageTracker } from "./PageTracker";
import { useBookData } from "./useBookData";
import { trackRecentlyViewed } from "@/features/browse/recently-viewed";
import { bookIdSegment, parseBookIdSegment } from "@/lib/slugify";

export function BookPage() {
  const { t } = useTranslation();
  const { bookId: rawBookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // The :bookId URL param may include a decorative slug suffix
  // ("voros-es-fekete--<uuid>"). Parse the real id out for the DB
  // lookup; preserve the raw segment for the redirect comparison.
  const { id: bookId } = useMemo(
    () => (rawBookId ? parseBookIdSegment(rawBookId) : { id: undefined, slug: null }),
    [rawBookId],
  );

  const { data, loading, notFound } = useBookData(bookId);

  // Track catalog-book visits for the "Recently viewed" shelf (which
  // will live on the future Home page). Non-catalog books are ignored.
  useEffect(() => {
    if (data?.source === "catalog" && data.book.id) {
      trackRecentlyViewed(data.book.id);
    }
  }, [data?.source, data?.book.id]);

  // Canonicalize the URL once the book title is known. If the user
  // landed on a bare `/books/<id>` link or a stale slug, swap it
  // for `<slug>--<id>` via `replace` (no history entry, no flash).
  // Sub-routes (notes, bookmarks, …) are preserved by inheriting
  // whatever follows the bookId segment in the current pathname.
  useEffect(() => {
    if (!data || !rawBookId) return;
    const canonical = bookIdSegment(bookId!, data.book.title);
    if (canonical === rawBookId) return;
    // Replace the first path segment after `/books/` with the
    // canonical value, leaving everything past it intact.
    const tail = location.pathname.replace(
      new RegExp(`^/books/${rawBookId}`),
      "",
    );
    navigate(`/books/${canonical}${tail}${location.search}`, {
      replace: true,
    });
  }, [data, bookId, rawBookId, location.pathname, location.search, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (notFound || !data || !bookId) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">{t("book.notFound")}</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t("book.goBack")}
        </Button>
      </div>
    );
  }

  const title = data.book.title;
  const unknownAuthor = t("book.unknownAuthor");
  const authors =
    data.source === "catalog"
      ? data.book.authors.join(", ") || unknownAuthor
      : data.book.author || unknownAuthor;
  const coverUrl = data.book.cover_url;

  return (
    <BookPageContext.Provider value={data}>
      {/* Mobile keeps the older stacked layout (header + dropdown
          nav + content). Desktop gets the chat-style two-pane: a
          fixed-width left rail with a sticky sidebar nav, and the
          remaining viewport for the active tab — books with a lot
          of bookmarks / notes / whiteboards now use the screen
          properly instead of being capped at max-w-6xl. */}
      <div className="flex min-h-full flex-col md:flex-row">
        {/* Desktop sidebar follows the reader's TOC pattern: the
            <aside> itself is sticky + viewport-height + overflow-y
            auto, so its right border *always* reaches the bottom of
            the viewport, regardless of how short or tall the main
            pane is. Previously the border ended where the aside's
            content ended, which looked truncated when the main pane
            was longer than the nav. */}
        <aside className="md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-glass-border md:bg-glass-bg/40">
          <div className="space-y-3 p-4 md:p-3">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              <ArrowLeft size={14} />
              {t("book.back")}
            </button>

            {/* Compact book identity: cover + title stacked, just
                enough to anchor the sidebar without shrinking the
                main pane. */}
            <div className="flex items-start gap-3">
              <div className="shrink-0">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={title}
                    className="h-20 w-14 rounded-md object-cover shadow-md"
                  />
                ) : (
                  <div className="flex h-20 w-14 items-center justify-center rounded-md bg-gradient-to-br from-accent-purple/30 to-accent-blue/30 shadow-md">
                    <BookOpen size={20} className="text-white/20" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="line-clamp-2 text-sm font-semibold text-text-primary">
                  {title}
                </h1>
                <p className="line-clamp-1 text-[11px] text-text-muted">
                  {authors}
                </p>
                {data.source === "uploaded" && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent-purple/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-purple">
                    {t("book.uploadedBadge")}
                  </span>
                )}
              </div>
            </div>

            <PageTracker
              docId={bookId}
              pageCount={
                data.source === "catalog"
                  ? data.book.page_count ?? null
                  : data.book.page_count ?? null
              }
            />

            {/* Sidebar links keep the slug-suffixed segment so
                sub-tab clicks land on canonical URLs immediately
                rather than going through a redirect bounce. */}
            <BookPageSidebar bookId={rawBookId ?? bookId} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </BookPageContext.Provider>
  );
}
