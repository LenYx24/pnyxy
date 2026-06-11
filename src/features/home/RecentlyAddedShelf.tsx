import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { PdfCoverThumbnail } from "@/components/ui/PdfCoverThumbnail";
import type { UnifiedLibraryItem } from "@/types/catalog";
import { Shelf } from "@/features/browse/Shelf";

const RECENT_LIMIT = 12;

/**
 * Shelf of the user's recently-added library items. Replaces the
 * old "Recently added" tab on the Library page so the Home page
 * surfaces what the user just put in (instead of forcing them to
 * jump to /library to find it). Renders nothing when the list is
 * empty so first-time users don't see a placeholder.
 */
export function RecentlyAddedShelf() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openUploadedBook } = useOpenUploadedDocument();
  const books = useLibraryStore((s) => s.books);

  // `books` is sorted newest-first by the library store's fetch.
  const recent = books.slice(0, RECENT_LIMIT);

  return (
    <Shelf
      title={t("home.shelves.recentlyAdded")}
      itemCount={recent.length}
      seeAllHref="/library"
      seeAllLabel={t("home.seeAll")}
    >
      {recent.map((entry) => (
        <div
          key={`${entry.source}-${entry.id}`}
          className="w-[7.5rem] shrink-0 snap-start sm:w-[8.5rem]"
        >
          <RecentlyAddedCard
            entry={entry}
            onClick={() => {
              // Uploaded books open straight in the reader (one click,
              // matching the new per-book Open button on /library);
              // catalog entries route to the metadata page since
              // they're often "saved for later" rather than read here.
              if (entry.source === "uploaded") {
                void openUploadedBook(entry);
              } else {
                navigate(`/books/${entry.catalog_book_id}`);
              }
            }}
          />
        </div>
      ))}
    </Shelf>
  );
}

function RecentlyAddedCard({
  entry,
  onClick,
}: {
  entry: UnifiedLibraryItem;
  onClick: () => void;
}) {
  const title =
    entry.source === "catalog" ? entry.catalog_book.title : entry.book.title;
  const author =
    entry.source === "catalog"
      ? entry.catalog_book.authors?.join(", ") || ""
      : entry.book.author || "";
  const cover =
    entry.source === "catalog"
      ? entry.catalog_book.cover_url
      : entry.book.cover_url;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${title}${author ? " — " + author : ""}`}
      className={cn(
        "group flex w-full flex-col text-left transition-transform",
        "cursor-pointer focus:outline-none",
      )}
    >
      <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md border border-glass-border bg-bg-tertiary shadow-sm transition-shadow group-hover:shadow-md">
        {cover ? (
          <img
            src={cover}
            alt={title}
            className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
          />
        ) : entry.source === "uploaded" ? (
          <PdfCoverThumbnail
            storagePath={entry.book.storage_path}
            fallbackLetter={title.charAt(0)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/25 to-accent-blue/25">
            <BookOpen size={28} className="text-white/20" />
          </div>
        )}
      </div>
      <div className="mt-1.5 flex h-9 min-w-0 flex-col overflow-hidden">
        <h3 className="truncate text-2xs font-semibold leading-tight text-text-primary">
          {title}
        </h3>
        <p className="truncate text-2xs leading-tight text-text-muted">
          {author || "—"}
        </p>
      </div>
    </button>
  );
}
