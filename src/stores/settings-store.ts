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
import {
  READER_THEME_IDS,
  type ReaderTheme,
} from "@/lib/reader-themes";
import {
  EPUB_COLUMN_WIDTH_IDS,
  EPUB_FONT_FAMILY_IDS,
  type EpubColumnWidth,
  type EpubFontFamily,
} from "@/lib/epub-typography";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";

export type FitMode = "fit-width" | "fit-page";
export type EpubFlow = "scrolled" | "paginated";
export type AiProvider = "pnyxy" | "anthropic" | "openai" | "local";

export const ALL_AI_PROVIDERS: readonly AiProvider[] = [
  "pnyxy",
  "anthropic",
  "openai",
  "local",
] as const;

export interface InstalledPluginPackage {
  manifest: PluginManifest;
  /** Plain JS source. Local-only, never synced to Supabase. */
  bundle: string;
}

interface SettingsState {
  pageScrollBehavior: "smooth" | "instant";
  scrollAnimationDuration: number;
  defaultFitMode: FitMode;
  epubFlow: EpubFlow;
  /** Multiplier on EPUB body font size. 1.0 = EPUB default, clamped 0.7-1.6. */
  epubFontScale: number;
  /** Unitless CSS line-height applied inside the EPUB iframe. */
  epubLineHeight: number;
  /** Preset EPUB body font. "default" = no override, EPUB's own fonts win. */
  epubFontFamily: EpubFontFamily;
  /** Prose column cap. "full" = no constraint. Scrolled flow only; paginated sets its own widths. */
  epubColumnWidth: EpubColumnWidth;
  /** Reader content palette, independent of app chrome. PDF only themes the gutter + dark canvas filter. */
  readerTheme: ReaderTheme;
  tagColors: Partial<Record<BookStatusTag, ColorKey>>;
  enabledProviders: AiProvider[];
  anthropicApiKey: string;
  openaiApiKey: string;
  /** Force a specific model on the Pnyxy proxy instead of auto-routing. null = auto. */
  pnyxyModel: string | null;
  /** Base URL for an OpenAI-compatible local LLM. Default is Ollama; LM Studio uses :1234/v1. */
  localBaseUrl: string;
  /** Model name sent in the request body (e.g. "llama3.2"). No default; registries are user-managed. */
  localModel: string;
  /** Optional bearer for gated endpoints (LM Studio, vLLM --api-key). Empty is fine for local Ollama. */
  localApiKey: string;

  // AI context (chat-store reads these to build the system prompt)
  /** Free-form notes injected as a paragraph in every chat turn's system prompt. Empty = none. */
  aiCustomDefaultContext: string;
  /** Book-tied chats auto-include the book's TOC in the system prompt. */
  aiAttachToc: boolean;
  /** Default N for the "select pages [current-N, current+N] around current" button. */
  aiSurroundingPagesCount: number;

  // Reading tracker config
  activeTrackerId: string;
  trackerSettings: Record<string, Record<string, unknown>>;

  // Themes
  activeThemeId: string;
  installedThemes: Record<string, Theme>;

  // Plugins
  enabledPlugins: Record<string, boolean>;
  installedPlugins: Record<string, InstalledPluginPackage>;
  pluginSettings: Record<string, Record<string, unknown>>;
  /** Backs `PluginAPI.storage`. Keys namespaced `plugin:<id>:<key>` by the host adapter. */
  pluginStorage: Record<string, unknown>;

  // Context-menu tools
  /** "auto" = detect from the text; otherwise a language code. */
  translateSourceLanguage: string;
  setTranslateSourceLanguage: (v: string) => void;
  translateTargetLanguage: string;
  setTranslateTargetLanguage: (v: string) => void;

  // Experimental / developer toggles
  /** Mount annotation UI on reflowable formats (TXT/MD/EPUB). Off: anchors aren't modeled for reflow yet. */
  experimental_allowAnnotationsForAllFormats: boolean;
  /** When true, the whiteboard/draw-mode button is enabled for non-PDF docs. */
  experimental_allowWhiteboardForAllFormats: boolean;

  /** PDF night-mode: invert(1) hue-rotate(180deg). hue-rotate keeps image colors roughly right. Local-only. */
  pdfInvertColors: boolean;
  /** Whether the reader's secondary action row is open. Desktop only; persisted per-user. */
  readerSecondaryPanelOpen: boolean;
  /** Whether the first-run onboarding tour has been finished or dismissed. */
  onboardingCompleted: boolean;
  /** PDF reflow: render the pdf.js text layer as flowing text so phones don't pan sideways. Local-only. */
  pdfReflowMode: boolean;

