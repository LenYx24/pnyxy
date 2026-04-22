export type QuizVisibility = "private" | "public";
export type QuizQuestionKind = "mcq4" | "true_false" | "short_answer";

export interface Quiz {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  visibility: QuizVisibility;
  uploaded_book_id: string | null;
  catalog_book_id: string | null;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  position: number;
  kind: QuizQuestionKind;
  question_text: string;
  /** MCQ4: option A. TF: typically "True" label. SA: null. */
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  /** MCQ4: 0..3. TF: 0 or 1 (0=option_a is correct). SA: null. */
  correct_index: number | null;
  /** Only set for short_answer. */
  correct_text: string | null;
  explanation: string | null;
  created_at: string;
}

export interface QuizAttempt {
  id: string;
  user_id: string;
  quiz_id: string;
  score: number;
  total: number;
  started_at: string;
  completed_at: string | null;
}

export interface QuizAttemptAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  /** MCQ4/TF: the picked option. Null for short_answer. */
  selected_index: number | null;
  /** Short-answer text the user typed. Null for MCQ/TF. */
  selected_text: string | null;
  is_correct: boolean;
  answered_at: string;
}

/** Input shape for creating/updating questions. Fields unused by the
 *  chosen kind can be left empty — the store normalises them to null. */
export interface QuizQuestionDraft {
  id?: string;
  kind: QuizQuestionKind;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_index: number;
  correct_text: string;
  explanation: string | null;
}

/** Per-user-per-question spaced-repetition state. */
export interface QuizReview {
  id: string;
  user_id: string;
  question_id: string;
  stability: number;
  difficulty: number;
  /** 0=new, 1=learning, 2=review, 3=relearning (FSRS State enum). */
  state: number;
  last_reviewed_at: string | null;
  due_at: string;
  lapses: number;
  reps: number;
  created_at: string;
  updated_at: string;
}

/** A due review paired with its question. Returned by fetchDueReviews. */
export interface DueReview {
  review: QuizReview;
  question: QuizQuestion;
}

/** Owner-only aggregate from the quiz_most_missed RPC. */
export interface QuizQuestionStat {
  question_id: string;
  question_text: string;
  /** 0-indexed position of the question within the quiz. */
  question_position: number;
  attempts: number;
  wrong: number;
}

/** Grades a short-answer response case-insensitively against the
 *  stored correct_text. Trimmed, collapsed-whitespace, lowercased. */
export function matchesShortAnswer(
  userText: string,
  correctText: string,
): boolean {
  const normalize = (s: string) =>
    s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return normalize(userText) === normalize(correctText);
}

/** Determines whether a user's submission is correct for a given
 *  question. Centralised so the take page, review page, and FSRS
 *  path all agree on grading. */
export function gradeAnswer(
  question: Pick<QuizQuestion, "kind" | "correct_index" | "correct_text">,
  answer: { selected_index?: number | null; selected_text?: string | null },
): boolean {
  switch (question.kind) {
    case "mcq4":
    case "true_false":
      return (
        answer.selected_index != null &&
        question.correct_index != null &&
        answer.selected_index === question.correct_index
      );
    case "short_answer":
      return (
        typeof answer.selected_text === "string" &&
        typeof question.correct_text === "string" &&
        matchesShortAnswer(answer.selected_text, question.correct_text)
      );
  }
}
