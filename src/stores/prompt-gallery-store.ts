import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { SharedAnswer } from "@/types/space";

/**
 * Public "prompt gallery" — shared {question, answer} pairs (migration
 * 00055). A Share button on an assistant message publishes here; the gallery
 * page (optionally scoped to a space) lists them so others can learn from
 * useful answers.
 */
interface PromptGalleryState {
  answers: SharedAnswer[];
  /** Ids the current user has upvoted (for the filled/voted state). */
  votedIds: Set<string>;
  loading: boolean;
  error: string | null;
  fetchGallery: (spaceId?: string | null) => Promise<void>;
  shareAnswer: (input: {
    question: string;
    answer: string;
    model?: string | null;
    spaceId?: string | null;
  }) => Promise<string | null>;
  deleteShared: (id: string) => Promise<void>;
  /** Toggle the current user's upvote on an answer (optimistic). */
  toggleVote: (answerId: string) => Promise<void>;
}

export const usePromptGalleryStore = create<PromptGalleryState>((set, get) => ({
  answers: [],
  votedIds: new Set(),
  loading: false,
  error: null,

  async fetchGallery(spaceId = null) {
    set({ loading: true, error: null });
    try {
      let q = supabase
        .from("shared_answers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      // null spaceId = global gallery (space-scoped rows still readable, but
      // the global view shows everything the RLS lets through)
      if (spaceId) q = q.eq("space_id", spaceId);
      const { data, error } = await q;
      if (error) {
        logError("gallery:fetch", error);
        set({ error: error.message });
        return;
      }
      const answers = (data ?? []) as SharedAnswer[];
      set({ answers });
      // which of these the current user has already upvoted
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user && answers.length > 0) {
        const { data: votes } = await supabase
          .from("shared_answer_votes")
          .select("shared_answer_id")
          .eq("user_id", user.id)
          .in(
            "shared_answer_id",
            answers.map((a) => a.id),
          );
        set({
          votedIds: new Set(
            (votes ?? []).map(
              (v: { shared_answer_id: string }) => v.shared_answer_id,
            ),
          ),
        });
      } else {
        set({ votedIds: new Set() });
      }
    } finally {
      set({ loading: false });
    }
  },

  async shareAnswer({ question, answer, model = null, spaceId = null }) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to share.");
    const { data, error } = await supabase
      .from("shared_answers")
      .insert({
        user_id: user.id,
        space_id: spaceId,
        question: question.slice(0, 4000),
        answer: answer.slice(0, 20000),
        model,
      })
      .select()
      .single();
    if (error || !data) {
      logError("gallery:share", error);
      throw error ?? new Error("Could not share.");
    }
    set((s) => ({ answers: [data as SharedAnswer, ...s.answers] }));
    return data.id as string;
  },

  async deleteShared(id) {
    const { error } = await supabase
      .from("shared_answers")
      .delete()
      .eq("id", id);
    if (error) {
      logError("gallery:delete", error);
      throw error;
    }
    set((s) => ({ answers: s.answers.filter((a) => a.id !== id) }));
  },

  async toggleVote(answerId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to vote.");
    const voted = get().votedIds.has(answerId);
    // optimistic: flip vote + adjust the count
    const apply = (undo: boolean) =>
      set((s) => {
        const on = undo ? voted : !voted;
        const votedIds = new Set(s.votedIds);
        if (on) votedIds.add(answerId);
        else votedIds.delete(answerId);
        const delta = on ? 1 : -1;
        return {
          votedIds,
          answers: s.answers.map((a) =>
            a.id === answerId
              ? { ...a, upvotes: Math.max(0, a.upvotes + delta) }
              : a,
          ),
        };
      });
    apply(false);
    const { error } = voted
      ? await supabase
          .from("shared_answer_votes")
          .delete()
          .eq("shared_answer_id", answerId)
          .eq("user_id", user.id)
      : await supabase
          .from("shared_answer_votes")
          .insert({ shared_answer_id: answerId, user_id: user.id });
    if (error) {
      logError("gallery:toggleVote", error);
      apply(true); // rollback
    }
  },
}));
