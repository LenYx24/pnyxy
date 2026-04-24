import { describe, expect, it } from "vitest";
import { newCard, reviewCard } from "./vocab-scheduler";

describe("vocab-scheduler", () => {
  it("creates a card whose first review is due immediately", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const card = newCard(now);
    expect(card.due.getTime()).toBeLessThanOrEqual(now.getTime() + 1000);
    expect(card.reps).toBe(0);
  });

  it("'again' schedules the card for a short retry (< 1 day)", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const card = newCard(now);
    const { dueAt } = reviewCard(card, "again", now);
    const deltaMs = dueAt.getTime() - now.getTime();
    // "Again" should land in the learning-steps window, well under a day.
    expect(deltaMs).toBeGreaterThan(0);
    expect(deltaMs).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("'good' on a brand new card schedules further out than 'again'", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const again = reviewCard(newCard(now), "again", now);
    const good = reviewCard(newCard(now), "good", now);
    expect(good.dueAt.getTime()).toBeGreaterThan(again.dueAt.getTime());
  });

  it("'easy' schedules furthest out of the four ratings", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const results = (["again", "hard", "good", "easy"] as const).map(
      (r) => reviewCard(newCard(now), r, now).dueAt.getTime(),
    );
    expect(results[3]).toBeGreaterThanOrEqual(results[2]);
    expect(results[2]).toBeGreaterThanOrEqual(results[1]);
    expect(results[1]).toBeGreaterThanOrEqual(results[0]);
  });

  it("bumps rep count after each review", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const card0 = newCard(now);
    const { card: card1 } = reviewCard(card0, "good", now);
    expect(card1.reps).toBe(card0.reps + 1);
  });
});
