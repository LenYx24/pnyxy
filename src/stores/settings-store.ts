import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BookStatusTag } from "@/types/database";
import type { ColorKey } from "@/lib/tag-colors";
import {
  DEFAULT_TRACKER_ID,
  buildDefaultTrackerSettings,
} from "@/lib/reading-trackers";
import {
  DEFAULT_THEME_ID,
  buildInstalledThemesDefaults,
  type Theme,
} from "@/lib/themes";
import { buildDefaultPluginSettings } from "@/lib/plugins/core-registry";
import type { PluginManifest } from "@/lib/plugins/types";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";

export type FitMode = "fit-width" | "fit-page";
export type EpubFlow = "scrolled" | "paginated";
export type AiProvider = "pnyxy" | "anthropic" | "openai";

export const ALL_AI_PROVIDERS: readonly AiProvider[] = [
  "pnyxy",
  "anthropic",
  "openai",
] as const;

export interface InstalledPluginPackage {
  manifest: PluginManifest;
  /** Plain JS source. Stored locally for offline use; NEVER synced to Supabase. */
  bundle: string;
}

interface SettingsState {
  pageScrollBehavior: "smooth" | "instant";
  scrollAnimationDuration: number;
  defaultFitMode: FitMode;
  epubFlow: EpubFlow;
  /**
   * Multiplier applied to the EPUB body font size. 1.0 = the EPUB's
   * own default, 0.7–1.6 covers the comfortable range without breaking
   * line layout in epub.js.
   */
  epubFontScale: number;
  /** Unitless CSS line-height applied inside the EPUB iframe. */
  epubLineHeight: number;
  tagColors: Partial<Record<BookStatusTag, ColorKey>>;
  enabledProviders: AiProvider[];
  anthropicApiKey: string;
  openaiApiKey: string;

  // Reading tracker config
  activeTrackerId: string;
  trackerSettings: Record<string, Record<string, unknown>>;

  // ── Themes ──
  activeThemeId: string;
  installedThemes: Record<string, Theme>;

  // ── Plugins ──
  enabledPlugins: Record<string, boolean>;
  installedPlugins: Record<string, InstalledPluginPackage>;
  pluginSettings: Record<string, Record<string, unknown>>;
  /**
   * Per-plugin key/value storage backing `PluginAPI.storage`. Keys
   * are namespaced as `plugin:<id>:<key>` by the host adapter.
   */
  pluginStorage: Record<string, unknown>;

  // ── Context-menu tools ──
  translateTargetLanguage: string;
  setTranslateTargetLanguage: (v: string) => void;

  // ── Experimental / developer toggles ──
  /**
   * When true, annotation UI (highlight, comment, context menu) is
   * mounted on non-paginated formats (TXT/MD/EPUB). Off by default
   * because persisted anchors for reflowable formats aren't modeled yet.
   */
  experimental_allowAnnotationsForAllFormats: boolean;
  /** When true, the whiteboard/draw-mode button is enabled for non-PDF docs. */
  experimental_allowWhiteboardForAllFormats: boolean;

  /**
   * Night-mode for PDFs. When on, the rendered canvas is
   * CSS-filtered with `invert(1) hue-rotate(180deg)` so light pages
   * become dark and image colors stay roughly correct (the hue
   * rotation cancels the inversion's color shift). Per-user
   * preference, persisted in localStorage; not cloud-synced (matches
   * the other reader-display prefs above).
   */
  pdfInvertColors: boolean;

  setPageScrollBehavior: (v: "smooth" | "instant") => void;
  setScrollAnimationDuration: (v: number) => void;
  setDefaultFitMode: (v: FitMode) => void;
  setEpubFlow: (v: EpubFlow) => void;
  setEpubFontScale: (v: number) => void;
  setEpubLineHeight: (v: number) => void;
  setTagColor: (tag: BookStatusTag, color: ColorKey) => void;
  setEnabledProviders: (list: AiProvider[]) => void;
  toggleProvider: (provider: AiProvider) => void;
  moveProvider: (provider: AiProvider, direction: -1 | 1) => void;
  setAnthropicApiKey: (v: string) => void;
  setOpenaiApiKey: (v: string) => void;
  setActiveTracker: (id: string) => void;
  updateTrackerSettings: (
    id: string,
    patch: Record<string, unknown>,
  ) => void;

