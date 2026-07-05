import { useSettingsStore } from "@/stores/settings-store";
import { hostEventBus } from "./api/events";
import { buildHostApi, type CommandRegistry, type NotificationSink, type PluginStorageAdapter } from "./api/host-api";
import { CORE_PLUGINS, type CorePluginEntry } from "./core-registry";
import { DirectRuntime } from "./runtime/direct";
import { SandboxedRuntime } from "./runtime/sandboxed";
import type { PluginHandle, PluginRuntime } from "./runtime/types";
import {
  ManifestError,
  SUPPORTED_API_VERSION,
  type PluginManifest,
} from "./types";

const APP_VERSION = "0.0.0";

export interface PluginLoadStatus {
  pluginId: string;
  state: "loaded" | "error" | "unloaded";
  error?: string;
}

type StatusListener = (statuses: ReadonlyMap<string, PluginLoadStatus>) => void;

/**
 * Owns the lifecycle of every loaded plugin. Subscribes to settings
 * changes and reconciles enable/disable state on its own, callers
 * just toggle `enabledPlugins` and the manager catches up.
 */
export class PluginManager {
  private readonly handles = new Map<string, PluginHandle>();
  private readonly disposeApis = new Map<string, () => void>();
  private readonly statuses = new Map<string, PluginLoadStatus>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly directRuntime = new DirectRuntime();
  private readonly sandboxedRuntime = new SandboxedRuntime();
  private readonly commands: CommandRegistry;
  private readonly storageAdapter: PluginStorageAdapter;
  private readonly notifications: NotificationSink;
  private reconcilePromise: Promise<void> | null = null;
  /** Pending re-reconcile when one is already in flight. */
  private pendingReconcile = false;

  constructor() {
    this.commands = createCommandRegistry(this);
    this.storageAdapter = createStorageAdapter();
    this.notifications = createNotificationSink();
  }

  getStatuses(): ReadonlyMap<string, PluginLoadStatus> {
    return this.statuses;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.statuses);
    return () => this.statusListeners.delete(listener);
  }

  listCommands() {
    return this.commands.list();
  }

  async executeCommand(commandId: string): Promise<void> {
    await this.commands.execute(commandId);
  }

  /** Compute target enable-set and load/unload to match. */
  async reconcile(): Promise<void> {
    if (this.reconcilePromise) {
      this.pendingReconcile = true;
      return this.reconcilePromise;
    }
    const run = async () => {
      try {
        await this.reconcileOnce();
      } finally {
        this.reconcilePromise = null;
        if (this.pendingReconcile) {
          this.pendingReconcile = false;
          await this.reconcile();
        }
      }
    };
    this.reconcilePromise = run();
    return this.reconcilePromise;
  }

  private async reconcileOnce(): Promise<void> {
    const state = useSettingsStore.getState();
    const enabled = state.enabledPlugins;
    const installed = state.installedPlugins;

    const targetIds = new Set<string>();
    for (const [id, on] of Object.entries(enabled)) {
      if (on) targetIds.add(id);
    }

    // Unload plugins that are no longer enabled.
    for (const id of Array.from(this.handles.keys())) {
      if (!targetIds.has(id)) {
        await this.disable(id);
      }
    }

    // Load plugins that should be enabled but aren't yet.
    for (const id of targetIds) {
      if (this.handles.has(id)) continue;
      try {
        const core = (CORE_PLUGINS as Record<string, CorePluginEntry>)[id];
        if (core) {
          await this.loadCore(id, core);
        } else {
          const pkg = installed[id];
          if (!pkg) {
            this.setStatus(id, {
              pluginId: id,
              state: "error",
              error: "Plugin is enabled but not installed.",
            });
            continue;
          }
          await this.loadCommunity(id, pkg.manifest, pkg.bundle);
        }
      } catch (err) {
        const e = err as Error;
        this.setStatus(id, { pluginId: id, state: "error", error: e.message });
      }
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    useSettingsStore.getState().setPluginEnabled(id, enabled);
    await this.reconcile();
  }

  async reload(id: string): Promise<void> {
    await this.disable(id);
    await this.reconcile();
  }

  private async loadCore(id: string, entry: CorePluginEntry): Promise<void> {
    this.checkManifest(entry.manifest);
    const { api, dispose } = buildHostApi({
      manifest: entry.manifest,
      appVersion: APP_VERSION,
      storage: this.storageAdapter,
      hostEventBus,
      notifications: this.notifications,
      commands: this.commands,
      deliverEvent: (subId, payload) => {
        const handle = this.handles.get(id);
        handle?.deliverEvent(subId, payload);
      },
    });
    const handle = await this.directRuntime.load({
      manifest: entry.manifest,
      bundle: null,
      coreModule: entry.module,
      api,
    });
    this.handles.set(id, handle);
    this.disposeApis.set(id, dispose);
    this.setStatus(id, { pluginId: id, state: "loaded" });
  }

  private async loadCommunity(
    id: string,
    manifest: PluginManifest,
    bundle: string,
  ): Promise<void> {
    this.checkManifest(manifest);
    const runtime: PluginRuntime = this.sandboxedRuntime;
    const { api, dispose } = buildHostApi({
      manifest,
      appVersion: APP_VERSION,
      storage: this.storageAdapter,
      hostEventBus,
      notifications: this.notifications,
      commands: this.commands,
      deliverEvent: (subId, payload) => {
        const handle = this.handles.get(id);
        handle?.deliverEvent(subId, payload);
      },
    });
    const handle = await runtime.load({ manifest, bundle, api });
    this.handles.set(id, handle);
    this.disposeApis.set(id, dispose);
    this.setStatus(id, { pluginId: id, state: "loaded" });
  }

  private async disable(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) return;
    try {
      await handle.destroy();
    } catch (err) {
      console.error(`[plugin] destroy failed for ${id}:`, err);
    }
    this.handles.delete(id);
    const dispose = this.disposeApis.get(id);
    dispose?.();
    this.disposeApis.delete(id);
    this.setStatus(id, { pluginId: id, state: "unloaded" });
  }

  private checkManifest(manifest: PluginManifest): void {
    if (manifest.apiVersion !== SUPPORTED_API_VERSION) {
      throw new ManifestError(
        `Plugin "${manifest.id}" requires API v${manifest.apiVersion}; this build only supports v${SUPPORTED_API_VERSION}.`,
      );
    }
  }

  private setStatus(id: string, status: PluginLoadStatus): void {
    this.statuses.set(id, status);
    for (const listener of this.statusListeners) listener(this.statuses);
  }

  /** Look up a handle (used by the command registry). */
  getHandle(pluginId: string): PluginHandle | undefined {
    return this.handles.get(pluginId);
  }
}