  setPageScrollBehavior: (v: "smooth" | "instant") => void;
  setScrollAnimationDuration: (v: number) => void;
  setDefaultFitMode: (v: FitMode) => void;
  setEpubFlow: (v: EpubFlow) => void;
  setEpubFontScale: (v: number) => void;
  setEpubLineHeight: (v: number) => void;
  setEpubFontFamily: (v: EpubFontFamily) => void;
  setEpubColumnWidth: (v: EpubColumnWidth) => void;
  setReaderTheme: (v: ReaderTheme) => void;
  setTagColor: (tag: BookStatusTag, color: ColorKey) => void;
  setEnabledProviders: (list: AiProvider[]) => void;
  toggleProvider: (provider: AiProvider) => void;
  moveProvider: (provider: AiProvider, direction: -1 | 1) => void;
  setAnthropicApiKey: (v: string) => void;
  setOpenaiApiKey: (v: string) => void;
  setPnyxyModel: (v: string | null) => void;
  setLocalBaseUrl: (v: string) => void;
  setLocalModel: (v: string) => void;
  setLocalApiKey: (v: string) => void;
  setAiCustomDefaultContext: (v: string) => void;
  setAiAttachToc: (v: boolean) => void;
  setAiSurroundingPagesCount: (v: number) => void;
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
  setPdfReflowMode: (v: boolean) => void;
  setReaderSecondaryPanelOpen: (v: boolean) => void;
  setOnboardingCompleted: (v: boolean) => void;

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
      epubFontFamily: "default",
      epubColumnWidth: "full",
      readerTheme: "light",
      tagColors: {},
      enabledProviders: ["pnyxy"],
      anthropicApiKey: "",
      openaiApiKey: "",
      pnyxyModel: null,
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "",
      localApiKey: "",
      aiCustomDefaultContext: "",
      aiAttachToc: true,
      aiSurroundingPagesCount: 5,
      activeTrackerId: DEFAULT_TRACKER_ID,
      trackerSettings: buildDefaultTrackerSettings(),

      activeThemeId: DEFAULT_THEME_ID,
      installedThemes: buildInstalledThemesDefaults(),

      enabledPlugins: buildDefaultPluginSettings().enabledPlugins,
      installedPlugins: {},
      pluginSettings: buildDefaultPluginSettings().pluginSettings,
      pluginStorage: {},

      translateSourceLanguage: "auto",
      translateTargetLanguage: "en",

      experimental_allowAnnotationsForAllFormats: false,
      experimental_allowWhiteboardForAllFormats: false,

      pdfInvertColors: false,
      pdfReflowMode: false,
      readerSecondaryPanelOpen: false,
      onboardingCompleted: false,

      setTranslateSourceLanguage: (v) => set({ translateSourceLanguage: v }),
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
      setEpubFontFamily: (v) =>
        set({
          epubFontFamily: EPUB_FONT_FAMILY_IDS.includes(v) ? v : "default",
        }),
      setEpubColumnWidth: (v) =>
        set({
          epubColumnWidth: EPUB_COLUMN_WIDTH_IDS.includes(v) ? v : "full",
        }),
      setReaderTheme: (v) =>
        set({
          readerTheme: READER_THEME_IDS.includes(v) ? v : "light",
        }),
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
      setPnyxyModel: (v: string | null) => set({ pnyxyModel: v }),
      setLocalBaseUrl: (v) => set({ localBaseUrl: v }),
      setLocalModel: (v) => set({ localModel: v }),
      setLocalApiKey: (v) => set({ localApiKey: v }),
      setAiCustomDefaultContext: (v) => set({ aiCustomDefaultContext: v }),
      setAiAttachToc: (v) => set({ aiAttachToc: v }),
      // clamp 0..50 so one click can't flood the prompt with pages
      setAiSurroundingPagesCount: (v) =>
        set({ aiSurroundingPagesCount: Math.min(Math.max(Math.round(v), 0), 50) }),
      setActiveTracker: (id) => set({ activeTrackerId: id }),
      updateTrackerSettings: (id, patch) =>
        set((state) => ({
          trackerSettings: {
            ...state.trackerSettings,
            [id]: { ...(state.trackerSettings[id] ?? {}), ...patch },
          },
        })),