  // Theme actions
  setActiveTheme: (id: string) => void;
  installTheme: (theme: Theme) => void;
  uninstallTheme: (id: string) => void;

  // Plugin actions
  setPluginEnabled: (id: string, enabled: boolean) => void;
  installPlugin: (manifest: PluginManifest, bundle: string) => void;
  uninstallPlugin: (id: string) => void;
  updatePluginSettings: (id: string, patch: Record<string, unknown>) => void;

  // Plugin storage (used by the host API adapter)
  setPluginStorage: (key: string, value: unknown) => void;
  removePluginStorage: (key: string) => void;

  // Experimental toggles
  setExperimentalAnnotations: (v: boolean) => void;
  setExperimentalWhiteboard: (v: boolean) => void;
  setPdfInvertColors: (v: boolean) => void;

  // Cloud sync
  syncPreferences: () => Promise<void>;
  hydrateFromRemote: (preferences: Record<string, unknown> | null | undefined) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      pageScrollBehavior: "smooth",
      scrollAnimationDuration: 300,
      defaultFitMode: "fit-width",
      epubFlow: "scrolled",
      epubFontScale: 1.0,
      epubLineHeight: 1.5,
      tagColors: {},
      enabledProviders: ["pnyxy"],
      anthropicApiKey: "",
      openaiApiKey: "",
      activeTrackerId: DEFAULT_TRACKER_ID,
      trackerSettings: buildDefaultTrackerSettings(),

      activeThemeId: DEFAULT_THEME_ID,
      installedThemes: buildInstalledThemesDefaults(),

      enabledPlugins: buildDefaultPluginSettings().enabledPlugins,
      installedPlugins: {},
      pluginSettings: buildDefaultPluginSettings().pluginSettings,
      pluginStorage: {},

      translateTargetLanguage: "en",

      experimental_allowAnnotationsForAllFormats: false,
      experimental_allowWhiteboardForAllFormats: false,

      pdfInvertColors: false,

      setTranslateTargetLanguage: (v) => set({ translateTargetLanguage: v }),
      setPageScrollBehavior: (v) => set({ pageScrollBehavior: v }),
      setScrollAnimationDuration: (v) =>
        set({ scrollAnimationDuration: Math.min(Math.max(v, 100), 1000) }),
      setDefaultFitMode: (v) => set({ defaultFitMode: v }),
      setEpubFlow: (v) => set({ epubFlow: v }),
      setEpubFontScale: (v) =>
        set({ epubFontScale: Math.min(Math.max(v, 0.7), 1.6) }),
      setEpubLineHeight: (v) =>
        set({ epubLineHeight: Math.min(Math.max(v, 1.0), 2.2) }),
      setTagColor: (tag, color) =>
        set((state) => ({ tagColors: { ...state.tagColors, [tag]: color } })),
      setEnabledProviders: (list) =>
        set({ enabledProviders: dedupeProviders(list) }),
      toggleProvider: (provider) => {
        const list = get().enabledProviders;
        if (list.includes(provider)) {
          set({ enabledProviders: list.filter((p) => p !== provider) });
        } else {
          set({ enabledProviders: [...list, provider] });
        }
      },
      moveProvider: (provider, direction) => {
        const list = [...get().enabledProviders];
        const idx = list.indexOf(provider);
        if (idx === -1) return;
        const target = idx + direction;
        if (target < 0 || target >= list.length) return;
        [list[idx], list[target]] = [list[target], list[idx]];
        set({ enabledProviders: list });
      },
      setAnthropicApiKey: (v) => set({ anthropicApiKey: v }),
      setOpenaiApiKey: (v) => set({ openaiApiKey: v }),
      setActiveTracker: (id) => set({ activeTrackerId: id }),
      updateTrackerSettings: (id, patch) =>
        set((state) => ({
          trackerSettings: {
            ...state.trackerSettings,
            [id]: { ...(state.trackerSettings[id] ?? {}), ...patch },
          },
        })),

