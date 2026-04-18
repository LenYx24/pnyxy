/**
 * PluginManager lifecycle tests. Mocks the SandboxedRuntime so we
 * never instantiate a real iframe; the DirectRuntime runs as-is.
 *
 * Drives the real settings store (which itself is exercised in
 * `settings-store.test.ts`) so we exercise the same Zustand wiring
 * the app uses.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PluginAPI, PluginManifest } from "./types";
import type { PluginHandle, PluginRuntime } from "./runtime/types";

// Skip the supabase/auth side imports — the manager doesn't touch them
// directly, but the settings store does via syncPreferences.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: {
    getState: () => ({ user: null, profile: null }),
  },
}));

// Replace the SandboxedRuntime with an in-memory one that records
// which plugins it was asked to load / destroy.
const sandboxedLoaded = new Map<string, PluginHandle>();
const sandboxedDestroyed: string[] = [];

class FakeSandboxedRuntime implements PluginRuntime {
  readonly kind = "sandboxed" as const;
  async load(opts: {
    manifest: PluginManifest;
    bundle: string | null;
    api: PluginAPI;
  }): Promise<PluginHandle> {
    const { manifest } = opts;
    const handle: PluginHandle = {
      manifest,
      async destroy() {
        sandboxedDestroyed.push(manifest.id);
      },
      deliverEvent: vi.fn(),
      async invokeCommand() {},
    };
    sandboxedLoaded.set(manifest.id, handle);
    return handle;
  }
}

vi.mock("./runtime/sandboxed", () => ({
  SandboxedRuntime: FakeSandboxedRuntime,
}));

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sandboxedLoaded.clear();
  sandboxedDestroyed.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CORE_ID = "reading-stats";

async function loadModules() {
  const { PluginManager } = await import("./manager");
  const { useSettingsStore } = await import("@/stores/settings-store");
  return { PluginManager, useSettingsStore };
}

describe("PluginManager — core plugin lifecycle", () => {
  it("loads a core plugin when it gets enabled", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    useSettingsStore.getState().setPluginEnabled(CORE_ID, true);
    await mgr.reconcile();

    const status = mgr.getStatuses().get(CORE_ID);
    expect(status?.state).toBe("loaded");
    expect(mgr.getHandle(CORE_ID)).toBeDefined();
  });

  it("unloads a core plugin when it gets disabled", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    useSettingsStore.getState().setPluginEnabled(CORE_ID, true);
    await mgr.reconcile();
    expect(mgr.getStatuses().get(CORE_ID)?.state).toBe("loaded");

    useSettingsStore.getState().setPluginEnabled(CORE_ID, false);
    await mgr.reconcile();

    expect(mgr.getStatuses().get(CORE_ID)?.state).toBe("unloaded");
    expect(mgr.getHandle(CORE_ID)).toBeUndefined();
  });

  it("setEnabled flips the store flag and reconciles in one call", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    await mgr.setEnabled(CORE_ID, true);
    expect(useSettingsStore.getState().enabledPlugins[CORE_ID]).toBe(true);
    expect(mgr.getStatuses().get(CORE_ID)?.state).toBe("loaded");

    await mgr.setEnabled(CORE_ID, false);
    expect(useSettingsStore.getState().enabledPlugins[CORE_ID]).toBe(false);
    expect(mgr.getStatuses().get(CORE_ID)?.state).toBe("unloaded");
  });
});

describe("PluginManager — community plugin error path", () => {
  it("marks an enabled-but-not-installed community plugin as 'error'", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    // Manually mark a non-existent plugin as enabled without installing it.
    useSettingsStore.setState({
      enabledPlugins: { "ghost-plugin": true },
    });
    await mgr.reconcile();

    const status = mgr.getStatuses().get("ghost-plugin");
    expect(status?.state).toBe("error");
    expect(status?.error).toMatch(/not installed/);
  });

  it("loads an installed community plugin via the sandboxed runtime", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    const manifest: PluginManifest = {
      id: "community-x",
      name: "Community X",
      version: "1.0.0",
      apiVersion: 1,
      author: "x",
      description: "x",
      entry: "",
      permissions: [],
    };
    useSettingsStore.getState().installPlugin(manifest, "// bundle");
    await mgr.reconcile();

    expect(sandboxedLoaded.has("community-x")).toBe(true);
    expect(mgr.getStatuses().get("community-x")?.state).toBe("loaded");
  });

  it("rejects a manifest with an unsupported apiVersion", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    const manifest = {
      id: "future-plugin",
      name: "Future",
      version: "1.0.0",
      apiVersion: 99 as unknown as 1,
      author: "x",
      description: "x",
      entry: "",
      permissions: [],
    } satisfies PluginManifest;
    useSettingsStore.getState().installPlugin(manifest, "// bundle");
    await mgr.reconcile();

    const status = mgr.getStatuses().get("future-plugin");
    expect(status?.state).toBe("error");
    expect(status?.error).toMatch(/API v99/);
  });
});

describe("PluginManager — status listeners", () => {
  it("emits the current statuses on subscribe and on every change", async () => {
    const { PluginManager, useSettingsStore } = await loadModules();
    const mgr = new PluginManager();

    const listener = vi.fn();
    const unsubscribe = mgr.onStatusChange(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    useSettingsStore.getState().setPluginEnabled(CORE_ID, true);
    await mgr.reconcile();
    // At least one extra emit (loaded).
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
    listener.mockClear();
    useSettingsStore.getState().setPluginEnabled(CORE_ID, false);
    await mgr.reconcile();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("PluginManager — command registry", () => {
  it("dispatches an executed command back to the loaded plugin handle", async () => {
    const { PluginManager } = await loadModules();
    const mgr = new PluginManager();

    await mgr.setEnabled(CORE_ID, true);
    // reading-stats registered its command in onLoad.
    const cmds = mgr.listCommands();
    const cmd = cmds.find((c) => c.commandId === "reading-stats:show");
    expect(cmd).toBeDefined();
    expect(cmd?.pluginId).toBe(CORE_ID);

    await expect(mgr.executeCommand("reading-stats:show")).resolves.toBeUndefined();
  });

  it("throws when executing an unknown command", async () => {
    const { PluginManager } = await loadModules();
    const mgr = new PluginManager();
    await expect(mgr.executeCommand("nope:nope")).rejects.toThrow(
      /Unknown command/,
    );
  });
});
