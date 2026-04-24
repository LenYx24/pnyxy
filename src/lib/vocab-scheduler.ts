import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";
import type { VocabRating } from "@/types/vocab";

const scheduler = fsrs();

const RATING_MAP: Record<VocabRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

/**
 * Apply a review rating to a card and return the updated card plus
 * the next due date. `now` defaults to the current time so tests can
 * inject a fixed clock.
 */
export function reviewCard(
  card: Card,
  rating: VocabRating,
  now: Date = new Date(),
): { card: Card; dueAt: Date } {
  const result = scheduler.next(card, now, RATING_MAP[rating]);
  return { card: result.card, dueAt: result.card.due };
}

/**
 * Deserialize a Card from JSON (Supabase jsonb or IndexedDB). Date
 * fields come back as strings — the scheduler expects real Dates.
 */
export function hydrateCard(raw: unknown): Card {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as Card),
    due: new Date(r.due as string | number | Date),
    last_review:
      r.last_review != null
        ? new Date(r.last_review as string | number | Date)
        : undefined,
  };
}
