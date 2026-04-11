import { BookOpen, Download } from "lucide-react";
import { GlassCard } from "@/components/ui";
import type { CatalogBook } from "@/types/catalog";

interface BrowseBookCardProps {
  book: CatalogBook;
  onClick: () => void;
}

export function BrowseBookCard({ book, onClick }: BrowseBookCardProps) {
  const hasDownload = !!(book.ia_id || book.download_url);

  return (
    <GlassCard className="cursor-pointer overflow-hidden" onClick={onClick}>
      <div className="relative">
        {book.cover_url ? (
          <img
            src={book.cover_url}
            alt={book.title}
            className="h-48 w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-48 items-center justify-center bg-gradient-to-br from-accent-purple/30 to-accent-blue/30">
            <BookOpen size={48} className="text-white/20" />
          </div>
        )}
        {hasDownload && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-green-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
            <Download size={10} />
            Free
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="mb-1 truncate text-sm font-semibold text-text-primary">
          {book.title}
        </h3>
        <p className="mb-2 truncate text-xs text-text-muted">
          {book.authors.join(", ") || "Unknown author"}
        </p>
        {book.description && (
          <p className="line-clamp-2 text-xs text-text-secondary">
            {book.description}
          </p>
        )}
      </div>
    </GlassCard>
  );
}
