import { Suspense, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, Pencil } from "lucide-react";
import { Button, PromptModal } from "@/components/ui";
import { BookPageContext } from "./BookPageContext";
import { BookPageSidebar } from "./BookPageSidebar";
import { PageTracker } from "./PageTracker";
import { useBookData } from "./useBookData";
import { trackRecentlyViewed } from "@/features/browse/recently-viewed";
import { bookIdSegment, parseBookIdSegment } from "@/lib/slugify";
import { useLibraryStore } from "@/stores/library-store";
import { containsProfanity } from "@/lib/profanity-filter";
import { formatAuthors } from "@/lib/library/format-authors";
import { logError } from "@/lib/logger";
import type { UploadedLibraryItem } from "@/types/catalog";

export function BookPage() {
  const { t } = useTranslation();
  const { bookId: rawBookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // bookId param may carry a slug suffix ("title--<uuid>"); strip to the real id.
  const { id: bookId } = useMemo(
    () => (rawBookId ? parseBookIdSegment(rawBookId) : { id: undefined, slug: null }),
    [rawBookId],
  );

  const { data, loading, notFound, patchUploadedBook } = useBookData(bookId);
  // rename lives here so the sidebar <h1> can open it. only uploaded books rename.
  const [renameOpen, setRenameOpen] = useState(false);

  useEffect(() => {
    if (data?.source === "catalog" && data.book.id) {
      trackRecentlyViewed(data.book.id);
    }
  }, [data?.source, data?.book.id]);

  // canonicalize URL to `<slug>--<id>` once title is known, preserving sub-route tail.
  useEffect(() => {
    if (!data || !rawBookId) return;
    const canonical = bookIdSegment(bookId!, data.book.title);
    if (canonical === rawBookId) return;
    const tail = location.pathname.replace(
      new RegExp(`^/books/${rawBookId}`),
      "",
    );
    navigate(`/books/${canonical}${tail}${location.search}`, {
      replace: true,
    });
  }, [data, bookId, rawBookId, location.pathname, location.search, navigate]);

  if (loading) {
    return <BookPageSkeleton />;
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
      ? formatAuthors(data.book.authors) || unknownAuthor
      : formatAuthors(data.book.authors, data.book.author) || unknownAuthor;
  const coverUrl = data.book.cover_url;

  return (
    <BookPageContext.Provider value={data}>
      {/* mobile stacks; desktop is a two-pane rail + content */}
      <div className="flex min-h-full flex-col md:flex-row">
        {/* aside is sticky + full-height so its right border reaches the viewport bottom */}
        <aside className="md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-glass-border md:bg-glass-bg/40">
          <div className="space-y-3 p-4 md:p-3">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              <ArrowLeft size={14} />
              {t("book.back")}
            </button>

            <div className="flex items-start gap-3">
              <div className="shrink-0">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={title}
                    className="h-20 w-14 rounded-md object-cover shadow-md"
                  />
                ) : (
                  <div className="flex h-20 w-14 items-center justify-center rounded-md bg-gradient-to-br from-accent/30 to-accent-blue/30 shadow-md">
                    <BookOpen size={20} className="text-white/20" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {data.source === "uploaded" ? (
                  <button
                    type="button"
                    onClick={() => setRenameOpen(true)}
                    title={t("library.actions.rename", {
                      defaultValue: "Rename",
                    })}
                    className="group/title -mx-1 flex w-full items-start gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-glass-hover cursor-pointer"
                  >
                    <h1 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-text-primary">
                      {title}
                    </h1>
                    <Pencil
                      size={11}
                      className="mt-0.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover/title:opacity-100"
                    />
                  </button>
                ) : (
                  <h1 className="line-clamp-2 text-sm font-semibold text-text-primary">
                    {title}
                  </h1>
                )}
                <p className="line-clamp-1 text-2xs text-text-muted">
                  {authors}
                </p>
                {data.source === "uploaded" && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
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

            {/* pass slug-suffixed segment so sub-tab clicks avoid a redirect bounce */}
            <BookPageSidebar bookId={rawBookId ?? bookId} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
          {/* Local Suspense so a lazy tab chunk only skeletons the
              content area; without it the tab's chunk load bubbles to
              AppLayout's Suspense and a full-page spinner wipes out the
              book chrome + skeleton. */}
          <Suspense fallback={<BookTabSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      {data.source === "uploaded" && (
        <PromptModal
          open={renameOpen}
          title={t("library.actions.renameBookTitle", {
            defaultValue: "Rename book",
          })}
          defaultValue={data.book.title}
          validate={(value) => {
            if (value.length > 200) {
              return t("library.actions.renameTooLong", {
                defaultValue: "Title is too long (max 200 characters).",
              });
            }
            if (containsProfanity(value)) {
              return t("library.actions.renameProfanity", {
                defaultValue: "Title contains disallowed language.",
              });
            }
            return null;
          }}
          onClose={() => setRenameOpen(false)}
          onSubmit={(value) => {
            // renameBook only touches book.title, so empty file_name/storage_path is fine.
            const entry: UploadedLibraryItem = {
              source: "uploaded",
              id: data.book.id,
              folder_id: data.book.folder_id,
              added_at: data.book.created_at,
              book: {
                id: data.book.id,
                title: data.book.title,
                authors: data.book.authors,
                author: data.book.author,
                cover_url: data.book.cover_url,
                page_count: data.book.page_count,
                format: data.book.format,
                file_hash: data.book.file_hash,
                storage_path: data.storagePath ?? "",
                size_bytes: data.sizeBytes,
                file_name: data.fileName ?? "",
              },
            };
            // optimistic local patch so sidebar + URL slug update before the round-trip
            const trimmed = value.trim();
            patchUploadedBook({ title: trimmed });
            void useLibraryStore
              .getState()
              .renameBook(entry, value)
              .catch((err) => {
                logError("book:renameTitle", err);
                // revert optimistic patch on failure
                patchUploadedBook({ title: data.book.title });
              });
          }}
        />
      )}
    </BookPageContext.Provider>
  );
}

// Content-area skeleton shown while a lazy tab chunk loads, so the book
// chrome stays put instead of a full-page spinner.
function BookTabSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-2/5 rounded bg-bg-tertiary" />
        <div className="h-3 w-4/5 rounded bg-bg-tertiary/70" />
        <div className="h-3 w-3/5 rounded bg-bg-tertiary/70" />
      </div>
      <div className="flex gap-2">
        <div className="h-9 w-28 rounded-lg bg-bg-tertiary/70" />
        <div className="h-9 w-28 rounded-lg bg-bg-tertiary/70" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-bg-tertiary/50" />
        ))}
      </div>
    </div>
  );
}

