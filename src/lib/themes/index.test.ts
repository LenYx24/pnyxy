import { describe, expect, it } from "vitest";
import { CORE_THEMES, DEFAULT_THEME_ID, getTheme } from "./index";
import type { Theme } from "./types";

const installedTheme: Theme = {
  id: "community-x",
  name: "Community X",
  apiVersion: 1,
  tokens: {
    "--color-bg-primary": "#abcdef",
  },
};

describe("getTheme", () => {
  it("returns a core theme when the id matches one", () => {
    const t = getTheme("pnyxy-dark");
    expect(t).toBe(CORE_THEMES["pnyxy-dark"]);
  });

  it("falls back to an installed theme when the id is not core", () => {
    const t = getTheme("community-x", { "community-x": installedTheme });
    expect(t).toBe(installedTheme);
  });

  it("prefers the core theme over an installed entry of the same id", () => {
    const shadow: Theme = { ...installedTheme, id: "pnyxy-dark" };
    const t = getTheme("pnyxy-dark", { "pnyxy-dark": shadow });
    expect(t).toBe(CORE_THEMES["pnyxy-dark"]);
    expect(t).not.toBe(shadow);
  });

  it("falls back to the default theme when the id is unknown", () => {
    const t = getTheme("nope");
    expect(t).toBe(CORE_THEMES[DEFAULT_THEME_ID]);
  });

  it("uses the default theme even when an empty installed map is passed", () => {
    const t = getTheme("nope", {});
    expect(t).toBe(CORE_THEMES[DEFAULT_THEME_ID]);
  });
});

describe("DEFAULT_THEME_ID", () => {
  it("is a key of CORE_THEMES", () => {
    expect(CORE_THEMES).toHaveProperty(DEFAULT_THEME_ID);
  });
});
