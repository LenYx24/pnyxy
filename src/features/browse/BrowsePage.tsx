import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, Loader2 } from "lucide-react";
import { Button, CategoryChip } from "@/components/ui";
import { useBrowseStore } from "@/stores/browse-store";
import { useCategoryStore } from "@/stores/category-store";
import { BrowseBookCard } from "./BrowseBookCard";
import { AddBookModal } from "./AddBookModal";
import { CreateCategoryModal } from "./CreateCategoryModal";

export function BrowsePage() {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
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
    subscribeCatalogUpdates,
  } = useBrowseStore();

  const {
    categories,
    fetchCategories,
    getSubcategories,
  } = useCategoryStore();

  useEffect(() => {
    fetchCatalogBooks();
    checkUserLibrary();
    fetchCategories();
  }, [fetchCatalogBooks, checkUserLibrary, fetchCategories]);

  // Push-update the browse list when admins approve / reject / edit books.
  useEffect(() => {
    const unsub = subscribeCatalogUpdates();
    return unsub;
  }, [subscribeCatalogUpdates]);

  const handleSearchChange = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        searchCatalog(value);
      }, 300);
    },
    [searchCatalog],
  );

  // Top-level categories (no parent)
  const topCategories = categories.filter((c) => c.parent_id === null);

  // When a category is active, show its subcategories
  const subcategories = activeCategory
    ? getSubcategories(activeCategory)
    : [];

  const hasMore = catalogBooks.length < totalCount;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Browse</h2>
          <p className="text-sm text-text-secondary">
            Discover books in the community catalog
          </p>
        </div>
        <Button variant="secondary" onClick={() => setModalOpen(true)}>
          <Plus size={18} />
          <span className="hidden sm:inline">Add a Book</span>
          <span className="sm:hidden">Add</span>
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
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
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
        {topCategories.map((cat) => (
          <CategoryChip
            key={cat.id}
            category={cat}
            active={activeCategory === cat.id}
            onClick={() =>
              filterByCategory(activeCategory === cat.id ? null : cat.id)
            }
          />
        ))}
        <button
          onClick={() => setCategoryModalOpen(true)}
          className="rounded-full border border-dashed border-glass-border px-3 py-1 text-xs font-medium text-text-muted transition-colors hover:text-text-primary hover:border-text-muted cursor-pointer"
        >
          <Plus size={12} className="inline -mt-0.5" /> Category
        </button>
      </div>

      {/* Subcategory chips (when a top-level category is active) */}
      {subcategories.length > 0 && (
        <div className="mb-4 ml-4 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {subcategories.map((sub) => (
            <CategoryChip
              key={sub.id}
              category={sub}
              active={activeCategory === sub.id}
              onClick={() => filterByCategory(sub.id)}
            />
          ))}
        </div>
      )}

      {!subcategories.length && <div className="mb-4" />}

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            {catalogBooks.map((book) => (
              <BrowseBookCard
                key={book.id}
                book={book}
                onClick={() => navigate(`/books/${book.id}`)}
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
      <CreateCategoryModal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
      />
    </div>
  );
}
