import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { containsProfanity } from "@/lib/profanity-filter";
import type {
  DueReview,
  Quiz,
  QuizAttempt,
  QuizAttemptAnswer,
  QuizQuestion,
  QuizQuestionDraft,
  QuizQuestionStat,
  QuizReview,
  QuizVisibility,
} from "@/types/quiz";
import {
  emptyReviewState,
  nextReviewState,
  type ReviewState,
} from "@/lib/quiz/quiz-srs";

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
    randomize_questions?: boolean;
    randomize_options?: boolean;
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
        | "randomize_questions"
        | "randomize_options"
      >
    >,
    questions?: QuizQuestionDraft[],
  ) => Promise<void>;

  deleteQuiz: (id: string) => Promise<void>;

  /** Copy a quiz (and its questions) into the signed-in user's own
   *  library as a new private quiz. Used for "Duplicate to my
   *  quizzes" on community items. Returns the new quiz id, or null. */
  duplicateQuiz: (id: string) => Promise<string | null>;

  /** Record a completed attempt in one shot. `selected_index` is used
   *  for mcq4/true_false; `selected_text` for short_answer. At least one
   *  must be provided per answer. */
  submitAttempt: (
    quizId: string,
    answers: SubmitAnswer[],
  ) => Promise<QuizAttempt | null>;

  fetchAttempts: (quizId: string) => Promise<QuizAttempt[]>;

  fetchAttemptDetail: (attemptId: string) => Promise<{
    attempt: QuizAttempt;
    answers: QuizAttemptAnswer[];
  } | null>;

  /** Owner-only; returns per-question aggregate stats for the quiz. */
  fetchQuestionStats: (quizId: string) => Promise<QuizQuestionStat[]>;

  /** Upsert FSRS review state for each (question, correctness) pair.
   *  Called from submitAttempt; exposed separately for the /quizzes/review
   *  flow where no parent quiz_attempt row is written. */
  recordReviewBatch: (
    answers: { question_id: string; is_correct: boolean }[],
  ) => Promise<void>;

  /** Due cards across all of the signed-in user's reviews, oldest-due
   *  first. Each row joins the question payload for rendering. */
  fetchDueReviews: (limit?: number) => Promise<DueReview[]>;
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

export interface SubmitAnswer {
  question_id: string;
  selected_index?: number | null;
  selected_text?: string | null;
  is_correct: boolean;
}

function draftTexts(q: QuizQuestionDraft): (string | null)[] {
  switch (q.kind) {
    case "mcq4":
      return [
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.explanation,
      ];
    case "true_false":
      return [q.question_text, q.option_a, q.option_b, q.explanation];
    case "short_answer":
      return [q.question_text, q.correct_text, q.explanation];
  }
}

