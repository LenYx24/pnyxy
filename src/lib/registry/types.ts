import type { Theme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";

export interface RegistryIndexEntry {
  kind: "plugin" | "theme";
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
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
