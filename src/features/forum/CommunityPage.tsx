import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Users, Plus, Loader2, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { useCommunityStore } from "@/stores/community-store";
import { usePostStore } from "@/stores/post-store";
import { useAuthStore } from "@/stores/auth-store";
import { PostCard } from "./PostCard";

export function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const currentCommunity = useCommunityStore((s) => s.currentCommunity);
  const fetchCommunityBySlug = useCommunityStore((s) => s.fetchCommunityBySlug);
  const userMemberships = useCommunityStore((s) => s.userMemberships);
  const joinCommunity = useCommunityStore((s) => s.joinCommunity);
  const leaveCommunity = useCommunityStore((s) => s.leaveCommunity);
  const checkMemberships = useCommunityStore((s) => s.checkMemberships);

  const posts = usePostStore((s) => s.posts);
  const isLoading = usePostStore((s) => s.isLoading);
  const totalCount = usePostStore((s) => s.totalCount);
  const fetchPosts = usePostStore((s) => s.fetchPosts);
  const loadMorePosts = usePostStore((s) => s.loadMorePosts);
  const subscribePostUpdates = usePostStore((s) => s.subscribePostUpdates);

  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (slug) {
      fetchCommunityBySlug(slug);
      checkMemberships();
    }
  }, [slug, fetchCommunityBySlug, checkMemberships]);

  useEffect(() => {
    if (currentCommunity) {
      fetchPosts(currentCommunity.id);
      const unsub = subscribePostUpdates(currentCommunity.id);
      return unsub;
    }
  }, [currentCommunity, fetchPosts, subscribePostUpdates]);

  const isMember = currentCommunity
    ? userMemberships.has(currentCommunity.id)
    : false;
  const role = currentCommunity
    ? userMemberships.get(currentCommunity.id)
    : undefined;

  if (!currentCommunity && isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent-purple" />
      </div>
    );
  }

  if (!currentCommunity) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">Community not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate("/forum")}>
          Back to Forum
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate("/forum")}
          className="mb-3 flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
        >
          <ArrowLeft size={14} />
          Back to Forum
        </button>

        <div className="rounded-xl border border-glass-border bg-glass-bg p-6 backdrop-blur-md">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent-purple/20 text-accent-purple font-bold text-xl">
                {currentCommunity.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold text-text-primary">
                  {currentCommunity.name}
                </h1>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-text-muted">
                  <Users size={14} />
                  {currentCommunity.member_count} members
                </p>
                {currentCommunity.description && (
                  <p className="mt-2 text-sm text-text-secondary">
                    {currentCommunity.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {user && isMember && (
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/forum/c/${slug}/new`)}
                >
                  <Plus size={16} />
                  New Post
                </Button>
              )}
              {user && !isMember && (
                <button
                  onClick={() => joinCommunity(currentCommunity.id)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-purple/80 cursor-pointer"
                >
                  <LogIn size={14} />
                  Join
                </button>
              )}
              {user && isMember && role !== "owner" && (
                <button
                  onClick={() => leaveCommunity(currentCommunity.id)}
                  className="flex items-center gap-1.5 rounded-lg border border-glass-border px-3 py-2 text-sm text-text-muted transition-colors hover:bg-glass-hover hover:text-text-secondary cursor-pointer"
                >
                  <LogOut size={14} />
                  Leave
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Posts feed */}
      {isLoading && posts.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-accent-purple" />
        </div>
      ) : posts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-text-muted">No posts yet.</p>
          {isMember && (
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => navigate(`/forum/c/${slug}/new`)}
            >
              Create the first post
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              communitySlug={currentCommunity.slug}
            />
          ))}

          {posts.length < totalCount && (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                onClick={() => loadMorePosts(currentCommunity.id)}
                disabled={isLoading}
              >
                {isLoading ? "Loading..." : "Load More"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
