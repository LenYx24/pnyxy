import { afterEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  isAllowedThemeTokenKey,
  isSafeThemeTokenValue,
  resetTheme,
  sanitizeThemeTokens,
} from "./apply";
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

describe("token allowlist", () => {
  it("isAllowedThemeTokenKey accepts every known token", () => {
    expect(isAllowedThemeTokenKey("--color-bg-primary")).toBe(true);
    expect(isAllowedThemeTokenKey("--color-accent")).toBe(true);
    expect(isAllowedThemeTokenKey("--font-sans")).toBe(true);
  });

  it("isAllowedThemeTokenKey rejects unknown or non-custom-property keys", () => {
    expect(isAllowedThemeTokenKey("--not-a-real-token")).toBe(false);
    expect(isAllowedThemeTokenKey("color")).toBe(false);
    expect(isAllowedThemeTokenKey("background")).toBe(false);
  });

  it("isSafeThemeTokenValue rejects values that could smuggle a resource load or import", () => {
    expect(isSafeThemeTokenValue("url(javascript:alert(1))")).toBe(false);
    expect(isSafeThemeTokenValue("URL(https://evil.example/x.png)")).toBe(false);
    expect(isSafeThemeTokenValue("image-set(url(evil.png) 1x)")).toBe(false);
    expect(isSafeThemeTokenValue("@import url(evil.css)")).toBe(false);
    expect(isSafeThemeTokenValue("expression(alert(1))")).toBe(false);
    expect(isSafeThemeTokenValue("a\\65 vil")).toBe(false);
    expect(isSafeThemeTokenValue("<style>")).toBe(false);
  });

  it("isSafeThemeTokenValue accepts ordinary color and shadow values", () => {
    expect(isSafeThemeTokenValue("#5fb3c6")).toBe(true);
    expect(isSafeThemeTokenValue("rgba(255, 255, 255, 0.04)")).toBe(true);
    expect(isSafeThemeTokenValue("0 8px 30px rgba(0, 0, 0, 0.45)")).toBe(true);
    expect(
      isSafeThemeTokenValue("color-mix(in srgb, #222226 88%, #ececee)"),
    ).toBe(true);
  });

  it("sanitizeThemeTokens drops unknown keys and unsafe values, keeps the rest", () => {
    const sanitized = sanitizeThemeTokens({
      "--color-bg-primary": "#000",
      // @ts-expect-error deliberately not a real token key
      "--evil-injected": "#fff",
      "--color-accent": "url(javascript:alert(1))",
    });
    expect(sanitized).toEqual({ "--color-bg-primary": "#000" });
  });

  it("applyTheme never sets an unallowlisted key or an unsafe value on the DOM", () => {
    const MALICIOUS: Theme = {
      id: "malicious",
      name: "Malicious",
      apiVersion: 1,
      tokens: {
        "--color-bg-primary": "url(https://evil.example/exfiltrate.png)",
        "--color-text-primary": "#fff",
        // @ts-expect-error deliberately not a real token key
        "--not-a-token": "#000",
      },
    };
    applyTheme(MALICIOUS);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-bg-primary")).toBe("");
    expect(root.style.getPropertyValue("--color-text-primary")).toBe("#fff");
    expect(root.style.getPropertyValue("--not-a-token")).toBe("");
  });
});
