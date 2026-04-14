import { useMemo } from "react";
import { useNavigate } from "react-router";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui";
import { useLibraryStore } from "@/stores/library-store";
import { LibraryBookCard } from "./LibraryBookCard";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface HomeTabProps {
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
}

export function HomeTab({ onMoveBook, onRemoveBook }: HomeTabProps) {
  const navigate = useNavigate();
  const books = useLibraryStore((s) => s.books);
  const recentBooks = useMemo(() => books.slice(0, 20), [books]);

  if (recentBooks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <BookOpen size={48} className="text-text-muted/50" />
        <div>
          <p className="text-lg font-medium text-text-primary">
            Your library is empty
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Browse the catalog to add books.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/app/browse")}>
          Browse Catalog
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-4 text-lg font-semibold text-text-primary">
        Recently Added
      </h3>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {recentBooks.map((entry) => (
          <LibraryBookCard
            key={`${entry.source}-${entry.id}`}
            entry={entry}
            onMove={onMoveBook}
            onRemove={onRemoveBook}
          />
        ))}
      </div>
    </div>
  );
}
