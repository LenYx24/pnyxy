import type { Theme } from "@/lib/themes";
import { sanitizeTheme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";
import { fetchCached } from "./cache";
import type {
  RegistryIndex,
  RegistryIndexEntry,
  RegistryProvider,
} from "./types";

/**
 * Ref (branch/tag/commit) of the community registry repo to pull
 * from. Pinned to `master` for now so the registry can iterate
 * without an app release; a compromised or vandalized community repo
 * can serve different content at any time under this scheme. Before
 * a wider rollout, consider pinning `VITE_REGISTRY_REF` to a specific
 * commit SHA in production builds so content only changes alongside
 * an app update.
 */
const REGISTRY_REF =
  (import.meta.env.VITE_REGISTRY_REF as string | undefined) ?? "master";

const DEFAULT_BASE_URL = `https://raw.githubusercontent.com/LenYx24/pnyxy-community/${REGISTRY_REF}`;

/** `id`s are used as path segments in a raw.githubusercontent.com URL.
 * Restricting the charset rules out `..` traversal and `/`, which
 * would otherwise let a malicious index.json point `themes/<id>.json`
 * (etc) at an arbitrary path on the same host, e.g. another user's
 * public repo, bypassing the intent that only the pinned
 * `pnyxy-community` repo is trusted. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** `version`s are similarly interpolated into the bundle URL path. */
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;

function assertValidId(id: string, kind: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid registry ${kind} id: ${JSON.stringify(id)}`);
  }
}

function assertValidVersion(version: string): void {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid registry version: ${JSON.stringify(version)}`);
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify `text` against a SHA-256 hex digest when one is present on
 * the index entry. Applies equally to network fetches and cache
 * hits, since `fetchCached` doesn't distinguish the two, everything
 * that reaches this function has already been through the same path.
 * Best-effort: if `crypto.subtle` isn't available (very old browser,
 * non-secure context), the check is skipped rather than blocking use
 * of the registry.
 */
async function verifyIntegrity(
  text: string,
  expectedHex: string,
  label: string,
): Promise<void> {
  if (typeof crypto === "undefined" || !crypto.subtle) return;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const actualHex = bytesToHex(digest);
  if (actualHex.toLowerCase() !== expectedHex.toLowerCase()) {
    throw new Error(
      `Integrity check failed for ${label}: expected sha256:${expectedHex}, got sha256:${actualHex}`,
    );
  }
}

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
  /** Populated by `fetchIndex()`; used opportunistically to look up
   * an entry's `integrity` hash without forcing an extra index fetch
   * for callers that never listed first. */
  private indexCache: RegistryIndex | null = null;

  constructor(opts: GitHubRegistryOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async fetchIndex(): Promise<RegistryIndex> {
    const text = await fetchCached(`${this.baseUrl}/index.json`);
    const parsed = JSON.parse(text) as RegistryIndex;
    if (parsed.apiVersion !== 1) {
      throw new Error(`Unsupported registry apiVersion: ${parsed.apiVersion}`);
    }
    this.indexCache = parsed;
    return parsed;
  }

  /** Best-effort, in-memory only lookup: never triggers a network
   * request on its own, so it's safe to call from every fetch method. */
  private findEntry(
    kind: "plugin" | "theme",
    id: string,
    version?: string,
  ): RegistryIndexEntry | undefined {
    if (!this.indexCache) return undefined;
    const list =
      kind === "theme"
        ? (this.indexCache.themes ?? [])
        : (this.indexCache.plugins ?? []);
    return list.find(
      (e) => e.id === id && (version === undefined || e.version === version),
    );
  }

  async listPlugins(): Promise<RegistryIndexEntry[]> {
    return (await this.fetchIndex()).plugins ?? [];
  }

  async listThemes(): Promise<RegistryIndexEntry[]> {
    return (await this.fetchIndex()).themes ?? [];
  }

  async fetchThemeManifest(id: string): Promise<Theme> {
    assertValidId(id, "theme");
    const text = await fetchCached(`${this.baseUrl}/themes/${id}.json`);
    const entry = this.findEntry("theme", id);
    if (entry?.integrity) {
      await verifyIntegrity(text, entry.integrity, `theme "${id}"`);
    }
    const parsed = JSON.parse(text) as Theme;
    if (parsed.id !== id) {
      throw new Error(
        `Theme manifest id mismatch: requested "${id}", received "${parsed.id}"`,
      );
    }
    return sanitizeTheme(parsed);
  }

  async fetchPluginManifest(id: string): Promise<PluginManifest> {
    assertValidId(id, "plugin");
    const text = await fetchCached(
      `${this.baseUrl}/plugins/${id}/manifest.json`,
    );
    const entry = this.findEntry("plugin", id);
    if (entry?.integrity) {
      await verifyIntegrity(text, entry.integrity, `plugin manifest "${id}"`);
    }
    const parsed = JSON.parse(text) as PluginManifest;
    if (parsed.id !== id) {
      throw new Error(
        `Plugin manifest id mismatch: requested "${id}", received "${parsed.id}"`,
      );
    }
    return parsed;
  }

  async fetchPluginBundle(id: string, version: string): Promise<string> {
    assertValidId(id, "plugin");
    assertValidVersion(version);
    const text = await fetchCached(
      `${this.baseUrl}/plugins/${id}/${version}/plugin.js`,
    );
    const entry = this.findEntry("plugin", id, version);
    if (entry?.integrity) {
      await verifyIntegrity(text, entry.integrity, `plugin bundle "${id}@${version}"`);
    }
    return text;
  }
}
