import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useBrowseStore } from "@/stores/browse-store";
import { BrowseBookCard } from "./BrowseBookCard";
import { AddBookModal } from "./AddBookModal";

const CATEGORIES = [
  "Fiction",
  "Non-fiction",
  "Science",
  "Technology",
  "History",
  "Philosophy",
  "Mathematics",
  "Art",
];

export function BrowsePage() {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    catalogBooks,
    isLoading,
    searchQuery,
    activeCategory,
    totalCount,
    fetchCatalogBooks,
    searchCatalog,
    filterByCategory,
    loadMore,
    checkUserLibrary,
  } = useBrowseStore();

  useEffect(() => {
    fetchCatalogBooks();
    checkUserLibrary();
  }, [fetchCatalogBooks, checkUserLibrary]);

  const handleSearchChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        searchCatalog(value);
      }, 300);
    },
    [searchCatalog],
  );

  const hasMore = catalogBooks.length < totalCount;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Browse</h2>
          <p className="text-sm text-text-secondary">
            Discover books in the community catalog
          </p>
        </div>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          <Plus size={18} />
          Add a Book
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          placeholder="Search by title..."
          defaultValue={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 pl-9 text-sm text-text-primary backdrop-blur-md placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
        />
      </div>

      {/* Category filter chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => filterByCategory(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeCategory === null
              ? "bg-accent-purple/15 text-accent-purple"
              : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border"
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() =>
              filterByCategory(activeCategory === cat ? null : cat)
            }
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
              activeCategory === cat
                ? "bg-accent-purple/15 text-accent-purple"
                : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Book grid */}
      {isLoading && catalogBooks.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-text-muted" />
        </div>
      ) : catalogBooks.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-text-muted">
            No books found. Be the first to add one!
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {catalogBooks.map((book) => (
              <BrowseBookCard
                key={book.id}
                book={book}
                onClick={() => navigate(`/app/browse/${book.id}`)}
              />
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <Button
                variant="secondary"
                onClick={loadMore}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Load More"
                )}
              </Button>
            </div>
          )}
        </>
      )}

      <AddBookModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
