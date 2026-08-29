import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BookStatusTag } from "@/types/database";
import type { ColorKey } from "@/lib/tag-colors";
import type { FeatureKey } from "@/lib/features";
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
import { track } from "@/lib/telemetry";
import {
  emptyAiContextBindings,
  newAiContextPresetId,
  type AiContextBindingKind,
  type AiContextBindings,
  type AiContextPreset,
} from "@/features/settings/ai-context/types";
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
  /** Color per custom (free-text) tag label. Unset = default gray. */
  customTagColors: Record<string, ColorKey>;
  /** Custom tag labels created in Settings that may not be on any book
   *  yet; the picker offers them as one-click suggestions. */
  customTagLibrary: string[];
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
  /** Legacy single free-text context. Migrated into `aiContexts` in v14;
   *  kept one version as a read-only fallback, no longer written. */
  aiCustomDefaultContext: string;
  /** Named markdown context presets (see features/settings/ai-context). */
  aiContexts: AiContextPreset[];
  /** Preset used when no book / folder / org binding matches. */
  aiDefaultContextId: string | null;
  /** book > folder > org bindings, each maps an entity id to a preset id. */
  aiContextBindings: AiContextBindings;
  /** Book-tied chats auto-include the book's TOC in the system prompt. */
  aiAttachToc: boolean;
  /** Chat message / composer font size in px (13–18). */
  chatFontSize: number;
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

  // Feature gating (see lib/features.ts). Local overrides win over the
  // server unlock list; adminShowAllFeatures lets an admin see the full
  // app without touching overrides.
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  adminShowAllFeatures: boolean;

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
  setCustomTagColor: (label: string, color: ColorKey | undefined) => void;
  setCustomTagLibrary: (labels: string[]) => void;
  setEnabledProviders: (list: AiProvider[]) => void;
  toggleProvider: (provider: AiProvider) => void;
  moveProvider: (provider: AiProvider, direction: -1 | 1) => void;
  setAnthropicApiKey: (v: string) => void;
  setOpenaiApiKey: (v: string) => void;
  /** Null out every BYOK key in memory. Called on sign-out; these fields
   *  are memory-only (excluded from `partialize`) so this is also what
   *  actually erases them, not just an in-session convenience. */
  clearSensitive: () => void;
  setPnyxyModel: (v: string | null) => void;
  setLocalBaseUrl: (v: string) => void;
  setLocalModel: (v: string) => void;
  setLocalApiKey: (v: string) => void;
  setAiCustomDefaultContext: (v: string) => void;
  // AI context presets
  createAiContext: (name: string, body?: string) => string;
  updateAiContext: (
    id: string,
    patch: Partial<Pick<AiContextPreset, "name" | "body">>,
  ) => void;
  duplicateAiContext: (id: string, copyName: string) => string | null;
  deleteAiContext: (id: string) => void;
  setAiDefaultContextId: (id: string | null) => void;
  bindAiContext: (
    kind: AiContextBindingKind,
    entityId: string,
    presetId: string | null,
  ) => void;
  setAiAttachToc: (v: boolean) => void;
  setChatFontSize: (v: number) => void;
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
  setFeatureOverride: (key: FeatureKey, v: boolean | undefined) => void;
  setAdminShowAllFeatures: (v: boolean) => void;
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
      customTagColors: {},
      customTagLibrary: [],
      enabledProviders: ["pnyxy"],
      anthropicApiKey: "",
      openaiApiKey: "",
      pnyxyModel: null,
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "",
      localApiKey: "",
      aiCustomDefaultContext: "",
      aiContexts: [],
      aiDefaultContextId: null,
      aiContextBindings: emptyAiContextBindings(),
      aiAttachToc: true,
      chatFontSize: 15,
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

      featureOverrides: {},
      adminShowAllFeatures: true,

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
      setCustomTagColor: (label, color) =>
        set((state) => {
          const next = { ...state.customTagColors };
          if (color === undefined) delete next[label];
          else next[label] = color;
          return { customTagColors: next };
        }),
      setCustomTagLibrary: (labels) => set({ customTagLibrary: labels }),
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
      clearSensitive: () =>
        set({ anthropicApiKey: "", openaiApiKey: "", localApiKey: "" }),
      setPnyxyModel: (v: string | null) => set({ pnyxyModel: v }),
      setLocalBaseUrl: (v) => set({ localBaseUrl: v }),
      setLocalModel: (v) => set({ localModel: v }),
      setLocalApiKey: (v) => set({ localApiKey: v }),
      setAiCustomDefaultContext: (v) => set({ aiCustomDefaultContext: v }),

      // AI context presets. Every mutation syncs, these are the kind of
      // prefs a user expects to follow them across devices.
      createAiContext: (name, body = "") => {
        const id = newAiContextPresetId();
        const now = new Date().toISOString();
        set((s) => ({
          aiContexts: [
            ...s.aiContexts,
            { id, name: name.trim() || "Untitled", body, createdAt: now, updatedAt: now },
          ],
          // first preset becomes the default so it takes effect right away
          aiDefaultContextId: s.aiDefaultContextId ?? id,
        }));
        queueSync(get);
        return id;
      },
      updateAiContext: (id, patch) => {
        set((s) => ({
          aiContexts: s.aiContexts.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.body !== undefined ? { body: patch.body } : {}),
                  updatedAt: new Date().toISOString(),
                }
              : p,
          ),
        }));
        queueSync(get);
      },
      duplicateAiContext: (id, copyName) => {
        const src = get().aiContexts.find((p) => p.id === id);
        if (!src) return null;
        return get().createAiContext(copyName, src.body);
      },
      deleteAiContext: (id) => {
        set((s) => {
          const strip = (rec: Record<string, string>) =>
            Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== id));
          return {
            aiContexts: s.aiContexts.filter((p) => p.id !== id),
            aiDefaultContextId:
              s.aiDefaultContextId === id ? null : s.aiDefaultContextId,
            aiContextBindings: {
              books: strip(s.aiContextBindings.books),
              folders: strip(s.aiContextBindings.folders),
              orgs: strip(s.aiContextBindings.orgs),
            },
          };
        });
        queueSync(get);
      },
      setAiDefaultContextId: (id) => {
        set({ aiDefaultContextId: id });
        track("settings_ai_context_changed", { hasContext: id !== null });
        queueSync(get);
      },
      bindAiContext: (kind, entityId, presetId) => {
        set((s) => {
          const next = { ...s.aiContextBindings[kind] };
          if (presetId) next[entityId] = presetId;
          else delete next[entityId];
          return { aiContextBindings: { ...s.aiContextBindings, [kind]: next } };
        });
        queueSync(get);
      },
      setAiAttachToc: (v) => set({ aiAttachToc: v }),
      setChatFontSize: (v) => set({ chatFontSize: Math.min(18, Math.max(13, Math.round(v))) }),
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
      setFeatureOverride: (key, v) =>
        set((s) => {
          const next = { ...s.featureOverrides };
          if (v === undefined) delete next[key];
          else next[key] = v;
          return { featureOverrides: next };
        }),
      setAdminShowAllFeatures: (v) => set({ adminShowAllFeatures: v }),
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
          aiContext: {
            presets: state.aiContexts,
            defaultId: state.aiDefaultContextId,
            bindings: state.aiContextBindings,
          },
        };
        try {
          // merge, don't overwrite existing preferences
          const existing = (auth.profile?.preferences ?? {}) as Record<
            string,
            unknown
          >;
          // `features` is the server-side unlock list: the DB trigger
          // (00072) rejects client changes to it, so omit the key and let
          // the server keep its own value.
          const { features: _features, ...clientPrefs } = existing;
          void _features;
          const merged = { ...clientPrefs, ...payload };
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

        const aiContext = (preferences as Record<string, unknown>).aiContext as
          | {
              presets?: AiContextPreset[];
              defaultId?: string | null;
              bindings?: Partial<AiContextBindings>;
            }
          | undefined;

        const patch: Partial<SettingsState> = {};
        if (aiContext && typeof aiContext === "object") {
          if (Array.isArray(aiContext.presets)) {
            // remote wins per id, local-only presets (not yet synced) survive
            const remote = aiContext.presets.filter(isAiContextPreset);
            const remoteIds = new Set(remote.map((p) => p.id));
            patch.aiContexts = [
              ...remote,
              ...get().aiContexts.filter((p) => !remoteIds.has(p.id)),
            ];
          }
          if (aiContext.defaultId === null || typeof aiContext.defaultId === "string") {
            patch.aiDefaultContextId = aiContext.defaultId;
          }
          if (aiContext.bindings && typeof aiContext.bindings === "object") {
            patch.aiContextBindings = {
              ...emptyAiContextBindings(),
              ...aiContext.bindings,
            };
          }
        }
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
      version: 15,
      partialize: (state) => {
        // persist everything except BYOK keys: those live in memory only
        // for the session (H5 hardening) so a shared/borrowed machine, or
        // a leaked localStorage dump, can't leak a user's own Anthropic/
        // OpenAI/local-endpoint credentials. Re-entering them after a
        // reload is the accepted tradeoff.
        const {
          anthropicApiKey: _anthropicApiKey,
          openaiApiKey: _openaiApiKey,
          localApiKey: _localApiKey,
          ...rest
        } = state;
        void _anthropicApiKey;
        void _openaiApiKey;
        void _localApiKey;
        return rest as SettingsState;
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
        // v3: seed themes + plugins. Pre-v3 installs were running the
        // Pnyxy Dark look, so they keep it explicitly; DEFAULT_THEME_ID
        // (Pnyxy Neutral) is only for fresh installs.
        if (version < 3) {
          if (typeof state.activeThemeId !== "string") {
            state.activeThemeId = "pnyxy-dark";
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
          if (typeof state.chatFontSize !== "number") {
            state.chatFontSize = 15;
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
        // v13: feature gating fields
        if (version < 13) {
          if (!state.featureOverrides || typeof state.featureOverrides !== "object") {
            state.featureOverrides = {};
          }
          if (typeof state.adminShowAllFeatures !== "boolean") {
            state.adminShowAllFeatures = true;
          }
        }
        // v14: context presets. The legacy free-text context becomes one
        // preset named "Default" and is set as the default. The old
        // string is kept one version as a fallback but no longer written.
        if (version < 14) {
          if (!Array.isArray(state.aiContexts)) state.aiContexts = [];
          if (typeof state.aiDefaultContextId !== "string") {
            state.aiDefaultContextId = null;
          }
          state.aiContextBindings = {
            ...emptyAiContextBindings(),
            ...((state.aiContextBindings as Partial<AiContextBindings>) ?? {}),
          };
          const legacy =
            typeof state.aiCustomDefaultContext === "string"
              ? state.aiCustomDefaultContext.trim()
              : "";
          if (legacy && (state.aiContexts as AiContextPreset[]).length === 0) {
            const now = new Date().toISOString();
            const preset: AiContextPreset = {
              id: newAiContextPresetId(),
              name: legacyDefaultPresetName(),
              body: legacy,
              createdAt: now,
              updatedAt: now,
            };
            state.aiContexts = [preset];
            state.aiDefaultContextId = preset.id;
          }
        }
        // v15: BYOK keys move to memory-only storage (H5 hardening).
        // Purge whatever a pre-v15 install already wrote to localStorage
        // so it doesn't silently rehydrate this session; the user
        // re-enters their key(s) once after the upgrade.
        if (version < 15) {
          delete state.anthropicApiKey;
          delete state.openaiApiKey;
          delete state.localApiKey;
        }
        return state as unknown as SettingsState;
      },
    },
  ),
);

/** Debounced sync for the preset actions, so a burst of edits (the editor
 *  emits every 300 ms) doesn't hammer the profiles row. */
let aiContextSyncTimer: ReturnType<typeof setTimeout> | null = null;
function queueSync(get: () => SettingsState) {
  if (aiContextSyncTimer) clearTimeout(aiContextSyncTimer);
  aiContextSyncTimer = setTimeout(() => {
    aiContextSyncTimer = null;
    void get().syncPreferences();
  }, 1500);
}

function isAiContextPreset(v: unknown): v is AiContextPreset {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.body === "string"
  );
}

/** Localized name for the migrated legacy preset, without pulling i18n
 *  into the store: read the persisted UI language directly. */
function legacyDefaultPresetName(): string {
  try {
    const lang =
      (typeof localStorage !== "undefined" &&
        localStorage.getItem("pnyxy-reader:language")) ||
      "";
    return lang.startsWith("hu") ? "Alapértelmezett" : "Default";
  } catch {
    return "Default";
  }
}

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
