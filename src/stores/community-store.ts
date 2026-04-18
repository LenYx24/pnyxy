import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import type {
  Community,
  CommunityInsert,
  CommunityRole,
} from "@/types/forum";

const PAGE_SIZE = 20;

interface CommunityState {
  communities: Community[];
  joinedCommunities: Community[];
  currentCommunity: Community | null;
  userMemberships: Map<string, CommunityRole>;
  isLoading: boolean;
  totalCount: number;
  page: number;

  fetchCommunities: () => Promise<void>;
  loadMore: () => Promise<void>;
  fetchJoinedCommunities: () => Promise<void>;
  fetchCommunityBySlug: (slug: string) => Promise<Community | null>;
  createCommunity: (data: CommunityInsert) => Promise<Community>;
  joinCommunity: (communityId: string) => Promise<void>;
  leaveCommunity: (communityId: string) => Promise<void>;
  checkMemberships: () => Promise<void>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  communities: [],
  joinedCommunities: [],
  currentCommunity: null,
  userMemberships: new Map(),
  isLoading: false,
  totalCount: 0,
  page: 0,

  async fetchCommunities() {
    set({ isLoading: true, page: 0 });
    try {
      const { data, count, error } = await supabase
        .from("communities")
        .select("*", { count: "exact" })
        .order("member_count", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;
      set({
        communities: (data as Community[]) ?? [],
        totalCount: count ?? 0,
        page: 1,
      });
    } catch (err) {
      logError("community:fetchCommunities", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async loadMore() {
    const { page, communities, totalCount } = get();
    if (communities.length >= totalCount) return;

    set({ isLoading: true });
    try {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("communities")
        .select("*")
        .order("member_count", { ascending: false })
        .range(from, to);

      if (error) throw error;
      set({
        communities: [...communities, ...((data as Community[]) ?? [])],
        page: page + 1,
      });
    } catch (err) {
      logError("community:loadMore", (err as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  async fetchJoinedCommunities() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("community_memberships")
        .select("community_id, communities(*)")
        .eq("user_id", user.id);

      if (error) throw error;

      const joined = (data ?? [])
        .map((row: Record<string, unknown>) => row.communities as Community)
        .filter(Boolean);

      set({ joinedCommunities: joined });
    } catch (err) {
      logError("community:fetchJoined", (err as Error).message);
    }
  },

  async fetchCommunityBySlug(slug) {
    try {
      const { data, error } = await supabase
        .from("communities")
        .select("*")
        .eq("slug", slug)
        .single();

      if (error) throw error;
      const community = data as Community;
      set({ currentCommunity: community });
      return community;
    } catch (err) {
      logError("community:fetchBySlug", (err as Error).message);
      return null;
    }
  },

  async createCommunity(input) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in to create a community.");

    if (containsProfanity(input.name)) {
      throw new Error("Community name contains inappropriate language.");
    }
    if (input.description && containsProfanity(input.description)) {
      throw new Error("Description contains inappropriate language.");
    }

    const slug = input.slug || slugify(input.name);
    if (!slug) throw new Error("Invalid community name.");

    // Try insert, retry with suffix on slug collision
    for (let attempt = 0; attempt < 3; attempt++) {
      const trySlug = attempt === 0 ? slug : `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await supabase
        .from("communities")
        .insert({
          slug: trySlug,
          name: input.name,
          kind: input.kind ?? "topic",
          description: input.description ?? "",
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505" && attempt < 2) continue; // unique violation, retry
        throw new Error(error.message);
      }

      const community = data as Community;

      // Update local state
      set((state) => ({
        communities: [community, ...state.communities],
        joinedCommunities: [community, ...state.joinedCommunities],
        userMemberships: new Map(state.userMemberships).set(community.id, "owner"),
      }));

      return community;
    }

    throw new Error("Could not generate a unique slug. Try a different name.");
  },

  async joinCommunity(communityId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const { error } = await supabase
        .from("community_memberships")
        .insert({ user_id: user.id, community_id: communityId, role: "member" });

      if (error) throw error;

      set((state) => {
        const memberships = new Map(state.userMemberships);
        memberships.set(communityId, "member");

        const community = state.communities.find((c) => c.id === communityId);
        const joinedCommunities = community
          ? [...state.joinedCommunities, community]
          : state.joinedCommunities;

        // Bump local member_count
        const communities = state.communities.map((c) =>
          c.id === communityId ? { ...c, member_count: c.member_count + 1 } : c,
        );
        const currentCommunity =
          state.currentCommunity?.id === communityId
            ? { ...state.currentCommunity, member_count: state.currentCommunity.member_count + 1 }
            : state.currentCommunity;

        return { userMemberships: memberships, joinedCommunities, communities, currentCommunity };
      });
    } catch (err) {
      logError("community:join", (err as Error).message);
    }
  },

  async leaveCommunity(communityId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const { error } = await supabase
        .from("community_memberships")
        .delete()
        .eq("user_id", user.id)
        .eq("community_id", communityId);

      if (error) throw error;

      set((state) => {
        const memberships = new Map(state.userMemberships);
        memberships.delete(communityId);

        const joinedCommunities = state.joinedCommunities.filter(
          (c) => c.id !== communityId,
        );

        const communities = state.communities.map((c) =>
          c.id === communityId ? { ...c, member_count: Math.max(0, c.member_count - 1) } : c,
        );
        const currentCommunity =
          state.currentCommunity?.id === communityId
            ? { ...state.currentCommunity, member_count: Math.max(0, state.currentCommunity.member_count - 1) }
            : state.currentCommunity;

        return { userMemberships: memberships, joinedCommunities, communities, currentCommunity };
      });
    } catch (err) {
      logError("community:leave", (err as Error).message);
    }
  },

  async checkMemberships() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("community_memberships")
        .select("community_id, role")
        .eq("user_id", user.id);

      if (error) throw error;

      const map = new Map<string, CommunityRole>();
      for (const row of data ?? []) {
        map.set(
          row.community_id as string,
          row.role as CommunityRole,
        );
      }
      set({ userMemberships: map });
    } catch (err) {
      logError("community:checkMemberships", (err as Error).message);
    }
  },
}));
