import { BundledFallbackRegistry } from "./bundled-registry";
import { CompositeRegistry } from "./composite-registry";
import { GitHubRegistry } from "./github-registry";
import type { RegistryProvider } from "./types";

export type {
  RegistryIndex,
  RegistryIndexEntry,
  RegistryProvider,
  RegistryStatus,
} from "./types";
export { GitHubRegistry } from "./github-registry";
export { BundledFallbackRegistry } from "./bundled-registry";
export { CompositeRegistry } from "./composite-registry";

let cached: CompositeRegistry | null = null;

/** Singleton composite registry — GitHub primary + bundled fallback. */
export function getRegistry(): CompositeRegistry {
  if (!cached) {
    const primary: RegistryProvider = new GitHubRegistry();
    const fallback: RegistryProvider = new BundledFallbackRegistry();
    cached = new CompositeRegistry(primary, fallback);
  }
  return cached;
}
