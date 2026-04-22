import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui";
import { useCommunityStore } from "@/stores/community-store";
import { useAuthStore } from "@/stores/auth-store";
import { CommunityCard } from "./CommunityCard";
import { CreateCommunityModal } from "./CreateCommunityModal";

export function ForumPage() {
  const { t } = useTranslation();
  const communities = useCommunityStore((s) => s.communities);
  const joinedCommunities = useCommunityStore((s) => s.joinedCommunities);
  const isLoading = useCommunityStore((s) => s.isLoading);
  const totalCount = useCommunityStore((s) => s.totalCount);
  const fetchCommunities = useCommunityStore((s) => s.fetchCommunities);
  const fetchJoinedCommunities = useCommunityStore((s) => s.fetchJoinedCommunities);
  const loadMore = useCommunityStore((s) => s.loadMore);
  const checkMemberships = useCommunityStore((s) => s.checkMemberships);

  const user = useAuthStore((s) => s.user);

  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchCommunities();
    if (user) {
      fetchJoinedCommunities();
      checkMemberships();
    }
  }, [fetchCommunities, fetchJoinedCommunities, checkMemberships, user]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      // Client-side filter for now; server-side search in a later phase
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // filter is applied in render below
      }, 200);
    },
    [],
  );

  const filteredCommunities = searchQuery.trim()
    ? communities.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.description.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : communities;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {t("forum.title")}
          </h2>
          <p className="text-sm text-text-secondary">{t("forum.subtitle")}</p>
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

      {user && joinedCommunities.length > 0 && (
        <div className="mb-8">
          <h3 className="mb-3 text-sm font-semibold text-text-secondary uppercase tracking-wide">
            {t("forum.yourCommunities")}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {joinedCommunities.map((c) => (
              <CommunityCard key={c.id} community={c} />
            ))}
          </div>
        </div>
      )}

      {/* Discover */}
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
            {t("forum.discover")}
          </h3>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("forum.searchPlaceholder")}
              className="w-full rounded-lg border border-glass-border bg-glass-bg py-2 pl-9 pr-3 text-sm text-text-primary outline-none focus:border-accent-purple sm:w-64"
            />
          </div>
        </div>

        {isLoading && communities.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent-purple" />
          </div>
        ) : filteredCommunities.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-text-muted">
              {searchQuery.trim() ? t("forum.noMatch") : t("forum.empty")}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCommunities.map((c) => (
                <CommunityCard key={c.id} community={c} />
              ))}
            </div>

            {!searchQuery.trim() && communities.length < totalCount && (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={loadMore}
                  disabled={isLoading}
                >
                  {isLoading ? t("forum.loading") : t("forum.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <CreateCommunityModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
