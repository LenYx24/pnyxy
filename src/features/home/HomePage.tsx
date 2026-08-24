import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Library, Compass, ArrowRight } from "lucide-react";
import { GlassCard, Button } from "@/components/ui";
import { useBrowseStore } from "@/stores/browse-store";
import { useLibraryStore } from "@/stores/library-store";
import { useAuthStore } from "@/stores/auth-store";
import { useCategoryStore } from "@/stores/category-store";
import { Shelf } from "@/features/browse/Shelf";
import { BrowseBookShelfCard } from "@/features/browse/BrowseBookShelfCard";
import { RecentlyViewedShelf } from "@/features/browse/RecentlyViewedShelf";
import { CategoryShelf } from "./CategoryShelf";
import { RecentlyAddedShelf } from "./RecentlyAddedShelf";
import { TodayPanel } from "./TodayPanel";

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const {
    featuredBooks,
    newThisWeekBooks,
    fetchShelves,
    checkUserLibrary,
  } = useBrowseStore();

  const books = useLibraryStore((s) => s.books);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);

  const categories = useCategoryStore((s) => s.categories);
  const fetchCategories = useCategoryStore((s) => s.fetchCategories);

  useEffect(() => {
    fetchShelves();
    fetchCategories();
    checkUserLibrary();
    if (user) fetchLibrary();
  }, [fetchShelves, fetchCategories, checkUserLibrary, fetchLibrary, user]);

  // Pick up to 3 top-level categories to render as shelves. Filtering
  // to top-level keeps the Home page from getting overwhelming.
  const topCategories = categories
    .filter((c) => c.parent_id === null)
    .slice(0, 3);

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">
          {t("home.title")}
        </h1>
        <p className="text-sm text-text-secondary">{t("home.subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        {/* Main column: stacked shelves */}
        <main className="min-w-0">
          {/* "Today" aggregator: reading-plan targets, roadmap nodes
              due, quiz reviews queued, continue-reading hand-off. The
              panel renders nothing when none of those have content,
              so signed-out users / users who haven't set anything up
              don't see an empty shell. */}
          {user && <TodayPanel />}

          {/* User's own books first, what they care about most when
              they land on home. The shelf renders nothing if the
              library is empty, so signed-out / first-run users go
              straight into the catalog content below. */}
          {user && <RecentlyAddedShelf />}

          <Shelf
            title={t("home.shelves.featured")}
            itemCount={featuredBooks.length}
            seeAllHref="/browse"
            seeAllLabel={t("home.seeAll")}
          >
            {featuredBooks.map((book) => (
              <div
                key={book.id}
                className="w-[7.5rem] shrink-0 snap-start sm:w-[8.5rem]"
              >
                <BrowseBookShelfCard
                  book={book}
                  onClick={() => navigate(`/books/${book.id}`)}
                />
              </div>
            ))}
          </Shelf>

          <Shelf
            title={t("home.shelves.newThisWeek")}
            itemCount={newThisWeekBooks.length}
            seeAllHref="/browse"
            seeAllLabel={t("home.seeAll")}
          >
            {newThisWeekBooks.map((book) => (
              <div
                key={book.id}
                className="w-[7.5rem] shrink-0 snap-start sm:w-[8.5rem]"
              >
                <BrowseBookShelfCard
                  book={book}
                  onClick={() => navigate(`/books/${book.id}`)}
                />
              </div>
            ))}
          </Shelf>

          <RecentlyViewedShelf />

          {topCategories.map((cat) => (
            <CategoryShelf
              key={cat.id}
              categoryId={cat.id}
              title={cat.name}
            />
          ))}
        </main>

        {/* Right-side panel, sticky on desktop so it stays visible
            while the user scrolls through shelves. Collapses to a
            regular block on mobile. */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-col gap-3">
            <GlassCard className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Library size={16} className="text-accent" />
                <h3 className="text-sm font-semibold text-text-primary">
                  {t("home.sidePanel.yourLibrary")}
                </h3>
              </div>
              {user ? (
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-text-primary">
                    {books.length}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t("home.sidePanel.bookCount", { count: books.length })}
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-3 w-full"
                    onClick={() => navigate("/library")}
                  >
                    {t("home.sidePanel.openLibrary")}
                    <ArrowRight size={14} />
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-text-muted">
                    {t("home.sidePanel.signedOutHint")}
                  </p>
                  <Button
                    variant="primary"
                    className="mt-3 w-full"
                    onClick={() => navigate("/auth")}
                  >
                    {t("home.sidePanel.signIn")}
                  </Button>
                </>
              )}
            </GlassCard>

            <GlassCard className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Compass size={16} className="text-accent-blue" />
                <h3 className="text-sm font-semibold text-text-primary">
                  {t("home.sidePanel.discover")}
                </h3>
              </div>
              <p className="mb-3 text-xs text-text-secondary">
                {t("home.sidePanel.discoverHint")}
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => navigate("/browse")}
              >
                {t("home.sidePanel.browseCatalog")}
                <ArrowRight size={14} />
              </Button>
            </GlassCard>
          </div>
        </aside>
      </div>
    </div>
  );
}
