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
  return roots;
}

interface PostState {
  posts: ForumPostWithAuthor[];
  currentPost: ForumPostWithAuthor | null;
  comments: ForumCommentWithAuthor[];
  isLoading: boolean;
  totalCount: number;
  page: number;

  fetchPosts: (communityId: string) => Promise<void>;
  loadMorePosts: (communityId: string) => Promise<void>;
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
      const { data, error } = await supabase
        .from("forum_comments")
        .select("*, author:profiles!author_id(display_name, avatar_url)")
        .eq("post_id", postId)
        .eq("is_removed", false)
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
