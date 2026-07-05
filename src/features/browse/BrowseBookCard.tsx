import { BookOpen, FileX2 } from "lucide-react";
import { StarRatingDisplay } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CatalogBook } from "@/types/catalog";

interface BrowseBookCardProps {
  book: CatalogBook;
  onClick: () => void;
}

/**
 * Grid card for Browse. Matches the shelf card visually, no card
 * chrome, fixed 2:3 cover ratio, so rows stay aligned regardless
 * of the cover's actual aspect. A single file-availability glyph
 * (bottom right) flags metadata-only books; readable books wear no
 * badge, keeping chrome to a minimum.
 */
export function BrowseBookCard({ book, onClick }: BrowseBookCardProps) {
  const hasFile = !!(book.ia_id || book.download_url);

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${book.title}${book.authors.length ? " — " + book.authors.join(", ") : ""}`}
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
            <BookOpen size={36} className="text-white/20" />
          </div>
        )}
        {!hasFile && (
          <span
            className="absolute right-1.5 top-1.5 rounded bg-bg-primary/80 p-1 text-text-muted backdrop-blur-sm"
            title="Metadata only — no file attached"
          >
            <FileX2 size={12} />
          </span>
        )}
      </div>
      <div className="mt-2 min-w-0">
        <h3 className="truncate text-sm font-semibold leading-tight text-text-primary">
          {book.title}
        </h3>
        <p className="truncate text-xs leading-tight text-text-muted">
          {book.authors.join(", ") || "Unknown author"}
        </p>
        <StarRatingDisplay
          avg={book.rating_avg}
          count={book.rating_count}
          className="mt-1"
        />
      </div>
    </button>
  );
}
