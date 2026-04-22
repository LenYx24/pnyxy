import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import type {
  Quiz,
  QuizAttempt,
  QuizAttemptAnswer,
  QuizQuestion,
  QuizQuestionDraft,
  QuizQuestionStat,
  QuizVisibility,
} from "@/types/quiz";

interface QuizState {
  /** Public browse feed — replaced on every fetchPublic call. */
  publicQuizzes: Quiz[];
  /** Quizzes the signed-in user owns. */
  myQuizzes: Quiz[];
  isLoading: boolean;

  fetchPublic: (filter?: {
    query?: string;
    catalogBookId?: string;
    uploadedBookId?: string;
    standaloneOnly?: boolean;
  }) => Promise<void>;
  fetchMine: () => Promise<void>;

  getQuiz: (id: string) => Promise<{
    quiz: Quiz;
    questions: QuizQuestion[];
  } | null>;

  createQuiz: (input: {
    title: string;
    description: string | null;
    visibility: QuizVisibility;
    uploaded_book_id: string | null;
    catalog_book_id: string | null;
    questions: QuizQuestionDraft[];
  }) => Promise<string | null>;

  updateQuiz: (
    id: string,
    patch: Partial<
      Pick<
        Quiz,
        | "title"
        | "description"
        | "visibility"
        | "uploaded_book_id"
        | "catalog_book_id"
      >
    >,
    questions?: QuizQuestionDraft[],
  ) => Promise<void>;

  deleteQuiz: (id: string) => Promise<void>;

  /** Record a completed attempt in one shot. */
  submitAttempt: (
    quizId: string,
    answers: { question_id: string; selected_index: number; is_correct: boolean }[],
  ) => Promise<QuizAttempt | null>;

  fetchAttempts: (quizId: string) => Promise<QuizAttempt[]>;

  fetchAttemptDetail: (attemptId: string) => Promise<{
    attempt: QuizAttempt;
    answers: QuizAttemptAnswer[];
  } | null>;

  /** Owner-only; returns per-question aggregate stats for the quiz. */
  fetchQuestionStats: (quizId: string) => Promise<QuizQuestionStat[]>;
}

function assertCleanText(...parts: (string | null)[]) {
  for (const p of parts) {
    if (p && containsProfanity(p)) {
      throw new Error(
        "Content contains disallowed language. Please edit and try again.",
      );
    }
  }
}

