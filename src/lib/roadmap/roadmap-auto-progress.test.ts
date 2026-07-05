import { describe, expect, it } from "vitest";
import {
  displayProgressPct,
  nodePctFromPage,
} from "./roadmap-auto-progress";

describe("nodePctFromPage", () => {
  const range = { from: 10, to: 20 };

  it("returns 0 for pages before the range start", () => {
    expect(nodePctFromPage(5, range)).toBe(0);
    expect(nodePctFromPage(9, range)).toBe(0);
    // Edge: exactly at `from` is still 0% (the user just opened the
    // first page of the range; hasn't actually read anything yet).
    expect(nodePctFromPage(10, range)).toBe(0);
  });

  it("returns 100 for pages at or past the range end", () => {
    expect(nodePctFromPage(20, range)).toBe(100);
    expect(nodePctFromPage(25, range)).toBe(100);
  });

  it("lerps linearly between from and to", () => {
    expect(nodePctFromPage(15, range)).toBe(50); // halfway
    expect(nodePctFromPage(12, range)).toBe(20); // 2 of 10 pages → 20%
    expect(nodePctFromPage(18, range)).toBe(80); // 8 of 10 pages → 80%
  });

  it("rounds the result to an integer", () => {
    // 13 of 10 pages = 1.3 → 30% (Math.round on 30 → 30, on 30.0001
    // → 30). The actual fraction here is (13-10)/(20-10) = 0.3 →
    // 30%. Exact.
    expect(nodePctFromPage(13, range)).toBe(30);
    // 14 of 10 = (14-10)/10 = 0.4 → 40%, also exact.
    expect(nodePctFromPage(14, range)).toBe(40);
  });

  it("handles single-page ranges defensively", () => {
    const single = { from: 5, to: 5 };
    // `to <= from` is the degenerate case: the implementation
    // collapses to "100 if page >= from, else 0".
    expect(nodePctFromPage(4, single)).toBe(0);
    expect(nodePctFromPage(5, single)).toBe(100);
    expect(nodePctFromPage(6, single)).toBe(100);
  });

  it("handles inverted ranges by treating them like single-pages", () => {
    // If the AI returns from > to (malformed), don't NaN out, the
    // current implementation falls through the `to <= from` branch.
    const inverted = { from: 20, to: 10 };
    expect(nodePctFromPage(5, inverted)).toBe(0);
    expect(nodePctFromPage(25, inverted)).toBe(100);
  });
});

describe("displayProgressPct", () => {
  it("picks the higher of manual vs auto", () => {
    expect(displayProgressPct(0, 0)).toBe(0);
    expect(displayProgressPct(50, 30)).toBe(50);
    expect(displayProgressPct(30, 50)).toBe(50);
    expect(displayProgressPct(100, 0)).toBe(100);
    expect(displayProgressPct(0, 100)).toBe(100);
  });

  it("returns the equal value when both are equal", () => {
    expect(displayProgressPct(50, 50)).toBe(50);
  });
});
