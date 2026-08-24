import { describe, it, expect } from "vitest";
import {
  parseCorrectIndices,
  serializeIndices,
  matchesShortAnswer,
  gradeAnswer,
} from "./quiz";

describe("parseCorrectIndices", () => {
  it("parses a sorted comma list", () => {
    expect(parseCorrectIndices("0,2,3")).toEqual([0, 2, 3]);
  });
  it("sorts, dedupes, and trims whitespace", () => {
    expect(parseCorrectIndices(" 3, 1 ,1, 0")).toEqual([0, 1, 3]);
  });
  it("drops out-of-range and non-numeric parts", () => {
    expect(parseCorrectIndices("0,4,-1,x,2")).toEqual([0, 2]);
  });
  it("returns [] for null/empty", () => {
    expect(parseCorrectIndices(null)).toEqual([]);
    expect(parseCorrectIndices("")).toEqual([]);
    expect(parseCorrectIndices(undefined)).toEqual([]);
  });
});

describe("serializeIndices", () => {
  it("produces a sorted, deduped, comma-joined string", () => {
    expect(serializeIndices([3, 1, 1, 0])).toBe("0,1,3");
  });
  it("ignores out-of-range values", () => {
    expect(serializeIndices([0, 9, 2])).toBe("0,2");
  });
  it("round-trips with parseCorrectIndices", () => {
    expect(parseCorrectIndices(serializeIndices([2, 0]))).toEqual([0, 2]);
  });
});

describe("matchesShortAnswer", () => {
  it("ignores case, accents, and surrounding punctuation", () => {
    expect(matchesShortAnswer("  Só! ", "so")).toBe(true);
    expect(matchesShortAnswer("Árvíztűrő", "arvizturo")).toBe(true);
  });
  it("still rejects genuinely different answers", () => {
    expect(matchesShortAnswer("cat", "dog")).toBe(false);
  });
});

describe("gradeAnswer", () => {
  it("grades mcq4 / true_false by selected_index", () => {
    const q = { kind: "mcq4" as const, correct_index: 2, correct_text: null };
    expect(gradeAnswer(q, { selected_index: 2 })).toBe(true);
    expect(gradeAnswer(q, { selected_index: 1 })).toBe(false);
    expect(gradeAnswer(q, { selected_index: null })).toBe(false);
  });

  it("grades short_answer leniently", () => {
    const q = {
      kind: "short_answer" as const,
      correct_index: null,
      correct_text: "Budapest",
    };
    expect(gradeAnswer(q, { selected_text: " budapest " })).toBe(true);
    expect(gradeAnswer(q, { selected_text: "Vienna" })).toBe(false);
  });

  describe("multi_select (all-or-nothing)", () => {
    const q = {
      kind: "multi_select" as const,
      correct_index: null,
      correct_text: "0,2,3",
    };
    it("accepts the exact set regardless of picked order", () => {
      expect(gradeAnswer(q, { selected_text: "3,0,2" })).toBe(true);
    });
    it("rejects a missing pick", () => {
      expect(gradeAnswer(q, { selected_text: "0,2" })).toBe(false);
    });
    it("rejects an extra pick", () => {
      expect(gradeAnswer(q, { selected_text: "0,1,2,3" })).toBe(false);
    });
    it("rejects an empty answer", () => {
      expect(gradeAnswer(q, { selected_text: "" })).toBe(false);
      expect(gradeAnswer(q, { selected_text: null })).toBe(false);
    });
    it("is false when no correct set is stored", () => {
      const empty = { ...q, correct_text: "" };
      expect(gradeAnswer(empty, { selected_text: "0" })).toBe(false);
    });
  });
});
