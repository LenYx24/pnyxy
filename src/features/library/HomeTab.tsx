import { useMemo } from "react";
import { useNavigate } from "react-router";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useLibraryStore } from "@/stores/library-store";
import { useTagStore } from "@/stores/tag-store";
import { LibraryBookCard } from "./LibraryBookCard";
import { LibraryListView } from "./LibraryListView";
import { StreakCard } from "./StreakCard";
import type { ViewMode } from "./useLibraryPrefs";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { BookStatusTag } from "@/types/database";

interface HomeTabProps {
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  viewMode: ViewMode;
  cardSize: number;
  searchQuery: string;
  selectedIds: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  activeTag?: BookStatusTag | null;
  isLoading?: boolean;
}

export function HomeTab({
  onMoveBook,
  onRemoveBook,
  viewMode,
  cardSize,
  searchQuery,
  selectedIds,
  selectionActive,
  onToggleSelect,
  activeTag = null,
  isLoading = false,
}: HomeTabProps) {
  const navigate = useNavigate();
  const books = useLibraryStore((s) => s.books);
  const folders = useLibraryStore((s) => s.folders);
  const getTagsForBook = useTagStore((s) => s.getTagsForBook);

  const query = searchQuery.toLowerCase().trim();

  const recentBooks = useMemo(() => {
    let result = books.slice(0, 20);
    if (query) {
      result = result.filter((b) => {
        const title =
          b.source === "catalog" ? b.catalog_book.title : b.book.title;
        const author =
          b.source === "catalog"
            ? b.catalog_book.authors?.join(", ") || ""
            : b.book.author || "";
        const lower = title.toLowerCase() + " " + author.toLowerCase();
        return lower.includes(query);
      });
    }
    if (activeTag) {
      result = result.filter((b) => getTagsForBook(b).includes(activeTag));
    }
    return result;
  }, [books, query, activeTag, getTagsForBook]);

  const coverHeight = Math.round(cardSize * 0.6);

  if (books.length === 0 && !query) {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-accent-purple" />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="w-full max-w-md mb-4">
          <StreakCard />
        </div>
        <BookOpen size={48} className="text-text-muted/50" />
        <div>
          <p className="text-lg font-medium text-text-primary">
            Your library is empty
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Browse the catalog to add books.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/browse")}>
          Browse Catalog
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <StreakCard />
      </div>

      <h3 className="mb-4 text-lg font-semibold text-text-primary">
        Recently Added
      </h3>

      {recentBooks.length === 0 && query && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">
            No results for &quot;{searchQuery}&quot;
          </p>
        </div>
      )}

      {recentBooks.length > 0 && viewMode === "list" && (
        <LibraryListView
          folders={[]}
          books={recentBooks}
          allFolders={folders}
          allBooks={books}
          selectedIds={selectedIds}
          selectionActive={selectionActive}
          onToggleSelect={onToggleSelect}
          onNavigateFolder={() => {}}
          onRenameFolder={() => {}}
          onDeleteFolder={() => {}}
          onMoveBook={onMoveBook}
          onRemoveBook={onRemoveBook}
          cardSize={cardSize}
        />
      )}

      {recentBooks.length > 0 && viewMode === "grid" && (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`,
          }}
        >
          {recentBooks.map((entry) => (
            <LibraryBookCard
              key={`${entry.source}-${entry.id}`}
              entry={entry}
              onMove={onMoveBook}
              onRemove={onRemoveBook}
              coverHeight={coverHeight}
              selected={selectedIds.has(`book:${entry.id}`)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
