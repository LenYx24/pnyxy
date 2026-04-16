/**
 * Tests for the zero-dep profanity filter. Scope is deliberately narrow:
 * we only verify the matcher handles the known tricks (leet speak,
 * embedded punctuation, mixed case) and that clean/contains agree.
 */
import { describe, expect, it } from "vitest";
import { cleanUserText, containsProfanity } from "./profanity-filter";

describe("containsProfanity", () => {
  it("returns false for empty / null / undefined", () => {
    expect(containsProfanity("")).toBe(false);
    expect(containsProfanity(null)).toBe(false);
    expect(containsProfanity(undefined)).toBe(false);
  });

  it("returns false for clean text", () => {
    expect(containsProfanity("Jane Doe")).toBe(false);
    expect(containsProfanity("A thoughtful review of a great book.")).toBe(
      false,
    );
  });

  it("detects obvious profanity regardless of case", () => {
    expect(containsProfanity("Fuck off")).toBe(true);
    expect(containsProfanity("SHIT happens")).toBe(true);
    expect(containsProfanity("what an asshole")).toBe(true);
  });

  it("detects leet-speak substitutions", () => {
    expect(containsProfanity("sh1t")).toBe(true);
    expect(containsProfanity("sh!t")).toBe(true);
    expect(containsProfanity("f*ck")).toBe(false); // asterisk is dropped, "fck" ≠ "fuck"
    expect(containsProfanity("a$$hole")).toBe(true);
    expect(containsProfanity("b1tch")).toBe(true);
  });

  it("detects words with interleaved punctuation/spaces", () => {
    expect(containsProfanity("s.h.i.t")).toBe(true);
    expect(containsProfanity("f u c k")).toBe(true);
  });

  it("detects words embedded in longer strings", () => {
    expect(containsProfanity("mothershitter")).toBe(true);
    expect(containsProfanity("UltraAssholeBook")).toBe(true);
  });
});

describe("cleanUserText", () => {
  it("passes clean text through unchanged", () => {
    expect(cleanUserText("Hello world")).toBe("Hello world");
    expect(cleanUserText("")).toBe("");
  });

  it("masks matched letters with asterisks", () => {
    expect(cleanUserText("fuck this")).toBe("**** this");
    expect(cleanUserText("FUCK this")).toBe("**** this");
  });

  it("preserves non-letter characters surrounding the match", () => {
    // punctuation characters between letters are also dropped during
    // normalization, so they get masked too — acceptable trade-off.
    expect(cleanUserText("s.h.i.t.")).toBe("*.*.*.*.");
  });

  it("masks multiple occurrences", () => {
    expect(cleanUserText("shit and shit")).toBe("**** and ****");
  });

  it("is a no-op for null/undefined", () => {
    expect(cleanUserText(null)).toBe("");
    expect(cleanUserText(undefined)).toBe("");
  });
});
