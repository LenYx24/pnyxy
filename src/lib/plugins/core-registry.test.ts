import { describe, expect, it } from "vitest";
import {
  buildDefaultPluginSettings,
  CORE_PLUGINS,
  getPluginManifest,
} from "./core-registry";
import type { PluginManifest } from "./types";

describe("CORE_PLUGINS", () => {
  it("ships reading-stats and keyboard-cheatsheet", () => {
    expect(CORE_PLUGINS).toHaveProperty("reading-stats");
    expect(CORE_PLUGINS).toHaveProperty("keyboard-cheatsheet");
  });

  it("every entry pairs a manifest with a module", () => {
    for (const [id, entry] of Object.entries(CORE_PLUGINS)) {
      expect(entry.manifest.id).toBe(id);
      expect(entry.manifest.apiVersion).toBe(1);
      expect(typeof entry.module).toBe("object");
    }
  });
});

describe("buildDefaultPluginSettings", () => {
  it("returns an entry for every core plugin, defaulted by manifest.defaultEnabled", () => {
    const defaults = buildDefaultPluginSettings();
    for (const [id, entry] of Object.entries(CORE_PLUGINS)) {
      const expected = entry.manifest.defaultEnabled === true;
      expect(defaults.enabledPlugins).toHaveProperty(id);
      expect(defaults.enabledPlugins[id]).toBe(expected);
      expect(defaults.pluginSettings).toHaveProperty(id);
      expect(defaults.pluginSettings[id]).toEqual({});
    }
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = buildDefaultPluginSettings();
    const b = buildDefaultPluginSettings();
    expect(a).not.toBe(b);
    expect(a.enabledPlugins).not.toBe(b.enabledPlugins);
    const before = b.enabledPlugins["reading-stats"];
    a.enabledPlugins["reading-stats"] = !before;
    expect(b.enabledPlugins["reading-stats"]).toBe(before);
  });
});

describe("getPluginManifest", () => {
  const communityManifest: PluginManifest = {
    id: "community-demo",
    name: "Community Demo",
    version: "2.0.0",
    apiVersion: 1,
    author: "someone",
    description: "x",
    entry: "",
  };

  it("returns the core plugin's manifest when the id matches a core entry", () => {
    const m = getPluginManifest("reading-stats");
    expect(m?.id).toBe("reading-stats");
  });

  it("returns the installed community manifest when not a core id", () => {
    const m = getPluginManifest("community-demo", {
      "community-demo": { manifest: communityManifest },
    });
    expect(m).toBe(communityManifest);
  });

  it("prefers the core entry over an installed entry of the same id", () => {
    // Core wins: we don't let a community plugin shadow a core plugin.
    const shadow: PluginManifest = { ...communityManifest, id: "reading-stats" };
    const m = getPluginManifest("reading-stats", {
      "reading-stats": { manifest: shadow },
    });
    expect(m?.id).toBe("reading-stats");
    expect(m).not.toBe(shadow);
  });

  it("returns undefined for unknown ids", () => {
    expect(getPluginManifest("nope")).toBeUndefined();
    expect(getPluginManifest("nope", {})).toBeUndefined();
  });
});
