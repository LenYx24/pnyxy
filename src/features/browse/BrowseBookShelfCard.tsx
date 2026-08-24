import { BookOpen, FileX2 } from "lucide-react";
import { StarRatingDisplay } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CatalogBook } from "@/types/catalog";

interface BrowseBookShelfCardProps {
  book: CatalogBook;
  onClick: () => void;
}

/**
 * Compact shelf card. Blends into the page, no border, no card
 * background, just the cover and a small metadata block beneath.
 * The cover lives inside a fixed-ratio container so cards in a row
 * all have the same height regardless of cover dimensions.
 */
export function BrowseBookShelfCard({ book, onClick }: BrowseBookShelfCardProps) {
  const hasFile = !!(book.ia_id || book.download_url);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${book.title}${book.authors.length ? " - " + book.authors.join(", ") : ""}`}
      className={cn(
        "group flex w-full flex-col text-left transition-transform",
        "cursor-pointer focus:outline-none",
      )}
    >
      <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md border border-glass-border bg-bg-tertiary shadow-sm transition-shadow group-hover:shadow-md">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/25 to-accent-blue/25">
            <BookOpen size={28} className="text-white/20" />
          </div>
        )}
        {!hasFile && (
          <span
            className="absolute right-1 top-1 rounded bg-bg-primary/80 p-0.5 text-text-muted backdrop-blur-sm"
            title="Metadata only, no file attached"
          >
            <FileX2 size={10} />
          </span>
        )}
      </div>
      {/* Fixed-height metadata block. h-12 reserves exactly 3rem so
          cards in a shelf align identically whether StarRatingDisplay
          renders or not (it returns null when there are 0 ratings).
          overflow-hidden clips anything unexpectedly tall so a stray
          card can't visually grow the whole row. */}
      <div className="mt-1.5 flex h-12 min-w-0 flex-col overflow-hidden">
        <h3 className="truncate text-2xs font-semibold leading-tight text-text-primary">
          {book.title}
        </h3>
        <p className="truncate text-2xs leading-tight text-text-muted">
          {book.authors.join(", ") || "-"}
        </p>
        <StarRatingDisplay
          avg={book.rating_avg}
          count={book.rating_count}
          size={9}
          className="mt-0.5"
        />
      </div>
    </button>
  );
}
