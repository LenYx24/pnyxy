import { BookOpen } from "lucide-react";
import { GlassCard, StarRatingDisplay } from "@/components/ui";
import type { CatalogBook } from "@/types/catalog";

interface BrowseBookShelfCardProps {
  book: CatalogBook;
  onClick: () => void;
}

/**
 * Compact variant of BrowseBookCard for horizontal shelves. Drops
 * the description, free-badge, and body padding so the card fits
 * inside a ~160-176px shelf slot without bloating vertical space on
 * the browse page. Title + author only; description lives on the
 * book detail page.
 */
export function BrowseBookShelfCard({ book, onClick }: BrowseBookShelfCardProps) {
  return (
    <GlassCard className="cursor-pointer overflow-hidden" onClick={onClick}>
      {book.cover_url ? (
        <img
          src={book.cover_url}
          alt={book.title}
          className="aspect-[2/3] w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-[2/3] w-full items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30">
          <BookOpen size={36} className="text-white/20" />
        </div>
      )}
      <div className="p-2.5">
        <h3 className="truncate text-xs font-semibold text-text-primary">
          {book.title}
        </h3>
        <p className="truncate text-[11px] text-text-muted">
          {book.authors.join(", ") || "—"}
        </p>
        <StarRatingDisplay
          avg={book.rating_avg}
          count={book.rating_count}
          size={10}
          className="mt-1"
        />
      </div>
    </GlassCard>
  );
}
