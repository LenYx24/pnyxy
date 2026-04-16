import { describe, expect, it } from "vitest";
import { buildSearchRegex, runTextSearch } from "./text-search";
import type { SearchOptions } from "@/types/document";

const DEFAULT: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

describe("buildSearchRegex", () => {
  it("returns null for an empty query", () => {
    expect(buildSearchRegex("", DEFAULT)).toBeNull();
  });

  it("escapes regex metacharacters when regex mode is off", () => {
    const regex = buildSearchRegex("a.b*", DEFAULT);
    expect(regex).not.toBeNull();
    // `a.b*` should match literally (the dot is not wildcard).
    expect("a.b*c".match(regex!)).not.toBeNull();
    expect("axbc".match(regex!)).toBeNull();
  });

  it("keeps the pattern literal when regex mode is on", () => {
    const regex = buildSearchRegex("a.b", { ...DEFAULT, regex: true });
    expect(regex).not.toBeNull();
    expect("axb".match(regex!)).not.toBeNull();
  });

  it("returns null for an invalid user-provided regex", () => {
    expect(
      buildSearchRegex("[invalid(", { ...DEFAULT, regex: true }),
    ).toBeNull();
  });

  it("is case-insensitive by default", () => {
    const regex = buildSearchRegex("hello", DEFAULT);
    expect("HELLO world".match(regex!)).not.toBeNull();
  });

  it("honors caseSensitive", () => {
    const regex = buildSearchRegex("hello", {
      ...DEFAULT,
      caseSensitive: true,
    });
    expect("HELLO world".match(regex!)).toBeNull();
    expect("hello world".match(regex!)).not.toBeNull();
  });

  it("wraps the pattern in word boundaries when wholeWord is on", () => {
    const regex = buildSearchRegex("cat", { ...DEFAULT, wholeWord: true });
    expect("cat in the hat".match(regex!)).not.toBeNull();
    expect("concatenate".match(regex!)).toBeNull();
  });

  it("always produces a global regex", () => {
    const regex = buildSearchRegex("a", DEFAULT);
    expect(regex?.flags).toContain("g");
  });
});

describe("runTextSearch", () => {
  it("returns an empty array for an empty query", () => {
    expect(runTextSearch("hello world", "", DEFAULT)).toEqual([]);
  });

  it("finds every occurrence with a sourceOffset and unique id", () => {
    const matches = runTextSearch("the quick brown the", "the", DEFAULT);
    expect(matches).toHaveLength(2);
    expect(matches[0].sourceOffset).toBe(0);
    expect(matches[1].sourceOffset).toBe(16);
    expect(matches[0].id).not.toBe(matches[1].id);
  });

  it("builds a snippet with ellipsis markers only when truncated", () => {
    const text = "short text";
    const [m] = runTextSearch(text, "short", DEFAULT);
    expect(m.snippet).toBe("short text");
    expect(m.snippetMatchStart).toBe(0);
    expect(m.snippetMatchEnd).toBe(5);
  });

  it("truncates long snippets on both sides", () => {
    const filler = "x".repeat(200);
    const text = `${filler} needle ${filler}`;
    const [m] = runTextSearch(text, "needle", DEFAULT);
    expect(m.snippet.startsWith("…")).toBe(true);
    expect(m.snippet.endsWith("…")).toBe(true);
    expect(m.snippet.slice(m.snippetMatchStart, m.snippetMatchEnd)).toBe(
      "needle",
    );
  });

  it("respects caseSensitive when scanning", () => {
    const matches = runTextSearch("Cat cat CAT", "cat", {
      ...DEFAULT,
      caseSensitive: true,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].sourceOffset).toBe(4);
  });

  it("respects wholeWord when scanning", () => {
    const matches = runTextSearch("cat concatenate cat", "cat", {
      ...DEFAULT,
      wholeWord: true,
    });
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.sourceOffset)).toEqual([0, 16]);
  });

  it("skips zero-width matches to avoid infinite loops", () => {
    // An empty alternation `|x` can match at every position; the helper
    // should silently drop the zero-width hits.
    const matches = runTextSearch("abc", "|x", { ...DEFAULT, regex: true });
    expect(matches).toHaveLength(0);
  });

  it("returns an empty array for an invalid regex", () => {
    expect(runTextSearch("abc", "[invalid(", { ...DEFAULT, regex: true })).toEqual(
      [],
    );
  });
});