function draftToRow(
  q: QuizQuestionDraft,
  position: number,
  quizId: string,
): Record<string, unknown> {
  const base = {
    quiz_id: quizId,
    position,
    kind: q.kind,
    question_text: q.question_text.trim(),
    explanation: q.explanation?.trim() || null,
  };
  switch (q.kind) {
    case "mcq4":
      return {
        ...base,
        option_a: q.option_a.trim(),
        option_b: q.option_b.trim(),
        option_c: q.option_c.trim(),
        option_d: q.option_d.trim(),
        correct_index: q.correct_index,
        correct_text: null,
      };
    case "true_false":
      return {
        ...base,
        option_a: q.option_a.trim() || "True",
        option_b: q.option_b.trim() || "False",
        option_c: null,
        option_d: null,
        correct_index: q.correct_index,
        correct_text: null,
      };
    case "short_answer":
      return {
        ...base,
        option_a: null,
        option_b: null,
        option_c: null,
        option_d: null,
        correct_index: null,
        correct_text: q.correct_text.trim(),
      };
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
      ...input.questions.flatMap(draftTexts),
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
        randomize_questions: input.randomize_questions ?? false,
        randomize_options: input.randomize_options ?? false,
      })
      .select()
      .single();
    if (quizErr || !quizRow) {
      logError("quiz-store:createQuiz", quizErr);
      throw quizErr ?? new Error("Could not create quiz.");
    }

    if (input.questions.length > 0) {
      const rows = input.questions.map((q, i) =>
        draftToRow(q, i, quizRow.id as string),
      );
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
      assertCleanText(...questions.flatMap(draftTexts));
      // Replace-all strategy: simpler and idempotent, since per-question
      // diffing would need stable ids and reorderable positions. For a
      // quiz-sized payload (a few dozen questions) this is fine.
      await supabase.from("quiz_questions").delete().eq("quiz_id", id);
      if (questions.length > 0) {
        const rows = questions.map((q, i) => draftToRow(q, i, id));
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

  async duplicateQuiz(id) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to duplicate a quiz.");

    const source = await get().getQuiz(id);
    if (!source) throw new Error("Quiz not found.");

    // Copy fields that make sense on a new row; drop owner/visibility
    // so the new copy starts private and owned by the current user.
    const { data: newRow, error: insErr } = await supabase
      .from("quizzes")
      .insert({
        user_id: user.id,
        title: source.quiz.title,
        description: source.quiz.description,
        visibility: "private",
        uploaded_book_id: source.quiz.uploaded_book_id,
        catalog_book_id: source.quiz.catalog_book_id,
        randomize_questions: source.quiz.randomize_questions,
        randomize_options: source.quiz.randomize_options,
      })
      .select()
      .single();
    if (insErr || !newRow) {
      logError("quiz-store:duplicateQuiz", insErr);
      throw insErr ?? new Error("Could not duplicate quiz.");
    }

    if (source.questions.length > 0) {
      const rows = source.questions.map((q, i) => ({
        quiz_id: newRow.id as string,
        position: i,
        kind: q.kind,
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_index: q.correct_index,
        correct_text: q.correct_text,
      }));
      const { error: qErr } = await supabase.from("quiz_questions").insert(rows);
      if (qErr) {
        logError("quiz-store:duplicateQuiz:questions", qErr);
        throw qErr;
      }
    }

    // Refresh the user's quiz list so the new copy shows up immediately.
    await get().fetchMine();
    return newRow.id as string;
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
        selected_index: a.selected_index ?? null,
        selected_text: a.selected_text ?? null,
        is_correct: a.is_correct,
      }));
      const { error: ansErr } = await supabase
        .from("quiz_attempt_answers")
        .insert(rows);
      if (ansErr) {
        logError("quiz-store:submitAttempt:answers", ansErr);
      }
      // Fold the same answers into FSRS state so the question appears
      // on /quizzes/review on its scheduled cadence. Failure here is
      // non-fatal for the attempt — the score is already saved.
      try {
        await get().recordReviewBatch(
          answers.map((a) => ({
            question_id: a.question_id,
            is_correct: a.is_correct,
          })),
        );
      } catch (err) {
        logError("quiz-store:submitAttempt:reviews", err);
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

  async recordReviewBatch(reviews) {
    if (reviews.length === 0) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const questionIds = [...new Set(reviews.map((r) => r.question_id))];
    const { data: existingRows, error: exErr } = await supabase
      .from("quiz_reviews")
      .select("*")
      .eq("user_id", user.id)
      .in("question_id", questionIds);
    if (exErr) {
      logError("quiz-store:recordReviewBatch:fetch", exErr);
      throw exErr;
    }
    const byQuestion = new Map<string, QuizReview>();
    for (const row of (existingRows ?? []) as QuizReview[]) {
      byQuestion.set(row.question_id, row);
    }

    const now = new Date();
    const rows = reviews.map((r) => {
      const existing = byQuestion.get(r.question_id);
      const current: ReviewState | null = existing
        ? {
            stability: existing.stability,
            difficulty: existing.difficulty,
            state: existing.state,
            due_at: existing.due_at,
            last_reviewed_at: existing.last_reviewed_at,
            lapses: existing.lapses,
            reps: existing.reps,
          }
        : null;
      const next = current
        ? nextReviewState(current, r.is_correct, now)
        : nextReviewState(emptyReviewState(now), r.is_correct, now);
      return {
        user_id: user.id,
        question_id: r.question_id,
        stability: next.stability,
        difficulty: next.difficulty,
        state: next.state,
        due_at: next.due_at,
        last_reviewed_at: now.toISOString(),
        lapses: next.lapses,
        reps: next.reps,
      };
    });

    const { error } = await supabase
      .from("quiz_reviews")
      .upsert(rows, { onConflict: "user_id,question_id" });
    if (error) {
      logError("quiz-store:recordReviewBatch:upsert", error);
      throw error;
    }
  },

  async fetchDueReviews(limit = 20) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("quiz_reviews")
      .select("*, quiz_questions!inner(*)")
      .eq("user_id", user.id)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(limit);
    if (error) {
      logError("quiz-store:fetchDueReviews", error);
      return [];
    }
    type Row = QuizReview & { quiz_questions: QuizQuestion };
    return ((data ?? []) as Row[]).map((row) => ({
      review: {
        id: row.id,
        user_id: row.user_id,
        question_id: row.question_id,
        stability: row.stability,
        difficulty: row.difficulty,
        state: row.state,
        last_reviewed_at: row.last_reviewed_at,
        due_at: row.due_at,
        lapses: row.lapses,
        reps: row.reps,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      question: row.quiz_questions,
    }));
  },
}));