// skeleton matches the loaded layout's shapes/sizes to avoid a jump on resolve
function BookPageSkeleton() {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-glass-border md:bg-glass-bg/40">
        <div className="space-y-3 p-4 md:p-3">
          <div className="h-3 w-16 animate-pulse rounded bg-bg-tertiary/70" />
          <div className="flex animate-pulse items-start gap-3">
            <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-md bg-bg-tertiary shadow-md">
              <BookOpen size={20} className="text-white/10" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-4/5 rounded bg-bg-tertiary" />
              <div className="h-3 w-3/5 rounded bg-bg-tertiary" />
              <div className="h-2.5 w-2/5 rounded bg-bg-tertiary/70" />
            </div>
          </div>
          <div className="animate-pulse space-y-1.5 rounded-md border border-glass-border bg-bg-tertiary/40 p-2">
            <div className="h-2.5 w-1/3 rounded bg-bg-tertiary" />
            <div className="h-2 w-full rounded bg-bg-tertiary/70" />
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-7 w-full animate-pulse rounded bg-bg-tertiary/60"
              />
            ))}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="animate-pulse space-y-3">
            <div className="h-7 w-3/4 rounded bg-bg-tertiary" />
            <div className="h-4 w-1/3 rounded bg-bg-tertiary/70" />
          </div>
          <div className="flex animate-pulse gap-2">
            <div className="h-8 w-24 rounded bg-bg-tertiary" />
            <div className="h-8 w-24 rounded bg-bg-tertiary" />
            <div className="h-8 w-28 rounded bg-bg-tertiary" />
          </div>
          <div className="animate-pulse space-y-2">
            <div className="h-3 w-full rounded bg-bg-tertiary/70" />
            <div className="h-3 w-full rounded bg-bg-tertiary/70" />
            <div className="h-3 w-5/6 rounded bg-bg-tertiary/70" />
            <div className="h-3 w-2/3 rounded bg-bg-tertiary/70" />
          </div>
          <div className="grid animate-pulse gap-3 sm:grid-cols-2">
            <div className="h-24 rounded-md border border-glass-border bg-bg-tertiary/40" />
            <div className="h-24 rounded-md border border-glass-border bg-bg-tertiary/40" />
          </div>
        </div>
      </main>
    </div>
  );
}
