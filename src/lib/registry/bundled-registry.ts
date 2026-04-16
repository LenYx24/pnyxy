import type { Theme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";
import type { RegistryIndexEntry, RegistryProvider } from "./types";

/**
 * Hardcoded fallback used when the GitHub registry is unreachable
 * (offline / DNS / corporate proxy). Ships with one example of each
 * kind so the Browse UI is non-empty on first run.
 */

const SOLAR_THEME: Theme = {
  id: "solar",
  name: "Solar",
  description: "Warm sunset palette.",
  author: "Pnyxy (bundled)",
  apiVersion: 1,
  variant: "dark",
  tokens: {
    "--color-bg-primary": "#1a1208",
    "--color-bg-secondary": "#241a0d",
    "--color-bg-tertiary": "#2e2212",
    "--color-accent-purple": "#f59e0b",
    "--color-accent-blue": "#fb923c",
    "--color-text-primary": "#fef3c7",
    "--color-text-secondary": "#fde68a",
    "--color-text-muted": "#a8825a",
    "--color-glass-bg": "rgba(252, 211, 77, 0.06)",
    "--color-glass-border": "rgba(252, 211, 77, 0.18)",
    "--color-glass-hover": "rgba(252, 211, 77, 0.1)",
  },
};

const HELLO_PLUGIN_MANIFEST: PluginManifest = {
  id: "hello-world",
  name: "Hello World",
  version: "1.0.0",
  apiVersion: 1,
  author: "Pnyxy (bundled)",
  description: "A minimal example plugin that registers a greeting command.",
  entry: "",
  permissions: ["commands", "notifications"],
  runtime: ["sandboxed"],
};

const HELLO_PLUGIN_BUNDLE = `
plugin.commands.register('hello-world:greet', 'Hello World: Greet').then(function () {
  plugin.commands.on('hello-world:greet', function () {
    return plugin.notifications.show('Hello from a sandboxed plugin!');
  });
});
`;

const BUNDLED_THEMES: Record<string, Theme> = {
  [SOLAR_THEME.id]: SOLAR_THEME,
};

const BUNDLED_PLUGINS: Record<
  string,
  { manifest: PluginManifest; bundle: string }
> = {
  [HELLO_PLUGIN_MANIFEST.id]: {
    manifest: HELLO_PLUGIN_MANIFEST,
    bundle: HELLO_PLUGIN_BUNDLE,
  },
};

function asEntry(t: Theme): RegistryIndexEntry {
  return {
    kind: "theme",
    id: t.id,
    name: t.name,
    version: String(t.apiVersion),
    description: t.description,
    author: t.author,
  };
}

function pluginAsEntry(m: PluginManifest): RegistryIndexEntry {
  return {
    kind: "plugin",
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    author: m.author,
  };
}

export class BundledFallbackRegistry implements RegistryProvider {
  readonly label = "bundled";

  async listPlugins(): Promise<RegistryIndexEntry[]> {
    return Object.values(BUNDLED_PLUGINS).map((p) => pluginAsEntry(p.manifest));
  }

  async listThemes(): Promise<RegistryIndexEntry[]> {
    return Object.values(BUNDLED_THEMES).map(asEntry);
  }

  async fetchThemeManifest(id: string): Promise<Theme> {
    const t = BUNDLED_THEMES[id];
    if (!t) throw new Error(`Bundled registry: unknown theme "${id}"`);
    return t;
  }

  async fetchPluginManifest(id: string): Promise<PluginManifest> {
    const p = BUNDLED_PLUGINS[id];
    if (!p) throw new Error(`Bundled registry: unknown plugin "${id}"`);
    return p.manifest;
  }

  async fetchPluginBundle(id: string): Promise<string> {
    const p = BUNDLED_PLUGINS[id];
    if (!p) throw new Error(`Bundled registry: unknown plugin "${id}"`);
    return p.bundle;
  }
}
