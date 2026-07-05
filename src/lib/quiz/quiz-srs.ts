import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
} from "ts-fsrs";

const scheduler = fsrs(generatorParameters());

/** Shape persisted in `quiz_reviews`. The state enum maps 1:1 to
 *  ts-fsrs' State: 0=new, 1=learning, 2=review, 3=relearning. */
export interface ReviewState {
  stability: number;
  difficulty: number;
  state: number;
  due_at: string;
  last_reviewed_at: string | null;
  lapses: number;
  reps: number;
}

export function emptyReviewState(now: Date = new Date()): ReviewState {
  return cardToState(createEmptyCard(now));
}

/** Grades an attempt answer. The simplified two-rating strategy (wrong
 *  => Again, right => Good) is intentional, finer ratings (Hard/Easy)
 *  would need timing or self-report that we don't collect. */
export function nextReviewState(
  current: ReviewState | null,
  isCorrect: boolean,
  now: Date = new Date(),
): ReviewState {
  const card = current ? stateToCard(current) : createEmptyCard(now);
  const rating = isCorrect ? Rating.Good : Rating.Again;
  const { card: next } = scheduler.next(card, now, rating);
  return cardToState(next);
}

function cardToState(c: Card): ReviewState {
  return {
    stability: c.stability,
    difficulty: c.difficulty,
    state: c.state as number,
    due_at: c.due.toISOString(),
    last_reviewed_at: c.last_review ? c.last_review.toISOString() : null,
    lapses: c.lapses,
    reps: c.reps,
  };
}

function stateToCard(s: ReviewState): Card {
  return {
    due: new Date(s.due_at),
    stability: s.stability,
    difficulty: s.difficulty,
    // elapsed_days and scheduled_days are recomputed by FSRS when next()
    // runs; seed with 0 so we don't mislead the scheduler on the first
    // rehydration after row-insert.
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_reviewed_at ? new Date(s.last_reviewed_at) : undefined,
  };
}