      // ── Themes ──
      setActiveTheme: (id) => {
        set({ activeThemeId: id });
        void get().syncPreferences();
      },
      installTheme: (theme) =>
        set((state) => {
          const next = { ...state.installedThemes, [theme.id]: theme };
          queueMicrotask(() => {
            void get().syncPreferences();
          });
          return { installedThemes: next };
        }),
      uninstallTheme: (id) =>
        set((state) => {
          if (!(id in state.installedThemes)) return state;
          const { [id]: _removed, ...rest } = state.installedThemes;
          void _removed;
          // Reset to default if the active theme was uninstalled.
          const activeThemeId =
            state.activeThemeId === id ? DEFAULT_THEME_ID : state.activeThemeId;
          queueMicrotask(() => {
            void get().syncPreferences();
          });
          return { installedThemes: rest, activeThemeId };
        }),

      // ── Plugins ──
      setPluginEnabled: (id, enabled) => {
        set((state) => ({
          enabledPlugins: { ...state.enabledPlugins, [id]: enabled },
        }));
        void get().syncPreferences();
      },
      installPlugin: (manifest, bundle) =>
        set((state) => {
          const next = {
            ...state.installedPlugins,
            [manifest.id]: { manifest, bundle },
          };
          // Default to enabled (user installed it deliberately).
          const enabledPlugins = {
            ...state.enabledPlugins,
            [manifest.id]: true,
          };
          const pluginSettings =
            manifest.id in state.pluginSettings
              ? state.pluginSettings
              : { ...state.pluginSettings, [manifest.id]: {} };
          queueMicrotask(() => {
            void get().syncPreferences();
          });
          return {
            installedPlugins: next,
            enabledPlugins,
            pluginSettings,
          };
        }),
      uninstallPlugin: (id) =>
        set((state) => {
          if (!(id in state.installedPlugins)) return state;
          const { [id]: _r, ...rest } = state.installedPlugins;
          void _r;
          const { [id]: _e, ...enabledRest } = state.enabledPlugins;
          void _e;
          // Drop any plugin storage scoped to this plugin.
          const prefix = `plugin:${id}:`;
          const cleanedStorage: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(state.pluginStorage)) {
            if (!k.startsWith(prefix)) cleanedStorage[k] = v;
          }
          queueMicrotask(() => {
            void get().syncPreferences();
          });
          return {
            installedPlugins: rest,
            enabledPlugins: enabledRest,
            pluginStorage: cleanedStorage,
          };
        }),
      updatePluginSettings: (id, patch) => {
        set((state) => ({
          pluginSettings: {
            ...state.pluginSettings,
            [id]: { ...(state.pluginSettings[id] ?? {}), ...patch },
          },
        }));
        void get().syncPreferences();
      },

      setPluginStorage: (key, value) =>
        set((state) => ({
          pluginStorage: { ...state.pluginStorage, [key]: value },
        })),
      removePluginStorage: (key) =>
        set((state) => {
          if (!(key in state.pluginStorage)) return state;
          const { [key]: _, ...rest } = state.pluginStorage;
          void _;
          return { pluginStorage: rest };
        }),

      setExperimentalAnnotations: (v) =>
        set({ experimental_allowAnnotationsForAllFormats: v }),
      setExperimentalWhiteboard: (v) =>
        set({ experimental_allowWhiteboardForAllFormats: v }),
      setPdfInvertColors: (v) => set({ pdfInvertColors: v }),

      // ── Cloud sync ──
      syncPreferences: async () => {
        const auth = useAuthStore.getState();
        if (!auth.user) return;
        const state = get();
        // Strip plugin bundles before syncing — bundles are large
        // raw JS and are refetched from the registry on boot. Only
        // manifests sync.
        const installedPluginManifests: Record<string, PluginManifest> = {};
        for (const [id, pkg] of Object.entries(state.installedPlugins)) {
          installedPluginManifests[id] = pkg.manifest;
        }
        const payload = {
          appearance: {
            activeThemeId: state.activeThemeId,
            installedThemes: state.installedThemes,
          },
          plugins: {
            enabledPlugins: state.enabledPlugins,
            installedPluginManifests,
            pluginSettings: state.pluginSettings,
          },
        };
        try {
          // Merge into existing preferences rather than overwriting.
          const existing = (auth.profile?.preferences ?? {}) as Record<
            string,
            unknown
          >;
          const merged = { ...existing, ...payload };
          const { error } = await supabase
            .from("profiles")
            .update({ preferences: merged })
            .eq("id", auth.user.id);
          if (error) throw error;
        } catch (err) {
          // Non-fatal: local state is the source of truth.
          console.warn("[settings] syncPreferences failed:", err);
        }
      },

      hydrateFromRemote: (preferences) => {
        if (!preferences || typeof preferences !== "object") return;
        const appearance = (preferences as Record<string, unknown>).appearance as
          | { activeThemeId?: string; installedThemes?: Record<string, Theme> }
          | undefined;
        const plugins = (preferences as Record<string, unknown>).plugins as
          | {
              enabledPlugins?: Record<string, boolean>;
              installedPluginManifests?: Record<string, PluginManifest>;
              pluginSettings?: Record<string, Record<string, unknown>>;
            }
          | undefined;

        const patch: Partial<SettingsState> = {};
        if (appearance) {
          if (typeof appearance.activeThemeId === "string") {
            patch.activeThemeId = appearance.activeThemeId;
          }
          if (
            appearance.installedThemes &&
            typeof appearance.installedThemes === "object"
          ) {
            patch.installedThemes = {
              ...get().installedThemes,
              ...appearance.installedThemes,
            };
          }
        }
        if (plugins) {
          if (
            plugins.enabledPlugins &&
            typeof plugins.enabledPlugins === "object"
          ) {
            patch.enabledPlugins = {
              ...get().enabledPlugins,
              ...plugins.enabledPlugins,
            };
          }
          if (
            plugins.pluginSettings &&
            typeof plugins.pluginSettings === "object"
          ) {
            patch.pluginSettings = {
              ...get().pluginSettings,
              ...plugins.pluginSettings,
            };
          }
          // Manifest-only sync: we record the manifest but mark the
          // plugin as not-yet-installed locally (no bundle). The
          // manager will surface an error until the user hits
          // "Reinstall from registry" — a later iteration can do
          // this automatically.
          if (
            plugins.installedPluginManifests &&
            typeof plugins.installedPluginManifests === "object"
          ) {
            // For now, just keep local installs as the source of
            // truth for bundles; remote manifests are informational.
            // Intentionally not merged into installedPlugins.
          }
        }
        if (Object.keys(patch).length > 0) {
          set(patch as SettingsState);
        }
      },
    }),
    {
      name: "pnyxy-reader:settings",
      version: 7,
      partialize: (state) => {
        // Persist everything; pluginStorage is local-only (stays in
        // localStorage) and is intentionally NOT synced to Supabase.
        return state;
      },
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;
        // v0 → v1: convert single `aiProvider` to ordered `enabledProviders`.
        if (version < 1) {
          const legacy = state.aiProvider;
          if (
            !Array.isArray(state.enabledProviders) &&
            (legacy === "pnyxy" || legacy === "anthropic" || legacy === "openai")
          ) {
            state.enabledProviders = [legacy];
          }
          delete state.aiProvider;
        }
        // v1 → v2: seed reading tracker config.
        if (version < 2) {
          if (typeof state.activeTrackerId !== "string") {
            state.activeTrackerId = DEFAULT_TRACKER_ID;
          }
          const defaults = buildDefaultTrackerSettings();
          const existing =
            (state.trackerSettings as Record<string, Record<string, unknown>>) ??
            {};
          const merged: Record<string, Record<string, unknown>> = {};
          for (const [id, defs] of Object.entries(defaults)) {
            merged[id] = { ...defs, ...(existing[id] ?? {}) };
          }
          state.trackerSettings = merged;
        }
        // v2 → v3: seed themes + plugins.
        if (version < 3) {
          if (typeof state.activeThemeId !== "string") {
            state.activeThemeId = DEFAULT_THEME_ID;
          }
          if (
            !state.installedThemes ||
            typeof state.installedThemes !== "object"
          ) {
            state.installedThemes = buildInstalledThemesDefaults();
          }

          const pluginDefaults = buildDefaultPluginSettings();
          const existingEnabled =
            (state.enabledPlugins as Record<string, boolean>) ?? {};
          state.enabledPlugins = {
            ...pluginDefaults.enabledPlugins,
            ...existingEnabled,
          };

          const existingPluginSettings =
            (state.pluginSettings as Record<
              string,
              Record<string, unknown>
            >) ?? {};
          const mergedPluginSettings: Record<string, Record<string, unknown>> =
            { ...pluginDefaults.pluginSettings };
          for (const [id, defs] of Object.entries(pluginDefaults.pluginSettings)) {
            mergedPluginSettings[id] = {
              ...defs,
              ...(existingPluginSettings[id] ?? {}),
            };
          }
          state.pluginSettings = mergedPluginSettings;

          if (
            !state.installedPlugins ||
            typeof state.installedPlugins !== "object"
          ) {
            state.installedPlugins = {};
          }
          if (
            !state.pluginStorage ||
            typeof state.pluginStorage !== "object"
          ) {
            state.pluginStorage = {};
          }
        }
        // v3 → v4: introduce experimental multi-format toggles (default off).
        if (version < 4) {
          if (typeof state.experimental_allowAnnotationsForAllFormats !== "boolean") {
            state.experimental_allowAnnotationsForAllFormats = false;
          }
          if (typeof state.experimental_allowWhiteboardForAllFormats !== "boolean") {
            state.experimental_allowWhiteboardForAllFormats = false;
          }
        }
        // v4 → v5: seed EPUB flow preference. "scrolled" matches the
        // pre-toggle behavior so existing readers don't see a sudden
        // layout change after the upgrade.
        if (version < 5) {
          if (state.epubFlow !== "scrolled" && state.epubFlow !== "paginated") {
            state.epubFlow = "scrolled";
          }
        }
        // v5 → v6: seed EPUB typography knobs. Defaults match the
        // EPUB's own intrinsic styling so existing readers don't see
        // their books re-flow on upgrade.
        if (version < 6) {
          const fs = Number(state.epubFontScale);
          state.epubFontScale =
            Number.isFinite(fs) && fs >= 0.7 && fs <= 1.6 ? fs : 1.0;
          const lh = Number(state.epubLineHeight);
          state.epubLineHeight =
            Number.isFinite(lh) && lh >= 1.0 && lh <= 2.2 ? lh : 1.5;
        }
        // v6 → v7: pick up new plugin defaults. The earlier "all
        // core plugins start disabled" rule meant the global ?
        // cheatsheet was invisible to anyone who never opened the
        // plugin tab. Plugins now opt-in to a true default via
        // `defaultEnabled` on the manifest; flip them on for any
        // existing user whose stored value is false.
        if (version < 7) {
          const pluginDefaults = buildDefaultPluginSettings();
          const existing =
            (state.enabledPlugins as Record<string, boolean>) ?? {};
          const next: Record<string, boolean> = { ...existing };
          for (const [id, def] of Object.entries(pluginDefaults.enabledPlugins)) {
            if (def === true) next[id] = true;
            else if (next[id] === undefined) next[id] = def;
          }
          state.enabledPlugins = next;
        }
        return state as unknown as SettingsState;
      },
    },
  ),
);

function dedupeProviders(list: AiProvider[]): AiProvider[] {
  const seen = new Set<AiProvider>();
  const out: AiProvider[] = [];
  for (const p of list) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}
