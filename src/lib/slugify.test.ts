import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and dasherizes", () => {
    expect(slugify("Linear Algebra Done Right")).toBe(
      "linear-algebra-done-right",
    );
  });

  it("strips Hungarian diacritics", () => {
    expect(slugify("Vörös és fekete")).toBe("voros-es-fekete");
    expect(slugify("Egri csillagok")).toBe("egri-csillagok");
    expect(slugify("Tóth Árpád összes versei")).toBe(
      "toth-arpad-osszes-versei",
    );
  });

  it("collapses runs of non-alphanumerics to a single dash", () => {
    expect(slugify("Hello,   world!!!")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  -- hello -- ")).toBe("hello");
  });

  it("caps length and re-trims if the cut lands mid-dash run", () => {
    const long = "a".repeat(70) + " b";
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("-")).toBe(false);
  });

  it("returns the fallback for empty / non-Latin input", () => {
    expect(slugify("")).toBe("book");
    expect(slugify("    ")).toBe("book");
    expect(slugify("こんにちは")).toBe("book");
    expect(slugify("Привет")).toBe("book");
  });

  it("preserves digits", () => {
    expect(slugify("Chapter 12: The End")).toBe("chapter-12-the-end");
  });
});