export const useQuizStore = create<QuizState>((set, get) => ({
  publicQuizzes: [],
  myQuizzes: [],
  isLoading: false,

  async fetchPublic(filter) {
    set({ isLoading: true });
    try {
      let q = supabase
        .from("quizzes")
        .select("*")
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter?.query) {
        q = q.ilike("title", `%${filter.query}%`);
      }
      if (filter?.catalogBookId) {
        q = q.eq("catalog_book_id", filter.catalogBookId);
      }
      if (filter?.uploadedBookId) {
        q = q.eq("uploaded_book_id", filter.uploadedBookId);
      }
      if (filter?.standaloneOnly) {
        q = q.is("catalog_book_id", null).is("uploaded_book_id", null);
      }

      const { data, error } = await q;
      if (error) throw error;
      set({ publicQuizzes: (data ?? []) as Quiz[] });
    } catch (err) {
      logError("quiz-store:fetchPublic", err);
    } finally {
      set({ isLoading: false });
    }
  },

  async fetchMine() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ myQuizzes: [] });
      return;
    }
    set({ isLoading: true });
    try {
      const { data, error } = await supabase
        .from("quizzes")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      set({ myQuizzes: (data ?? []) as Quiz[] });
    } catch (err) {
      logError("quiz-store:fetchMine", err);
    } finally {
      set({ isLoading: false });
    }
  },

  async getQuiz(id) {
    const [quizRes, questionsRes] = await Promise.all([
      supabase.from("quizzes").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("quiz_questions")
        .select("*")
        .eq("quiz_id", id)
        .order("position", { ascending: true }),
    ]);
    if (quizRes.error || !quizRes.data) {
      if (quizRes.error) logError("quiz-store:getQuiz", quizRes.error);
      return null;
    }
    if (questionsRes.error) {
      logError("quiz-store:getQuiz:questions", questionsRes.error);
      return null;
    }
    return {
      quiz: quizRes.data as Quiz,
      questions: (questionsRes.data ?? []) as QuizQuestion[],
    };
  },

  async createQuiz(input) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to create a quiz.");

    assertCleanText(
      input.title,
      input.description,
      ...input.questions.flatMap((q) => [
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.explanation,
      ]),
    );

    const { data: quizRow, error: quizErr } = await supabase
      .from("quizzes")
      .insert({
        user_id: user.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        visibility: input.visibility,
        uploaded_book_id: input.uploaded_book_id,
        catalog_book_id: input.catalog_book_id,
      })
      .select()
      .single();
    if (quizErr || !quizRow) {
      logError("quiz-store:createQuiz", quizErr);
      throw quizErr ?? new Error("Could not create quiz.");
    }

    if (input.questions.length > 0) {
      const rows = input.questions.map((q, i) => ({
        quiz_id: quizRow.id,
        position: i,
        question_text: q.question_text.trim(),
        option_a: q.option_a.trim(),
        option_b: q.option_b.trim(),
        option_c: q.option_c.trim(),
        option_d: q.option_d.trim(),
        correct_index: q.correct_index,
        explanation: q.explanation?.trim() || null,
      }));
      const { error: qErr } = await supabase.from("quiz_questions").insert(rows);
      if (qErr) {
        logError("quiz-store:createQuiz:questions", qErr);
        // Roll back the quiz row so we don't leave a bare shell.
        await supabase.from("quizzes").delete().eq("id", quizRow.id);
        throw qErr;
      }
    }

    await get().fetchMine();
    return quizRow.id as string;
  },

  async updateQuiz(id, patch, questions) {
    assertCleanText(patch.title ?? null, patch.description ?? null);
    const { error: qErr } = await supabase
      .from("quizzes")
      .update(patch)
      .eq("id", id);
    if (qErr) {
      logError("quiz-store:updateQuiz", qErr);
      throw qErr;
    }

    if (questions) {
      assertCleanText(
        ...questions.flatMap((q) => [
          q.question_text,
          q.option_a,
          q.option_b,
          q.option_c,
          q.option_d,
          q.explanation,
        ]),
      );
      // Replace-all strategy: simpler and idempotent, since per-question
      // diffing would need stable ids and reorderable positions. For a
      // quiz-sized payload (a few dozen questions) this is fine.
      await supabase.from("quiz_questions").delete().eq("quiz_id", id);
      if (questions.length > 0) {
        const rows = questions.map((q, i) => ({
          quiz_id: id,
          position: i,
          question_text: q.question_text.trim(),
          option_a: q.option_a.trim(),
          option_b: q.option_b.trim(),
          option_c: q.option_c.trim(),
          option_d: q.option_d.trim(),
          correct_index: q.correct_index,
          explanation: q.explanation?.trim() || null,
        }));
        const { error: insErr } = await supabase
          .from("quiz_questions")
          .insert(rows);
        if (insErr) {
          logError("quiz-store:updateQuiz:reinsert", insErr);
          throw insErr;
        }
      }
    }
    await get().fetchMine();
  },

  async deleteQuiz(id) {
    const { error } = await supabase.from("quizzes").delete().eq("id", id);
    if (error) {
      logError("quiz-store:deleteQuiz", error);
      throw error;
    }
    set((s) => ({ myQuizzes: s.myQuizzes.filter((q) => q.id !== id) }));
  },

  async submitAttempt(quizId, answers) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to submit an attempt.");

    const score = answers.reduce((n, a) => n + (a.is_correct ? 1 : 0), 0);
    const total = answers.length;

    const { data: attempt, error: attemptErr } = await supabase
      .from("quiz_attempts")
      .insert({
        user_id: user.id,
        quiz_id: quizId,
        score,
        total,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (attemptErr || !attempt) {
      logError("quiz-store:submitAttempt", attemptErr);
      return null;
    }

    if (answers.length > 0) {
      const rows = answers.map((a) => ({
        attempt_id: attempt.id,
        question_id: a.question_id,
        selected_index: a.selected_index,
        is_correct: a.is_correct,
      }));
      const { error: ansErr } = await supabase
        .from("quiz_attempt_answers")
        .insert(rows);
      if (ansErr) {
        logError("quiz-store:submitAttempt:answers", ansErr);
      }
    }

    return attempt as QuizAttempt;
  },

  async fetchAttempts(quizId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("*")
      .eq("quiz_id", quizId)
      .eq("user_id", user.id)
      .order("completed_at", { ascending: false })
      .limit(20);
    if (error) {
      logError("quiz-store:fetchAttempts", error);
      return [];
    }
    return (data ?? []) as QuizAttempt[];
  },

  async fetchAttemptDetail(attemptId) {
    const [a, b] = await Promise.all([
      supabase.from("quiz_attempts").select("*").eq("id", attemptId).maybeSingle(),
      supabase
        .from("quiz_attempt_answers")
        .select("*")
        .eq("attempt_id", attemptId),
    ]);
    if (a.error || !a.data) return null;
    if (b.error) {
      logError("quiz-store:fetchAttemptDetail", b.error);
      return null;
    }
    return {
      attempt: a.data as QuizAttempt,
      answers: (b.data ?? []) as QuizAttemptAnswer[],
    };
  },

  async fetchQuestionStats(quizId) {
    const { data, error } = await supabase.rpc("quiz_most_missed", {
      p_quiz_id: quizId,
    });
    if (error) {
      // `not_owner` / `not_authenticated` are expected for non-owner
      // callers — just surface an empty list so the UI hides the panel.
      logError("quiz-store:fetchQuestionStats", error);
      return [];
    }
    return (data ?? []) as QuizQuestionStat[];
  },
}));
