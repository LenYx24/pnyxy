export type QuizVisibility = "private" | "public";
export type QuizQuestionKind =
  | "mcq4"
  | "true_false"
  | "short_answer"
  | "multi_select";

export interface Quiz {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  visibility: QuizVisibility;
  uploaded_book_id: string | null;
  catalog_book_id: string | null;
  /** Library folder the quiz lives in (00045). null = root. */
  folder_id: string | null;
  /** Position within the folder; lower = earlier (00045). */
  sort_order: number;
  question_count: number;
  randomize_questions: boolean;
  randomize_options: boolean;
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
  /** MCQ4: 0..3. TF: 0 or 1 (0=option_a is correct). SA/multi_select: null. */
  correct_index: number | null;
  /** short_answer: the expected free-text answer. multi_select: a
   *  comma-separated, sorted list of the correct option indices
   *  (e.g. "0,2,3"); parse with `parseCorrectIndices`. */
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
 *  chosen kind can be left empty, the store normalises them to null. */
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
  /** multi_select only: the set of correct option indices (0..3). Empty
   *  for every other kind. Serialised into `correct_text` when stored. */
  correct_indices: number[];
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

/** Parses the comma-separated correct-index list a multi_select
 *  question stores in `correct_text` into a deduped, sorted array of
 *  valid option indices (0..3). Also used to read the user's picked
 *  set back out of `selected_text`. */
export function parseCorrectIndices(text: string | null | undefined): number[] {
  if (!text) return [];
  const seen = new Set<number>();
  for (const part of text.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 3) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Serialises a set of correct/picked indices into the canonical
 *  comma-separated, sorted, deduped string stored in the DB. */
export function serializeIndices(indices: number[]): string {
  const seen = new Set<number>();
  for (const n of indices) {
    if (Number.isInteger(n) && n >= 0 && n <= 3) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b).join(",");
}

/** Grades a short-answer response leniently against the stored
 *  correct_text. Tolerates case, diacritics/accents (so "só" matches
 *  "so"), surrounding/most punctuation, and whitespace differences.
 *  Deterministic and still a boolean, it does not match everything. */
export function matchesShortAnswer(
  userText: string,
  correctText: string,
): boolean {
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      // Strip combining diacritical marks (accents) left by NFD.
      .replace(/[̀-ͯ]/g, "")
      .toLocaleLowerCase()
      // Drop punctuation/symbols anywhere; keep letters, numbers, space.
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    case "multi_select": {
      // All-correct-required (all-or-nothing) scoring: the picked set
      // must equal the correct set exactly, no missing, no extra. Both
      // sides come out of parseCorrectIndices already deduped + sorted.
      const correct = parseCorrectIndices(question.correct_text);
      const selected = parseCorrectIndices(answer.selected_text);
      return (
        correct.length > 0 &&
        correct.length === selected.length &&
        correct.every((v, i) => v === selected[i])
      );
    }
  }
}
