import { describe, expect, it } from "vitest";
import {
  scoreCatalog,
  scoreLibrary,
  sharedTokens,
  tokenize,
  type CatalogRowForScoring,
  type LibraryRowForScoring,
} from "./roadmap-resource-lookup";
import type { ResourceRef } from "@/types/roadmap";

const makeRef = (
  patch: Partial<ResourceRef> = {},
): ResourceRef => ({
  kind: "book",
  title: "Introduction to Algorithms",
  ...patch,
});

const makeLibraryRow = (
  patch: Partial<LibraryRowForScoring> = {},
): LibraryRowForScoring => ({
  id: "lib-1",
  title: "Introduction to Algorithms",
  author: "Cormen",
  file_hash: "abc123",
  ...patch,
});

const makeCatalogRow = (
  patch: Partial<CatalogRowForScoring> = {},
): CatalogRowForScoring => ({
  id: "cat-1",
  title: "Introduction to Algorithms",
  authors: ["Cormen"],
  ...patch,
});

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric runs", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });

  it("drops English stop words", () => {
    // "the", "to", "and", "of" are in STOP_WORDS; "cat" is short
    // but length 3 passes the min-length filter.
    expect(tokenize("the cat and the dog")).toEqual(["cat", "dog"]);
  });

  it("drops tokens shorter than 3 chars", () => {
    expect(tokenize("a bb ccc dddd")).toEqual(["ccc", "dddd"]);
  });

  it("strips Hungarian diacritics so 'Bevezetés' matches 'Bevezetes'", () => {
    // Both should normalise to the same token list, so a Postgres
    // ILIKE that doesn't fold accents still has something to match.
    expect(tokenize("Bevezetés a számításelméletbe")).toEqual(
      tokenize("Bevezetes a szamitaselmeletbe"),
    );
  });

  it("dedupes within the returned set semantics (caller uses Set)", () => {
    // tokenize itself returns the raw array (may contain dupes if
    // the input did); the consumer's sharedTokens wraps in Set.
    // We pin this here as a contract that callers rely on.
    expect(tokenize("algorithm algorithm")).toEqual([
      "algorithm",
      "algorithm",
    ]);
  });

  it("handles empty strings", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("sharedTokens", () => {
  it("returns tokens common to both strings", () => {
    expect(sharedTokens("the quick brown fox", "brown fox jumps")).toEqual(
      new Set(["brown", "fox"]),
    );
  });

  it("returns an empty set when nothing overlaps", () => {
    expect(sharedTokens("cats", "dogs")).toEqual(new Set());
  });

  it("treats 'Bevezetes' and 'bevezetés' as the same after diacritic strip", () => {
    // Real-world case: AI cites Hungarian title, library row has
    // mixed-case + accents in the catalogue title.
    const result = sharedTokens(
      "Bevezetés a programozásba",
      "BEVEZETES A PROGRAMOZASBA",
    );
    expect(result.has("bevezetes")).toBe(true);
    expect(result.has("programozasba")).toBe(true);
  });

  it("ignores stop words and short tokens on both sides", () => {
    // "the" / "a" / "in" are stop words; "is" is short. The only
    // real-word overlap is "house".
    expect(sharedTokens("the house in", "a house is")).toEqual(
      new Set(["house"]),
    );
  });
});

describe("scoreLibrary", () => {
  it("returns 0 when the row has no title at all", () => {
    expect(scoreLibrary(makeRef(), makeLibraryRow({ title: null }))).toBe(0);
  });

  it("returns 0 when no title tokens overlap", () => {
    expect(
      scoreLibrary(
        makeRef({ title: "Compilers" }),
        makeLibraryRow({ title: "Cooking 101" }),
      ),
    ).toBe(0);
  });

  it("scores title-only overlap as 2 per shared token", () => {
    // "introduction" + "algorithms" both shared → 2 tokens × 2 = 4.
    // No author bonus because the ref has no author.
    expect(
      scoreLibrary(
        makeRef({ title: "Introduction to Algorithms", author: undefined }),
        makeLibraryRow({ author: null }),
      ),
    ).toBe(4);
  });

  it("adds an author bonus of 2 when authors share a token", () => {
    // Title: 2 hits × 2 = 4. Author "Cormen" shares with "Cormen" → +2.
    // Total 6, comfortably above MIN_SCORE.
    expect(
      scoreLibrary(
        makeRef({
          title: "Introduction to Algorithms",
          author: "Cormen",
        }),
        makeLibraryRow({
          title: "Introduction to Algorithms",
          author: "Cormen",
        }),
      ),
    ).toBe(6);
  });

  it("withholds the author bonus when authors don't share a token", () => {
    expect(
      scoreLibrary(
        makeRef({
          title: "Introduction to Algorithms",
          author: "Cormen",
        }),
        makeLibraryRow({
          title: "Introduction to Algorithms",
          author: "Knuth",
        }),
      ),
    ).toBe(4);
  });
});

describe("scoreCatalog", () => {
  it("returns 0 when the row has no title", () => {
    expect(scoreCatalog(makeRef(), makeCatalogRow({ title: null }))).toBe(0);
  });

  it("scores title-only when ref has no author", () => {
    expect(
      scoreCatalog(
        makeRef({ title: "Introduction to Algorithms", author: undefined }),
        makeCatalogRow({ authors: [] }),
      ),
    ).toBe(4);
  });

  it("scores title-only when row has no authors", () => {
    expect(
      scoreCatalog(
        makeRef({ title: "Introduction to Algorithms", author: "Cormen" }),
        makeCatalogRow({ authors: null }),
      ),
    ).toBe(4);
  });

  it("joins multiple authors when computing the bonus", () => {
    // Catalog books carry an array of authors; the bonus fires if
    // ANY of them shares a token with the ref's author.
    expect(
      scoreCatalog(
        makeRef({ author: "Rivest" }),
        makeCatalogRow({ authors: ["Cormen", "Leiserson", "Rivest", "Stein"] }),
      ),
    ).toBe(6);
  });
});
