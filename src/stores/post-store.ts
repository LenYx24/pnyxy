import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import type {
  ForumPostWithAuthor,
  ForumPostInsert,
  ForumCommentWithAuthor,
  ForumCommentInsert,
} from "@/types/forum";

const PAGE_SIZE = 20;

// Reddit-style hot-ranking. Recency dominates for low-score posts;
// score takes over once a post has accumulated meaningful votes. Used
// client-side for the "hot" feed sort since the database doesn't have
// a precomputed hotness column.
const HOT_TIME_DENOMINATOR = 45000; // seconds (~12.5h)
function hotScore(post: { score_cached: number; created_at: string }): number {
  const score = post.score_cached;
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  const seconds =
    new Date(post.created_at).getTime() / 1000 - 1577836800; // since 2020-01-01
  return sign * order + seconds / HOT_TIME_DENOMINATOR;
}

function buildCommentTree(
  flat: ForumCommentWithAuthor[],
): ForumCommentWithAuthor[] {
  const map = new Map<string, ForumCommentWithAuthor>();
  const roots: ForumCommentWithAuthor[] = [];

  for (const c of flat) {
    map.set(c.id, { ...c, children: [] });
  }
  for (const c of flat) {
    const node = map.get(c.id)!;
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  // Prune: a soft-deleted comment with no surviving descendants is
  // dropped entirely. Soft-deleted comments that still anchor a reply
  // sub-tree are kept so the thread structure stays intact — the UI
  // shows "[deleted by user]" in place of the body.
  function prune(
    nodes: ForumCommentWithAuthor[],
  ): ForumCommentWithAuthor[] {
    const out: ForumCommentWithAuthor[] = [];
    for (const node of nodes) {
      const prunedChildren = prune(node.children ?? []);
      const keep = !node.is_removed || prunedChildren.length > 0;
      if (keep) {
        out.push({ ...node, children: prunedChildren });
      }
    }
    return out;
  }

  return prune(roots);
}

export type FeedSort = "hot" | "new" | "top";

interface PostState {
  posts: ForumPostWithAuthor[];
  currentPost: ForumPostWithAuthor | null;
  comments: ForumCommentWithAuthor[];
  isLoading: boolean;
  totalCount: number;
  page: number;

  fetchPosts: (communityId: string) => Promise<void>;
  loadMorePosts: (communityId: string) => Promise<void>;
  fetchFeed: (sort: FeedSort) => Promise<void>;
  fetchPostsForBook: (opts: { bookId?: string; catalogBookId?: string }) => Promise<void>;
  fetchPost: (postId: string) => Promise<void>;
  createPost: (data: ForumPostInsert) => Promise<string>;
  removePost: (postId: string) => Promise<void>;

  fetchComments: (postId: string) => Promise<void>;
  createComment: (data: ForumCommentInsert) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;

  subscribePostUpdates: (communityId: string) => () => void;
  subscribeCommentUpdates: (postId: string) => () => void;

  clearCurrentPost: () => void;
}

export const usePostStore = create<PostState>((set, get) => ({
  posts: [],
  currentPost: null,
  comments: [],
  isLoading: false,
  totalCount: 0,
  page: 0,

  async fetchPosts(communityId) {
    set({ isLoading: true, page: 0 });
    try {
      const { data, count, error } = await supabase
        .from("posts")
        .select("*, author:profiles!author_id(display_name, avatar_url)", {
          count: "exact",
        })
        .eq("community_id", communityId)
        .eq("is_removed", false)
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;
      set({
        posts: (data as ForumPostWithAuthor[]) ?? [],
        totalCount: count ?? 0,
        page: 1,
      });
    } catch (err) {
      logError("post:fetchPosts", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async loadMorePosts(communityId) {
    const { page, posts, totalCount } = get();
    if (posts.length >= totalCount) return;

    set({ isLoading: true });
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("posts")
        .select("*, author:profiles!author_id(display_name, avatar_url)")
        .eq("community_id", communityId)
        .eq("is_removed", false)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      set({
        posts: [...posts, ...((data as ForumPostWithAuthor[]) ?? [])],
        page: page + 1,
      });
    } catch (err) {
      logError("post:loadMore", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async fetchPost(postId) {
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from("posts")
        .select("*, author:profiles!author_id(display_name, avatar_url)")
        .eq("id", postId)
        .single();

      if (error) throw error;
      set({ currentPost: data as ForumPostWithAuthor });
    } catch (err) {
      logError("post:fetchPost", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async fetchFeed(sort) {
    set({ isLoading: true, page: 0 });
    try {
      // Pull the most recent N posts across all public communities,
      // joined with community info so each card can show its origin.
      // For "hot" we sort client-side using a Reddit-style ranking
      // because we don't have a server function for it. For "new" and
      // "top" the server does the sort directly.
      let query = supabase
        .from("posts")
        .select(
          "*, author:profiles!author_id(display_name, avatar_url), community:communities!community_id(slug, name)",
        )
        .eq("is_removed", false);

      if (sort === "new") {
        query = query.order("created_at", { ascending: false });
      } else if (sort === "top") {
        query = query.order("score_cached", { ascending: false });
      } else {
        // For "hot" pull the most recent batch and re-rank in JS.
        query = query.order("created_at", { ascending: false });
      }

      const { data, error } = await query.range(0, PAGE_SIZE * 5 - 1);
      if (error) throw error;

      let posts = (data as ForumPostWithAuthor[]) ?? [];
      if (sort === "hot") {
        posts = [...posts].sort(
          (a, b) => hotScore(b) - hotScore(a),
        );
      }

      set({
        posts: posts.slice(0, PAGE_SIZE),
        totalCount: posts.length,
        page: 1,
      });
    } catch (err) {
      logError("post:fetchFeed", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async fetchPostsForBook({ bookId, catalogBookId }) {
    set({ isLoading: true, page: 0 });
    try {
      let query = supabase
        .from("posts")
        .select(
          "*, author:profiles!author_id(display_name, avatar_url), community:communities!community_id(slug, name)",
          { count: "exact" },
        )
        .eq("is_removed", false)
        .order("last_activity", { ascending: false })
        .limit(PAGE_SIZE);

      if (bookId) query = query.eq("book_id", bookId);
      else if (catalogBookId) query = query.eq("catalog_book_id", catalogBookId);
      else {
        set({ posts: [], totalCount: 0 });
        return;
      }

      const { data, count, error } = await query;
      if (error) throw error;
      set({
        posts: (data as ForumPostWithAuthor[]) ?? [],
        totalCount: count ?? 0,
        page: 1,
      });
    } catch (err) {
      logError("post:fetchPostsForBook", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async createPost(input) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");

    if (containsProfanity(input.title)) {
      throw new Error("Title contains inappropriate language.");
    }
    if (input.body_md && containsProfanity(input.body_md)) {
      throw new Error("Post body contains inappropriate language.");
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({
        community_id: input.community_id,
        author_id: user.id,
        title: input.title,
        kind: input.kind ?? "text",
        body_md: input.body_md ?? null,
        link_url: input.link_url ?? null,
        book_id: input.book_id ?? null,
        catalog_book_id: input.catalog_book_id ?? null,
      })
      .select("*, author:profiles!author_id(display_name, avatar_url)")
      .single();

    if (error) throw new Error(error.message);

    const post = data as ForumPostWithAuthor;
    set((state) => ({ posts: [post, ...state.posts] }));
    return post.id;
  },

  async removePost(postId) {
    try {
      const { error } = await supabase
        .from("posts")
        .update({ is_removed: true })
        .eq("id", postId);

      if (error) throw error;
      set((state) => ({
        posts: state.posts.filter((p) => p.id !== postId),
        currentPost:
          state.currentPost?.id === postId ? null : state.currentPost,
      }));
    } catch (err) {
      logError("post:remove", (err as Error).message);
    }
  },

  async fetchComments(postId) {
    try {
      // Don't filter out is_removed=true at the SQL level — soft-deleted
      // comments need to stay in the tree so their replies don't get
      // orphaned. The tree builder prunes leaf-deleted comments and
      // the UI substitutes the body with "[deleted by user]" for the
      // ones that remain.
      const { data, error } = await supabase
        .from("forum_comments")
        .select("*, author:profiles!author_id(display_name, avatar_url)")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      const tree = buildCommentTree(
        (data as ForumCommentWithAuthor[]) ?? [],
      );
      set({ comments: tree });
    } catch (err) {
      logError("post:fetchComments", (err as Error).message);
    }
  },

  async createComment(input) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");

    if (containsProfanity(input.body_md)) {
      throw new Error("Comment contains inappropriate language.");
    }

    const { error } = await supabase.from("forum_comments").insert({
      post_id: input.post_id,
      parent_id: input.parent_id ?? null,
      author_id: user.id,
      body_md: input.body_md,
    });

    if (error) throw new Error(error.message);

    // Refetch to get the updated tree
    await get().fetchComments(input.post_id);
  },

  async removeComment(commentId) {
    try {
      const { error } = await supabase
        .from("forum_comments")
        .update({ is_removed: true })
        .eq("id", commentId);

      if (error) throw error;

      // Refetch current post comments
      const postId = get().currentPost?.id;
      if (postId) await get().fetchComments(postId);
    } catch (err) {
      logError("post:removeComment", (err as Error).message);
    }
  },

  subscribePostUpdates(communityId) {
    const channel = supabase
      .channel(`posts:${communityId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "posts",
          filter: `community_id=eq.${communityId}`,
        },
        async () => {
          // Simple refetch on new post
          await get().fetchPosts(communityId);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  subscribeCommentUpdates(postId) {
    const channel = supabase
      .channel(`comments:${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "forum_comments",
          filter: `post_id=eq.${postId}`,
        },
        async () => {
          await get().fetchComments(postId);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  clearCurrentPost() {
    set({ currentPost: null, comments: [] });
  },
}));
