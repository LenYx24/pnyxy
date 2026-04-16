import type { Theme } from "@/lib/themes";
import type { PluginManifest } from "@/lib/plugins";
import type {
  RegistryIndexEntry,
  RegistryProvider,
  RegistryStatus,
} from "./types";

type StatusListener = (status: RegistryStatus) => void;

/**
 * Tries the primary registry first; on failure or timeout, falls back
 * to the bundled registry and emits an "offline" status. Status is
 * reset to online on the next successful primary call.
 */
export class CompositeRegistry implements RegistryProvider {
  readonly label = "composite";
  private status: RegistryStatus = { offline: false };
  private readonly listeners = new Set<StatusListener>();
  private readonly primary: RegistryProvider;
  private readonly fallback: RegistryProvider;

  constructor(primary: RegistryProvider, fallback: RegistryProvider) {
    this.primary = primary;
    this.fallback = fallback;
  }

  getStatus(): RegistryStatus {
    return this.status;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(next: RegistryStatus): void {
    if (
      this.status.offline === next.offline &&
      this.status.primaryError === next.primaryError
    ) {
      return;
    }
    this.status = next;
    for (const l of this.listeners) l(this.status);
  }

  private async tryPrimary<T>(fn: (p: RegistryProvider) => Promise<T>): Promise<T> {
    try {
      const result = await fn(this.primary);
      this.setStatus({ offline: false });
      return result;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.setStatus({ offline: true, primaryError: message });
      return fn(this.fallback);
    }
  }

  listPlugins(): Promise<RegistryIndexEntry[]> {
    return this.tryPrimary((p) => p.listPlugins());
  }

  listThemes(): Promise<RegistryIndexEntry[]> {
    return this.tryPrimary((p) => p.listThemes());
  }

  fetchThemeManifest(id: string): Promise<Theme> {
    return this.tryPrimary((p) => p.fetchThemeManifest(id));
  }

  fetchPluginManifest(id: string): Promise<PluginManifest> {
    return this.tryPrimary((p) => p.fetchPluginManifest(id));
  }

  fetchPluginBundle(id: string, version: string): Promise<string> {
    return this.tryPrimary((p) => p.fetchPluginBundle(id, version));
  }
}
