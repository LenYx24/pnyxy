import type { Card } from "ts-fsrs";

export type VocabRating = "again" | "hard" | "good" | "easy";

/**
 * A captured vocabulary entry. Created when the user defines a word
 * in the reader and persisted locally (IndexedDB) and remotely
 * (Supabase) for cross-device review.
 *
 * `fsrsCard` is owned by ts-fsrs, we pass it back through the
 * scheduler untouched.
 */
export interface VocabEntry {
  id: string;
  userId: string | null;

  word: string;
  lang: string;
  definition: string;
  contextSentence: string;

  sourceDocumentId: string | null;
  sourceTitle: string | null;
  sourcePage: number | null;

  fsrsCard: Card;

  /** Denormalized from fsrsCard.due for cheap "due now" filtering. */
  dueAt: number;
  createdAt: number;
  updatedAt: number;
}