// Adapters wired into the singleton settings store

function createCommandRegistry(manager: PluginManager): CommandRegistry {
  const cmds = new Map<string, { pluginId: string; label: string }>();
  return {
    register(pluginId, commandId, label) {
      cmds.set(commandId, { pluginId, label });
    },
    unregisterAllForPlugin(pluginId) {
      for (const [id, info] of cmds) {
        if (info.pluginId === pluginId) cmds.delete(id);
      }
    },
    async execute(commandId) {
      const info = cmds.get(commandId);
      if (!info) throw new Error(`Unknown command: ${commandId}`);
      const handle = manager.getHandle(info.pluginId);
      if (!handle) throw new Error(`Plugin not loaded: ${info.pluginId}`);
      await handle.invokeCommand(commandId);
    },
    list() {
      return Array.from(cmds.entries()).map(([commandId, info]) => ({
        commandId,
        pluginId: info.pluginId,
        label: info.label,
      }));
    },
  };
}

function createStorageAdapter(): PluginStorageAdapter {
  const storeKey = (pluginId: string, key: string) =>
    `plugin:${pluginId}:${key}`;
  const settings = () => useSettingsStore.getState();
  return {
    async get(pluginId, key) {
      const all = settings().pluginStorage;
      return all[storeKey(pluginId, key)];
    },
    async set(pluginId, key, value) {
      settings().setPluginStorage(storeKey(pluginId, key), value);
    },
    async remove(pluginId, key) {
      settings().removePluginStorage(storeKey(pluginId, key));
    },
    async keys(pluginId) {
      const prefix = `plugin:${pluginId}:`;
      return Object.keys(settings().pluginStorage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
  };
}

function createNotificationSink(): NotificationSink {
  return {
    show(pluginId, message) {
      // Simple console-backed sink; the plugins UI can subscribe via
      // `getRecentNotifications()` if it wants a richer presentation.
      console.info(`[plugin:${pluginId}] ${message}`);
      try {
        window.dispatchEvent(
          new CustomEvent("pnyxy:plugin-notification", {
            detail: { pluginId, message },
          }),
        );
      } catch {
        // ignore
      }
    },
  };
}
