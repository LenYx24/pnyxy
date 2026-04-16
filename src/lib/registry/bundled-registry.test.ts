import { describe, expect, it } from "vitest";
import { BundledFallbackRegistry } from "./bundled-registry";

describe("BundledFallbackRegistry", () => {
  const reg = new BundledFallbackRegistry();

  it("identifies itself with the 'bundled' label", () => {
    expect(reg.label).toBe("bundled");
  });

  it("lists at least one bundled theme as a 'theme' entry", async () => {
    const themes = await reg.listThemes();
    expect(themes.length).toBeGreaterThan(0);
    for (const t of themes) {
      expect(t.kind).toBe("theme");
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
    }
  });

  it("lists at least one bundled plugin as a 'plugin' entry", async () => {
    const plugins = await reg.listPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    for (const p of plugins) {
      expect(p.kind).toBe("plugin");
      expect(typeof p.id).toBe("string");
      expect(typeof p.version).toBe("string");
    }
  });

  it("returns the full theme manifest for a known id", async () => {
    const [first] = await reg.listThemes();
    const theme = await reg.fetchThemeManifest(first.id);
    expect(theme.id).toBe(first.id);
    expect(theme.apiVersion).toBe(1);
    expect(typeof theme.tokens).toBe("object");
    // At least the bg-primary token is present in the bundled theme.
    expect(theme.tokens["--color-bg-primary"]).toBeDefined();
  });

  it("returns the full plugin manifest for a known id", async () => {
    const [first] = await reg.listPlugins();
    const manifest = await reg.fetchPluginManifest(first.id);
    expect(manifest.id).toBe(first.id);
    expect(manifest.apiVersion).toBe(1);
    expect(Array.isArray(manifest.permissions)).toBe(true);
  });

  it("returns the bundled plugin source as a non-empty string", async () => {
    const [first] = await reg.listPlugins();
    const bundle = await reg.fetchPluginBundle(first.id);
    expect(typeof bundle).toBe("string");
    expect(bundle.length).toBeGreaterThan(0);
  });

  it("throws on unknown theme id", async () => {
    await expect(reg.fetchThemeManifest("nope")).rejects.toThrow(/unknown theme/);
  });

  it("throws on unknown plugin id", async () => {
    await expect(reg.fetchPluginManifest("nope")).rejects.toThrow(
      /unknown plugin/,
    );
    await expect(reg.fetchPluginBundle("nope")).rejects.toThrow(
      /unknown plugin/,
    );
  });
});
