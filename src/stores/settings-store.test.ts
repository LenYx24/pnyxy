/**
 * Tests for the persisted settings store, focused on the `migrate`
 * function. Each test seeds `localStorage` with a versioned blob, then
 * dynamically imports the store so that zustand's `persist` middleware
 * runs the migration during rehydration.
 *
 * `@/lib/supabase` is mocked because it throws at import time when env
 * vars are missing.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const PERSIST_KEY = "pnyxy-reader:settings";

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

function seedPersistedState(version: number, state: Record<string, unknown>) {
  localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({ state, version }),
  );
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("settings-store migrate — v0 → v1", () => {
  it("converts legacy `aiProvider: 'anthropic'` into `enabledProviders: ['anthropic']`", async () => {
    seedPersistedState(0, { aiProvider: "anthropic" });

    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.enabledProviders).toEqual(["anthropic"]);
    expect(
      (state as unknown as Record<string, unknown>).aiProvider,
    ).toBeUndefined();
  });

  it("ignores invalid legacy `aiProvider` values", async () => {
    seedPersistedState(0, { aiProvider: "garbage" });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();
    // Default initial value is preserved when legacy data is invalid.
    expect(state.enabledProviders).toEqual(["pnyxy"]);
  });

  it("does not overwrite an existing enabledProviders array", async () => {
    seedPersistedState(0, {
      aiProvider: "anthropic",
      enabledProviders: ["openai", "pnyxy"],
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();
    expect(state.enabledProviders).toEqual(["openai", "pnyxy"]);
  });
});

describe("settings-store migrate — v1 → v2", () => {
  it("seeds tracker settings with defaults when missing", async () => {
    seedPersistedState(1, { enabledProviders: ["pnyxy"] });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.activeTrackerId).toBe("toggle");
    expect(state.trackerSettings).toBeTypeOf("object");
    expect(state.trackerSettings).toHaveProperty("toggle");
  });

  it("preserves user overrides on top of tracker defaults", async () => {
    seedPersistedState(1, {
      enabledProviders: ["pnyxy"],
      trackerSettings: { toggle: { customField: 42 } },
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(
      (state.trackerSettings.toggle as Record<string, unknown>).customField,
    ).toBe(42);
  });
});

describe("settings-store migrate — v2 → v3", () => {
  it("seeds activeThemeId, installedThemes, plugin maps when missing", async () => {
    seedPersistedState(2, {
      enabledProviders: ["pnyxy"],
      activeTrackerId: "toggle",
      trackerSettings: { toggle: {} },
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.activeThemeId).toBe("pnyxy-dark");
    // installedThemes holds only community themes; defaults to empty.
    expect(state.installedThemes).toEqual({});
    expect(state.enabledPlugins).toBeTypeOf("object");
    // Every core plugin has a key in enabledPlugins after the seed.
    expect(state.enabledPlugins).toHaveProperty("reading-stats");
    expect(state.enabledPlugins).toHaveProperty("keyboard-cheatsheet");
    expect(state.installedPlugins).toEqual({});
    expect(state.pluginStorage).toEqual({});
    expect(state.pluginSettings).toBeTypeOf("object");
  });

  it("preserves an existing activeThemeId", async () => {
    seedPersistedState(2, {
      activeThemeId: "midnight",
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();
    expect(state.activeThemeId).toBe("midnight");
  });

  it("merges per-plugin enabled flags so user choices survive", async () => {
    seedPersistedState(2, {
      enabledPlugins: { "reading-stats": true },
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();
    expect(state.enabledPlugins["reading-stats"]).toBe(true);
    expect(state.enabledPlugins["keyboard-cheatsheet"]).toBe(false);
  });

  it("merges per-plugin user settings on top of plugin defaults", async () => {
    seedPersistedState(2, {
      pluginSettings: { "reading-stats": { x: 1 } },
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();
    expect(state.pluginSettings["reading-stats"]).toEqual({ x: 1 });
    expect(state.pluginSettings).toHaveProperty("keyboard-cheatsheet");
  });
});

describe("settings-store migrate — v3 → v4", () => {
  it("seeds experimental multi-format flags to false when missing", async () => {
    seedPersistedState(3, {
      activeThemeId: "pnyxy-dark",
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.experimental_allowAnnotationsForAllFormats).toBe(false);
    expect(state.experimental_allowWhiteboardForAllFormats).toBe(false);
  });

  it("preserves pre-existing experimental flags on rehydration", async () => {
    seedPersistedState(3, {
      experimental_allowAnnotationsForAllFormats: true,
      experimental_allowWhiteboardForAllFormats: true,
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.experimental_allowAnnotationsForAllFormats).toBe(true);
    expect(state.experimental_allowWhiteboardForAllFormats).toBe(true);
  });

  it("coerces non-boolean persisted values back to false", async () => {
    seedPersistedState(3, {
      experimental_allowAnnotationsForAllFormats: "yes",
      experimental_allowWhiteboardForAllFormats: 1,
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.experimental_allowAnnotationsForAllFormats).toBe(false);
    expect(state.experimental_allowWhiteboardForAllFormats).toBe(false);
  });
});

describe("settings-store migrate — v4 → v5", () => {
  it("seeds epubFlow to 'scrolled' when missing", async () => {
    seedPersistedState(4, {
      activeThemeId: "pnyxy-dark",
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFlow).toBe("scrolled");
  });

  it("preserves a previously persisted 'paginated' choice", async () => {
    seedPersistedState(4, {
      epubFlow: "paginated",
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFlow).toBe("paginated");
  });

  it("coerces an unknown persisted value back to 'scrolled'", async () => {
    seedPersistedState(4, {
      epubFlow: "garbage",
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFlow).toBe("scrolled");
  });
});

describe("settings-store migrate — v5 → v6", () => {
  it("seeds typography defaults when missing", async () => {
    seedPersistedState(5, {
      epubFlow: "paginated",
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFontScale).toBe(1.0);
    expect(state.epubLineHeight).toBe(1.5);
  });

  it("preserves valid persisted typography values", async () => {
    seedPersistedState(5, {
      epubFontScale: 1.25,
      epubLineHeight: 1.8,
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFontScale).toBe(1.25);
    expect(state.epubLineHeight).toBe(1.8);
  });

  it("clamps out-of-range typography values back to defaults", async () => {
    seedPersistedState(5, {
      epubFontScale: 4,
      epubLineHeight: -1,
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFontScale).toBe(1.0);
    expect(state.epubLineHeight).toBe(1.5);
  });

  it("coerces non-numeric typography values back to defaults", async () => {
    seedPersistedState(5, {
      epubFontScale: "huge",
      epubLineHeight: null,
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.epubFontScale).toBe(1.0);
    expect(state.epubLineHeight).toBe(1.5);
  });
});

describe("settings-store migrate — full chain", () => {
  it("walks v0 all the way to v6 in a single rehydration pass", async () => {
    seedPersistedState(0, {
      aiProvider: "openai",
      // No tracker fields, no theme fields, no plugin fields.
    });
    const { useSettingsStore } = await import("./settings-store");
    const state = useSettingsStore.getState();

    expect(state.enabledProviders).toEqual(["openai"]);
    expect(state.activeTrackerId).toBe("toggle");
    expect(state.activeThemeId).toBe("pnyxy-dark");
    expect(state.installedThemes).toBeTypeOf("object");
    expect(state.installedPlugins).toEqual({});
    expect(state.experimental_allowAnnotationsForAllFormats).toBe(false);
    expect(state.experimental_allowWhiteboardForAllFormats).toBe(false);
    expect(state.epubFlow).toBe("scrolled");
    expect(state.epubFontScale).toBe(1.0);
    expect(state.epubLineHeight).toBe(1.5);
  });
});