      // Themes
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
          // reset active theme if it was the one removed
          const activeThemeId =
            state.activeThemeId === id ? DEFAULT_THEME_ID : state.activeThemeId;
          queueMicrotask(() => {
            void get().syncPreferences();
          });
          return { installedThemes: rest, activeThemeId };
        }),

      // Plugins
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
          // enable on install
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
          // drop storage scoped to this plugin
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
      setPdfReflowMode: (v) => set({ pdfReflowMode: v }),
      setReaderSecondaryPanelOpen: (v) => set({ readerSecondaryPanelOpen: v }),
      setOnboardingCompleted: (v) => set({ onboardingCompleted: v }),

      // Cloud sync
      syncPreferences: async () => {
        const auth = useAuthStore.getState();
        if (!auth.user) return;
        const state = get();
        // strip bundles before syncing; they're large and refetched from the registry on boot
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
          // merge, don't overwrite existing preferences
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
          // non-fatal, local state is source of truth
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
          if (
            plugins.installedPluginManifests &&
            typeof plugins.installedPluginManifests === "object"
          ) {
            // local installs stay the source of truth for bundles; remote manifests are informational
          }
        }
        if (Object.keys(patch).length > 0) {
          set(patch as SettingsState);
        }
      },
    }),
    {
      name: "pnyxy-reader:settings",
      version: 12,
      partialize: (state) => {
        // persist everything; pluginStorage stays local-only, never synced to Supabase
        return state;
      },
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Record<string, unknown>;
        // v1: single `aiProvider` -> ordered `enabledProviders`
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
        // v2: seed reading tracker config
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
        // v3: seed themes + plugins
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
        // v4: experimental multi-format toggles (default off)
        if (version < 4) {
          if (typeof state.experimental_allowAnnotationsForAllFormats !== "boolean") {
            state.experimental_allowAnnotationsForAllFormats = false;
          }
          if (typeof state.experimental_allowWhiteboardForAllFormats !== "boolean") {
            state.experimental_allowWhiteboardForAllFormats = false;
          }
        }
        // v5: seed EPUB flow, default "scrolled"
        if (version < 5) {
          if (state.epubFlow !== "scrolled" && state.epubFlow !== "paginated") {
            state.epubFlow = "scrolled";
          }
        }
        // v6: seed EPUB typography knobs
        if (version < 6) {
          const fs = Number(state.epubFontScale);
          state.epubFontScale =
            Number.isFinite(fs) && fs >= 0.7 && fs <= 1.6 ? fs : 1.0;
          const lh = Number(state.epubLineHeight);
          state.epubLineHeight =
            Number.isFinite(lh) && lh >= 1.0 && lh <= 2.2 ? lh : 1.5;
        }
        // v7: pick up new plugin defaults. Manifests opt-in via `defaultEnabled`;
        // flip those on even if a stored value is false.
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
        // v8: seed AI-context settings (custom context, attach-TOC, surrounding-pages)
        if (version < 8) {
          if (typeof state.aiCustomDefaultContext !== "string") {
            state.aiCustomDefaultContext = "";
          }
          if (typeof state.aiAttachToc !== "boolean") {
            state.aiAttachToc = true;
          }
          const surrounding = Number(state.aiSurroundingPagesCount);
          state.aiSurroundingPagesCount =
            Number.isFinite(surrounding) && surrounding >= 0
              ? Math.min(Math.round(surrounding), 50)
              : 5;
        }
        // v9: seed reader-content theme, default "light"
        if (version < 9) {
          if (
            state.readerTheme !== "light" &&
            state.readerTheme !== "dark" &&
            state.readerTheme !== "sepia"
          ) {
            state.readerTheme = "light";
          }
        }
        // v10: seed EPUB typography presets, both default to "no override"
        if (version < 10) {
          if (
            state.epubFontFamily !== "default" &&
            state.epubFontFamily !== "serif" &&
            state.epubFontFamily !== "sans" &&
            state.epubFontFamily !== "mono"
          ) {
            state.epubFontFamily = "default";
          }
          if (
            state.epubColumnWidth !== "full" &&
            state.epubColumnWidth !== "wide" &&
            state.epubColumnWidth !== "comfortable" &&
            state.epubColumnWidth !== "narrow"
          ) {
            state.epubColumnWidth = "full";
          }
        }
        // v11: seed secondary action panel state, closed by default
        if (version < 11) {
          if (typeof state.readerSecondaryPanelOpen !== "boolean") {
            state.readerSecondaryPanelOpen = false;
          }
        }
        // v12: existing users have already learned the app; skip the tour.
        // Brand-new users start from the initial `false` and see it once.
        if (version < 12) {
          state.onboardingCompleted = true;
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
