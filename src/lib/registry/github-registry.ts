import type { Theme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";
import { fetchCached } from "./cache";
import type {
  RegistryIndex,
  RegistryIndexEntry,
  RegistryProvider,
} from "./types";

const DEFAULT_BASE_URL =
  "https://raw.githubusercontent.com/LenYx24/pnyxy-community/master";

export interface GitHubRegistryOptions {
  /** Base URL for the registry repo (without trailing slash). */
  baseUrl?: string;
}

/**
 * Read-only registry backed by a GitHub repository served via
 * `raw.githubusercontent.com`. Files:
 *
 *   index.json                   → RegistryIndex
 *   themes/<id>.json             → Theme
 *   plugins/<id>/manifest.json   → PluginManifest
 *   plugins/<id>/<version>/plugin.js → bundle text
 *
 * All fetches go through `cache.ts` (1h localStorage TTL).
 */
export class GitHubRegistry implements RegistryProvider {
  readonly label = "github";
  private readonly baseUrl: string;

  constructor(opts: GitHubRegistryOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async fetchIndex(): Promise<RegistryIndex> {
    const text = await fetchCached(`${this.baseUrl}/index.json`);
    const parsed = JSON.parse(text) as RegistryIndex;
    if (parsed.apiVersion !== 1) {
      throw new Error(`Unsupported registry apiVersion: ${parsed.apiVersion}`);
    }
    return parsed;
  }

  async listPlugins(): Promise<RegistryIndexEntry[]> {
    return (await this.fetchIndex()).plugins ?? [];
  }

  async listThemes(): Promise<RegistryIndexEntry[]> {
    return (await this.fetchIndex()).themes ?? [];
  }

  async fetchThemeManifest(id: string): Promise<Theme> {
    const text = await fetchCached(`${this.baseUrl}/themes/${id}.json`);
    return JSON.parse(text) as Theme;
  }

  async fetchPluginManifest(id: string): Promise<PluginManifest> {
    const text = await fetchCached(
      `${this.baseUrl}/plugins/${id}/manifest.json`,
    );
    return JSON.parse(text) as PluginManifest;
  }

  async fetchPluginBundle(id: string, version: string): Promise<string> {
    return fetchCached(`${this.baseUrl}/plugins/${id}/${version}/plugin.js`);
  }
}
