import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, resetTheme } from "./apply";
import type { Theme } from "./types";

const SAMPLE_DARK: Theme = {
  id: "sample-dark",
  name: "Sample Dark",
  apiVersion: 1,
  variant: "dark",
  tokens: {
    "--color-bg-primary": "#000",
    "--color-bg-secondary": "#111",
    "--color-text-primary": "#fff",
  },
};

const SAMPLE_LIGHT: Theme = {
  id: "sample-light",
  name: "Sample Light",
  apiVersion: 1,
  variant: "light",
  tokens: {
    "--color-bg-primary": "#fff",
    "--color-text-primary": "#000",
  },
};

const NO_VARIANT: Theme = {
  id: "no-variant",
  name: "No Variant",
  apiVersion: 1,
  tokens: {
    "--color-bg-primary": "#abcdef",
  },
};

afterEach(() => {
  resetTheme();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeVariant;
});

describe("applyTheme", () => {
  it("writes every token from theme.tokens onto document.documentElement", () => {
    applyTheme(SAMPLE_DARK);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-bg-primary")).toBe("#000");
    expect(root.style.getPropertyValue("--color-bg-secondary")).toBe("#111");
    expect(root.style.getPropertyValue("--color-text-primary")).toBe("#fff");
  });

  it("sets data-theme and data-theme-variant from the theme", () => {
    applyTheme(SAMPLE_DARK);
    expect(document.documentElement.dataset.theme).toBe("sample-dark");
    expect(document.documentElement.dataset.themeVariant).toBe("dark");
  });

  it("removes data-theme-variant when the theme has no variant", () => {
    applyTheme(SAMPLE_DARK);
    expect(document.documentElement.dataset.themeVariant).toBe("dark");
    applyTheme(NO_VARIANT);
    expect(document.documentElement.dataset.theme).toBe("no-variant");
    expect(document.documentElement.dataset.themeVariant).toBeUndefined();
  });

  it("clears tokens from the previous theme that the new theme doesn't override", () => {
    applyTheme(SAMPLE_DARK); // sets bg-primary, bg-secondary, text-primary
    applyTheme(SAMPLE_LIGHT); // only sets bg-primary, text-primary
    const root = document.documentElement;
    // Overridden by new theme:
    expect(root.style.getPropertyValue("--color-bg-primary")).toBe("#fff");
    expect(root.style.getPropertyValue("--color-text-primary")).toBe("#000");
    // Not in new theme, must be cleared, not stale:
    expect(root.style.getPropertyValue("--color-bg-secondary")).toBe("");
  });
});

describe("resetTheme", () => {
  it("removes every token a theme could have set", () => {
    applyTheme(SAMPLE_DARK);
    expect(
      document.documentElement.style.getPropertyValue("--color-bg-primary"),
    ).toBe("#000");
    resetTheme();
    expect(
      document.documentElement.style.getPropertyValue("--color-bg-primary"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--color-bg-secondary"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--color-text-primary"),
    ).toBe("");
  });
});
