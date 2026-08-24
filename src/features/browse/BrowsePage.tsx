import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Search, Plus, Loader2, Import } from "lucide-react";
import { Button, CategoryChip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useBrowseStore } from "@/stores/browse-store";
import { useCategoryStore } from "@/stores/category-store";
import { useAuthStore } from "@/stores/auth-store";
import type { Category } from "@/types/database";
import { BrowseBookCard } from "./BrowseBookCard";
import { AddBookModal } from "./AddBookModal";
import { CreateCategoryModal } from "./CreateCategoryModal";

// Localised labels for the built-in seed categories (migration 00007).
// User-created categories keep their stored name. See report for the
// recommended DB-backed translation approach if this list grows.
const SEED_CATEGORY_LABELS: Record<string, { hu: string; en: string }> = {
  fiction: { hu: "Szépirodalom", en: "Fiction" },
  "non-fiction": { hu: "Ismeretterjesztő", en: "Non-fiction" },
  science: { hu: "Tudomány", en: "Science" },
  technology: { hu: "Technológia", en: "Technology" },
  history: { hu: "Történelem", en: "History" },
  philosophy: { hu: "Filozófia", en: "Philosophy" },
  mathematics: { hu: "Matematika", en: "Mathematics" },
  art: { hu: "Művészet", en: "Art" },
};

export function BrowsePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [modalOpen, setModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lang = i18n.language?.startsWith("hu") ? "hu" : "en";
  // Returns a copy of the category with a localised display name so the
  // shared CategoryChip (which renders `category.name`) shows the right
  // language without needing to know about translations.
  const localizeCategory = useCallback(
    (cat: Category): Category => {
      const label = SEED_CATEGORY_LABELS[cat.slug]?.[lang];
      return label ? { ...cat, name: label } : cat;
    },
    [lang],
  );

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
      setIsSearching(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void Promise.resolve(searchCatalog(value)).finally(() =>
          setIsSearching(false),
        );
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-text-primary sm:text-2xl">
            {t("browse.title")}
          </h2>
          <p className="text-xs text-text-secondary sm:text-sm">
            {t("browse.subtitle")}
          </p>
        </div>
        {/* Write actions require an account (they insert into Supabase). */}
        {user && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => navigate("/catalog/import")}
            >
              <Import size={18} />
              <span className="hidden sm:inline">{t("browse.import")}</span>
              <span className="sm:hidden">{t("browse.importShort")}</span>
            </Button>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              <Plus size={18} />
              <span className="hidden sm:inline">{t("browse.addBook")}</span>
              <span className="sm:hidden">{t("browse.addBookShort")}</span>
            </Button>
          </div>
        )}
      </div>

      <div className="relative mb-3">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          placeholder={t("browse.searchPlaceholder")}
          defaultValue={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full rounded-lg border border-glass-border bg-glass-bg px-3 py-2 pl-9 pr-9 text-sm text-text-primary backdrop-blur-md placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        {/* live search spinner: fades in only while a query is settling */}
        <Loader2
          size={16}
          className={cn(
            "absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-accent transition-opacity duration-200",
            isSearching ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={!isSearching}
        />
      </div>

      <div className="mb-2 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        <button
          onClick={() => filterByCategory(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
            activeCategory === null
              ? "bg-accent/15 text-accent"
              : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border"
          }`}
        >
          {t("browse.all")}
        </button>
        {topCategories.map((cat) => (
          <CategoryChip
            key={cat.id}
            category={localizeCategory(cat)}
            active={activeCategory === cat.id}
            onClick={() =>
              filterByCategory(activeCategory === cat.id ? null : cat.id)
            }
          />
        ))}
        {/* Creating a category writes to Supabase → signed-in only. */}
        {user && (
          <button
            onClick={() => setCategoryModalOpen(true)}
            className="rounded-full border border-dashed border-glass-border px-3 py-1 text-xs font-medium text-text-muted transition-colors hover:text-text-primary hover:border-text-muted cursor-pointer"
          >
            <Plus size={12} className="inline -mt-0.5" /> {t("browse.category")}
          </button>
        )}
      </div>

      {/* Subcategory chips (when a top-level category is active) */}
      {subcategories.length > 0 && (
        <div className="mb-4 ml-4 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {subcategories.map((sub) => (
            <CategoryChip
              key={sub.id}
              category={localizeCategory(sub)}
              active={activeCategory === sub.id}
              onClick={() => filterByCategory(sub.id)}
            />
          ))}
        </div>
      )}

      {!subcategories.length && <div className="mb-2" />}

      {/* Book grid */}
      {isLoading && catalogBooks.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-text-muted" />
        </div>
      ) : catalogBooks.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-text-muted">{t("browse.empty")}</p>
        </div>
      ) : (
        <>
          {/* No container re-key: remounting the whole grid on every
              settled query reloaded every cover <img> (visible flicker) and
              replayed a jarring slide. Cards are keyed by book.id, so React
              keeps shared cards mounted and only new cards fade in. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
                  t("browse.loadMore")
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
