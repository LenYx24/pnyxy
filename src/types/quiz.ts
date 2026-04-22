export type QuizVisibility = "private" | "public";

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
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  /** 0..3 */
  correct_index: number;
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
  selected_index: number;
  is_correct: boolean;
  answered_at: string;
}

/** Input shape for creating/updating questions — no generated id. */
export interface QuizQuestionDraft {
  id?: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_index: number;
  explanation: string | null;
}
