import type {
  HostEventName,
  PluginAPI,
  PluginManifest,
} from "../types";
import { checkPermission } from "./permissions";
import type { HostEventBus } from "./events";

/**
 * Backing storage for `PluginAPI.storage`. The host provides a
 * single namespaced view per plugin; the actual implementation
 * lives in the settings store via `pluginStorage`.
 */
export interface PluginStorageAdapter {
  get(pluginId: string, key: string): Promise<unknown>;
  set(pluginId: string, key: string, value: unknown): Promise<void>;
  remove(pluginId: string, key: string): Promise<void>;
  keys(pluginId: string): Promise<string[]>;
}

export interface CommandRegistry {
  /** Register a plugin-owned command. The host stores `{pluginId, label}` and dispatches via `executeForPlugin`. */
  register(pluginId: string, commandId: string, label: string): void;
  unregisterAllForPlugin(pluginId: string): void;
  /** Run any registered command (host-side dispatch — used by shortcuts/UI). */
  execute(commandId: string): Promise<void>;
  list(): Array<{ commandId: string; pluginId: string; label: string }>;
}

export interface NotificationSink {
  show(pluginId: string, message: string): void;
}

export interface BuildHostApiOptions {
  manifest: PluginManifest;
  appVersion: string;
  storage: PluginStorageAdapter;
  hostEventBus: HostEventBus;
  notifications: NotificationSink;
  commands: CommandRegistry;
  /** Bridge: deliver an event payload to the plugin runtime by subscription id. */
  deliverEvent: (subscriptionId: number, payload: unknown) => void;
}

/**
 * Build a `PluginAPI` proxy that enforces permissions host-side and
 * routes side effects through the supplied adapters. Every method
 * round-trips through `JSON.stringify` shapes so the same surface
 * works in the sandboxed iframe and (future) native runtimes.
 *
 * Returns both the API and a `dispose` to be called when the plugin
 * is unloaded — releases event subscriptions and registered commands.
 */
export function buildHostApi(opts: BuildHostApiOptions): {
  api: PluginAPI;
  dispose: () => void;
} {
  const { manifest } = opts;
  const subscriptions = new Map<number, () => void>();
  let nextSubId = 1;

  const eventNameToPermission = (name: HostEventName) =>
    name.startsWith("reader:")
      ? "events:reader"
      : name.startsWith("book:")
        ? "events:book"
        : null;

  const api: PluginAPI = {
    app: { version: opts.appVersion },

    commands: {
      async register(id, label) {
        checkPermission(manifest, "commands");
        if (typeof id !== "string" || typeof label !== "string") {
          throw new TypeError("commands.register requires string id and label");
        }
        opts.commands.register(manifest.id, id, label);
      },
      async execute(id) {
        checkPermission(manifest, "commands");
        if (typeof id !== "string") {
          throw new TypeError("commands.execute requires string id");
        }
        await opts.commands.execute(id);
      },
    },

    storage: {
      async get(key) {
        checkPermission(manifest, "storage");
        return opts.storage.get(manifest.id, key);
      },
      async set(key, value) {
        checkPermission(manifest, "storage");
        // Round-trip through JSON to enforce serializability up front
        // and match the sandboxed-runtime semantics.
        const safe = JSON.parse(JSON.stringify(value)) as unknown;
        await opts.storage.set(manifest.id, key, safe);
      },
      async remove(key) {
        checkPermission(manifest, "storage");
        await opts.storage.remove(manifest.id, key);
      },
      async keys() {
        checkPermission(manifest, "storage");
        return opts.storage.keys(manifest.id);
      },
    },

    notifications: {
      async show(message) {
        checkPermission(manifest, "notifications");
        if (typeof message !== "string") {
          throw new TypeError("notifications.show requires a string message");
        }
        opts.notifications.show(manifest.id, message);
      },
    },

    events: {
      async on(name) {
        const perm = eventNameToPermission(name);
        if (!perm) throw new TypeError(`Unknown event: ${name}`);
        checkPermission(manifest, perm);
        const subId = nextSubId++;
        const unsub = opts.hostEventBus.on(name, (payload) => {
          // Round-trip through JSON for parity with the sandboxed
          // runtime (postMessage clones structurally, but JSON
          // matches our "JSON-only" contract more strictly).
          const safe = JSON.parse(JSON.stringify(payload)) as unknown;
          opts.deliverEvent(subId, safe);
        });
        subscriptions.set(subId, unsub);
        return subId;
      },
      async off(subscriptionId) {
        const unsub = subscriptions.get(subscriptionId);
        if (unsub) {
          unsub();
          subscriptions.delete(subscriptionId);
        }
      },
    },
  };

  const dispose = () => {
    for (const unsub of subscriptions.values()) unsub();
    subscriptions.clear();
    opts.commands.unregisterAllForPlugin(manifest.id);
  };

  return { api, dispose };
}
