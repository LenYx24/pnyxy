import { describe, expect, it, vi } from "vitest";
import { CompositeRegistry } from "./composite-registry";
import type { Theme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";
import type {
  RegistryIndexEntry,
  RegistryProvider,
  RegistryStatus,
} from "./types";

const sampleTheme: Theme = {
  id: "demo",
  name: "Demo",
  apiVersion: 1,
  tokens: { "--color-bg-primary": "#fff" },
};

const sampleManifest: PluginManifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1,
  author: "x",
  description: "x",
  entry: "",
};

const sampleEntry: RegistryIndexEntry = {
  kind: "theme",
  id: "demo",
  name: "Demo",
  version: "1",
};

function makeProvider(
  label: string,
  overrides: Partial<RegistryProvider> = {},
): RegistryProvider {
  return {
    label,
    listPlugins: vi.fn().mockResolvedValue([sampleEntry]),
    listThemes: vi.fn().mockResolvedValue([sampleEntry]),
    fetchThemeManifest: vi.fn().mockResolvedValue(sampleTheme),
    fetchPluginManifest: vi.fn().mockResolvedValue(sampleManifest),
    fetchPluginBundle: vi.fn().mockResolvedValue("// bundle"),
    ...overrides,
  };
}

describe("CompositeRegistry", () => {
  it("uses the primary provider when it succeeds and reports online status", async () => {
    const primary = makeProvider("primary");
    const fallback = makeProvider("fallback");
    const composite = new CompositeRegistry(primary, fallback);

    const result = await composite.listThemes();
    expect(result).toEqual([sampleEntry]);
    expect(primary.listThemes).toHaveBeenCalledTimes(1);
    expect(fallback.listThemes).not.toHaveBeenCalled();
    expect(composite.getStatus()).toEqual({ offline: false });
  });

  it("falls back to the secondary on primary failure and flips status to offline", async () => {
    const primary = makeProvider("primary", {
      listThemes: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const fallback = makeProvider("fallback");
    const composite = new CompositeRegistry(primary, fallback);

    const result = await composite.listThemes();
    expect(result).toEqual([sampleEntry]);
    expect(fallback.listThemes).toHaveBeenCalledTimes(1);
    expect(composite.getStatus()).toEqual({
      offline: true,
      primaryError: "network down",
    });
  });

  it("recovers to online when the primary succeeds again", async () => {
    const primaryListThemes = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce([sampleEntry]);
    const primary = makeProvider("primary", { listThemes: primaryListThemes });
    const fallback = makeProvider("fallback");
    const composite = new CompositeRegistry(primary, fallback);

    await composite.listThemes(); // → offline
    expect(composite.getStatus().offline).toBe(true);

    await composite.listThemes(); // → online again
    expect(composite.getStatus()).toEqual({ offline: false });
  });

  it("notifies status listeners on changes (and emits the current status on subscribe)", async () => {
    const primary = makeProvider("primary", {
      listThemes: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const fallback = makeProvider("fallback");
    const composite = new CompositeRegistry(primary, fallback);

    const listener = vi.fn();
    const unsubscribe = composite.onStatusChange(listener);

    // First call delivers the initial status synchronously.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ offline: false });

    await composite.listThemes();
    expect(listener).toHaveBeenCalledTimes(2);
    const lastCall = listener.mock.calls[1][0] as RegistryStatus;
    expect(lastCall.offline).toBe(true);
    expect(lastCall.primaryError).toBe("offline");

    unsubscribe();
    listener.mockClear();
    // After unsubscribe, no further calls — but trigger a new status to be sure.
    await composite.listThemes();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not re-notify when the status didn't actually change", async () => {
    const primary = makeProvider("primary");
    const fallback = makeProvider("fallback");
    const composite = new CompositeRegistry(primary, fallback);

    const listener = vi.fn();
    composite.onStatusChange(listener);
    listener.mockClear();

    await composite.listThemes();
    await composite.listPlugins();
    // Both calls should keep status at { offline: false } — no extra emit.
    expect(listener).not.toHaveBeenCalled();
  });

  it("delegates each provider method through the same fallback path", async () => {
    const primary = makeProvider("primary", {
      fetchThemeManifest: vi.fn().mockRejectedValue(new Error("boom")),
      fetchPluginManifest: vi.fn().mockRejectedValue(new Error("boom")),
      fetchPluginBundle: vi.fn().mockRejectedValue(new Error("boom")),
      listPlugins: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const fallback = makeProvider("fallback");
    const composite = new CompositeRegistry(primary, fallback);

    await expect(composite.fetchThemeManifest("demo")).resolves.toBe(sampleTheme);
    await expect(composite.fetchPluginManifest("demo")).resolves.toBe(
      sampleManifest,
    );
    await expect(composite.fetchPluginBundle("demo", "1.0.0")).resolves.toBe(
      "// bundle",
    );
    await expect(composite.listPlugins()).resolves.toEqual([sampleEntry]);
    expect(fallback.fetchThemeManifest).toHaveBeenCalledWith("demo");
    expect(fallback.fetchPluginBundle).toHaveBeenCalledWith("demo", "1.0.0");
  });
});
