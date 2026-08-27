import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { MessageSquare, Plus, Send, Loader2 } from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { useBook } from "../BookPageContext";
import { usePostStore } from "@/stores/post-store";
import { useCommunityStore } from "@/stores/community-store";
import { useAuthStore } from "@/stores/auth-store";
import type { ForumPostWithAuthor } from "@/types/forum";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(dateStr).toLocaleDateString();
}

function PostItem({ post }: { post: ForumPostWithAuthor }) {
  const navigate = useNavigate();
  const slug = post.community?.slug;
  return (
    <GlassCard
      className="cursor-pointer p-3"
      onClick={() => slug && navigate(`/forum/c/${slug}/p/${post.id}`)}
    >
      <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-text-muted">
        {post.community && <span>{post.community.name}</span>}
      </div>
      <h4 className="text-sm font-semibold text-text-primary">{post.title}</h4>
      {post.body_md && (
        <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
          {post.body_md}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
        <span>{post.author?.display_name ?? "Unknown"}</span>
        <span>{timeAgo(post.created_at)}</span>
        <span className="flex items-center gap-1">
          <MessageSquare size={12} />
          {post.comment_count}
        </span>
      </div>
    </GlassCard>
  );
}

export function DiscussTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const book = useBook();
  const user = useAuthStore((s) => s.user);

  const posts = usePostStore((s) => s.posts);
  const isLoading = usePostStore((s) => s.isLoading);
  const fetchPostsForBook = usePostStore((s) => s.fetchPostsForBook);
  const createPost = usePostStore((s) => s.createPost);

  const joinedCommunities = useCommunityStore((s) => s.joinedCommunities);
  const communities = useCommunityStore((s) => s.communities);
  const fetchJoinedCommunities = useCommunityStore(
    (s) => s.fetchJoinedCommunities,
  );
  const fetchCommunities = useCommunityStore((s) => s.fetchCommunities);

  const bookRef = useMemo(
    () =>
      book.source === "catalog"
        ? { catalogBookId: book.book.id }
        : { bookId: book.book.id },
    [book],
  );

  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPostsForBook(bookRef);
  }, [bookRef, fetchPostsForBook]);

  useEffect(() => {
    if (composerOpen && user) {
      fetchJoinedCommunities();
      if (communities.length === 0) fetchCommunities();
    }
  }, [composerOpen, user, fetchJoinedCommunities, fetchCommunities, communities.length]);

  // Prefer joined communities; fall back to top communities if the user
  // hasn't joined any yet.
  const pickableCommunities =
    joinedCommunities.length > 0 ? joinedCommunities : communities;

  useEffect(() => {
    if (!selectedCommunityId && pickableCommunities[0]) {
      setSelectedCommunityId(pickableCommunities[0].id);
    }
  }, [pickableCommunities, selectedCommunityId]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError(t("book.discuss.errorTitle"));
      return;
    }
    if (!selectedCommunityId) {
      setError(t("book.discuss.errorCommunity"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await createPost({
        community_id: selectedCommunityId,
        title: title.trim(),
        kind: "text",
        body_md: body.trim() || null,
        ...bookRef,
      });
      setTitle("");
      setBody("");
      setComposerOpen(false);
      await fetchPostsForBook(bookRef);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {t("book.discuss.heading")}
          </h2>
          <p className="text-sm text-text-muted">
            {t("book.discuss.description")}
          </p>
        </div>
        {user && (
          <Button
            variant="primary"
            onClick={() => setComposerOpen((v) => !v)}
            className="px-3 py-1.5 text-xs sm:text-sm"
          >
            <Plus size={14} />
            {composerOpen
              ? t("book.discuss.closeComposer")
              : t("book.discuss.startDiscussion")}
          </Button>
        )}
      </div>

      {composerOpen && user && (
        <div className="space-y-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4">
          {pickableCommunities.length === 0 ? (
            <p className="text-sm text-text-muted">
              {t("book.discuss.noCommunitiesHint")}{" "}
              <button
                onClick={() => navigate("/forum")}
                className="text-accent hover:underline"
              >
                {t("book.discuss.browseForum")}
              </button>
            </p>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  {t("book.discuss.communityLabel")}
                </label>
                <select
                  value={selectedCommunityId}
                  onChange={(e) => setSelectedCommunityId(e.target.value)}
                  className="field w-full"
                >
                  {pickableCommunities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  {t("book.discuss.titleLabel")}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("book.discuss.titlePlaceholder")}
                  maxLength={200}
                  className="w-full rounded-lg border border-glass-border bg-bg-secondary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  {t("book.discuss.bodyLabel")}
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("book.discuss.bodyPlaceholder")}
                  rows={5}
                  className="w-full resize-y rounded-lg border border-glass-border bg-bg-secondary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
                />
              </div>

              {error && (
                <p className="text-xs text-danger">{error}</p>
              )}

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={submitting || !title.trim()}
                  className="gap-2"
                >
                  {submitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  {submitting ? t("book.discuss.posting") : t("book.discuss.post")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {isLoading && posts.length === 0 && (
        <p className="text-sm text-text-muted">{t("book.discuss.loading")}</p>
      )}

      {!isLoading && posts.length === 0 && !composerOpen && (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
          <MessageSquare size={28} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">
            {t("book.discuss.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {user
              ? t("book.discuss.emptyBodyAuthed")
              : t("book.discuss.emptyBodyAnon")}
          </p>
        </div>
      )}

      {posts.length > 0 && (
        <div className="space-y-2">
          {posts.map((post) => (
            <PostItem key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
