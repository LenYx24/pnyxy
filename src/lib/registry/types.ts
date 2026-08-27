import type { Theme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";

export interface RegistryIndexEntry {
  kind: "plugin" | "theme";
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /**
   * Optional SHA-256 hex digest of the fetched content (the theme
   * JSON, the plugin manifest JSON, or the plugin bundle text,
   * depending on `kind`). When present, `GitHubRegistry` verifies it
   * with `crypto.subtle.digest` before returning the content, whether
   * it came from the network or from the localStorage cache.
   */
  integrity?: string;
}

export interface RegistryIndex {
  apiVersion: 1;
  plugins: RegistryIndexEntry[];
  themes: RegistryIndexEntry[];
}

export interface RegistryProvider {
  /** Human label for diagnostics. */
  readonly label: string;
  listPlugins(): Promise<RegistryIndexEntry[]>;
  listThemes(): Promise<RegistryIndexEntry[]>;
  fetchThemeManifest(id: string): Promise<Theme>;
  fetchPluginManifest(id: string): Promise<PluginManifest>;
  fetchPluginBundle(id: string, version: string): Promise<string>;
}

export interface RegistryStatus {
  /** True when the primary registry was unreachable and the fallback is in use. */
  offline: boolean;
  primaryError?: string;
}
