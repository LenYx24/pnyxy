import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Flame, Loader2, MessagesSquare, Plus, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useCommunityStore } from "@/stores/community-store";
import { usePostStore, type FeedSort } from "@/stores/post-store";
import { useAuthStore } from "@/stores/auth-store";
import { CreateCommunityModal } from "./CreateCommunityModal";
import { PostCard } from "./PostCard";

const SORT_TABS: Array<{ id: FeedSort; labelKey: string; icon: typeof Flame }> = [
  { id: "hot", labelKey: "forum.sort.hot", icon: Flame },
  { id: "new", labelKey: "forum.sort.new", icon: Sparkles },
  { id: "top", labelKey: "forum.sort.top", icon: TrendingUp },
];

export function ForumPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const communities = useCommunityStore((s) => s.communities);
  const joinedCommunities = useCommunityStore((s) => s.joinedCommunities);
  const fetchCommunities = useCommunityStore((s) => s.fetchCommunities);
  const fetchJoinedCommunities = useCommunityStore(
    (s) => s.fetchJoinedCommunities,
  );

  const posts = usePostStore((s) => s.posts);
  const isLoadingPosts = usePostStore((s) => s.isLoading);
  const fetchFeed = usePostStore((s) => s.fetchFeed);

  const [createOpen, setCreateOpen] = useState(false);
  const [sort, setSort] = useState<FeedSort>("hot");

  // Communities sidebar data — modest fetch, no infinite scroll here.
  // The dedicated /forum?explore route (or "Browse all" link) covers
  // discovery in depth.
  useEffect(() => {
    fetchCommunities();
    if (user) fetchJoinedCommunities();
  }, [fetchCommunities, fetchJoinedCommunities, user]);

  useEffect(() => {
    fetchFeed(sort);
  }, [fetchFeed, sort]);

  const sidebarCommunities =
    user && joinedCommunities.length > 0
      ? joinedCommunities
      : communities.slice(0, 8);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {t("forum.title")}
          </h2>
          <p className="text-sm text-text-secondary">
            {t("forum.feedSubtitle")}
          </p>
        </div>
        {user && (
          <Button variant="secondary" onClick={() => setCreateOpen(true)}>
            <Plus size={18} />
            <span className="hidden sm:inline">
              {t("forum.createCommunity")}
            </span>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        {/* Main feed */}
        <main className="min-w-0">
          <FeedSortTabs active={sort} onChange={setSort} />

          {isLoadingPosts && posts.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-accent" />
            </div>
          ) : posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-glass-border p-10 text-center">
              <p className="text-sm text-text-muted">
                {t("forum.feedEmpty")}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </main>

        {/* Sidebar: communities */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-glass-border bg-glass-bg/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <MessagesSquare size={14} className="text-accent" />
                {user && joinedCommunities.length > 0
                  ? t("forum.yourCommunities")
                  : t("forum.discover")}
              </h3>
              <Link
                to="/forum/explore"
                className="text-xs text-accent hover:underline"
              >
                {t("forum.browseAll")}
              </Link>
            </div>
            {sidebarCommunities.length === 0 ? (
              <p className="text-xs text-text-muted">{t("forum.empty")}</p>
            ) : (
              <ul className="space-y-1">
                {sidebarCommunities.map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/forum/c/${c.slug}`}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
                    >
                      <span className="truncate">
                        <span className="font-semibold text-accent">c/</span>
                        {c.slug}
                      </span>
                      <span className="shrink-0 text-2xs text-text-muted">
                        {c.member_count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <CreateCommunityModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function FeedSortTabs({
  active,
  onChange,
}: {
  active: FeedSort;
  onChange: (sort: FeedSort) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex gap-1 rounded-lg border border-glass-border bg-glass-bg p-1 backdrop-blur-md">
      {SORT_TABS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
            active === id
              ? "bg-accent/15 text-accent"
              : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
          )}
        >
          <Icon size={14} />
          <span>{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
