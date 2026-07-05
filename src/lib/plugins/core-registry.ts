import {
  createKeyboardCheatsheetModule,
  keyboardCheatsheetManifest,
} from "./core/keyboard-cheatsheet";
import {
  createReadingStatsModule,
  readingStatsManifest,
} from "./core/reading-stats";
import type { PluginManifest, PluginModule } from "./types";

export interface CorePluginEntry {
  manifest: PluginManifest;
  module: PluginModule;
}

/**
 * Built-in plugins. Each entry pairs a manifest with a freshly-built
 * module instance, modules carry private state, so we instantiate
 * them lazily through factories invoked here at module load.
 *
 * To add a core plugin: implement `PluginModule` in a new file under
 * `core/` and register it here.
 */
export const CORE_PLUGINS = {
  "reading-stats": {
    manifest: readingStatsManifest,
    module: createReadingStatsModule(),
  },
  "keyboard-cheatsheet": {
    manifest: keyboardCheatsheetManifest,
    module: createKeyboardCheatsheetModule(),
  },
} as const satisfies Record<string, CorePluginEntry>;

export type CorePluginId = keyof typeof CORE_PLUGINS;

/** Look up a manifest for either a core plugin or an installed community plugin. */
export function getPluginManifest(
  id: string,
  installed: Record<string, { manifest: PluginManifest }> = {},
): PluginManifest | undefined {
  const core = (CORE_PLUGINS as Record<string, CorePluginEntry>)[id];
  if (core) return core.manifest;
  return installed[id]?.manifest;
}

/**
 * Default `enabledPlugins` map used by the settings-store migration.
 * Most core plugins are **disabled by default**, users opt in via
 * Settings → Plugins. A plugin manifest can flip `defaultEnabled`
 * to ship turned on (e.g. the global `?` cheatsheet, which would
 * otherwise be invisible to anyone who never opens the plugin tab).
 * Community plugins default to enabled when installed (opt-in
 * happened at install time).
 */
export function buildDefaultPluginSettings(): {
  enabledPlugins: Record<string, boolean>;
  pluginSettings: Record<string, Record<string, unknown>>;
} {
  const enabledPlugins: Record<string, boolean> = {};
  const pluginSettings: Record<string, Record<string, unknown>> = {};
  for (const [id, entry] of Object.entries(CORE_PLUGINS)) {
    enabledPlugins[id] = entry.manifest.defaultEnabled === true;
    pluginSettings[id] = {};
  }
  return { enabledPlugins, pluginSettings };
}
