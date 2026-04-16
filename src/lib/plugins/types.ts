/**
 * Plugin system types.
 *
 * IMPORTANT: every parameter and return value on `PluginAPI` MUST be
 * JSON-serializable. This single rule lets the v1 sandboxed runtime
 * (cross-origin iframe + JSON-RPC) and a future native runtime
 * (dynamic import in-process) share one `PluginAPI` surface without
 * any special-case glue. Functions, DOM nodes, class instances, and
 * non-finite numbers are forbidden as arguments/returns. Use string
 * tokens (e.g. `commandId`) instead of callbacks where possible;
 * subscriptions return numeric handles via the `events.on` shim
 * built host-side.
 */

export type ApiVersion = 1;

export type Permission =
  | "storage"
  | "notifications"
  | "events:reader"
  | "events:book"
  | "commands";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: ApiVersion;
  author: string;
  description: string;
  /** URL of the plugin bundle. Unused for core plugins. */
  entry: string;
  permissions?: Permission[];
  /**
   * Acceptable runtimes. Defaults to `["sandboxed"]`. A future native
   * runtime (Tauri-only) will read this list to opt in.
   */
  runtime?: Array<"sandboxed" | "native">;
}

/** Host events that plugins can subscribe to via `events.on`. */
export type HostEventName =
  | "reader:page-change"
  | "book:opened"
  | "book:closed";

export interface HostEvents {
  "reader:page-change": { docId: string; page: number; from: number };
  "book:opened": { docId: string; title: string };
  "book:closed": { docId: string };
}

export interface PluginAPI {
  app: {
    /** App version string (from package.json at build time). */
    version: string;
  };
  commands: {
    /**
     * Register a command. Plugins reference it by id from the host
     * (e.g. shortcut bindings). The function is called in the plugin
     * runtime when `execute(id)` is invoked.
     */
    register(id: string, label: string): Promise<void>;
    /** Trigger a previously-registered command. */
    execute(id: string): Promise<void>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  notifications: {
    show(message: string): Promise<void>;
  };
  events: {
    /**
     * Subscribe to a host event. Returns a numeric subscription id;
     * pass it to `off` to unsubscribe. (Cannot return a function
     * because everything must round-trip JSON.)
     */
    on(name: HostEventName): Promise<number>;
    off(subscriptionId: number): Promise<void>;
  };
}

/**
 * Lifecycle entry points a plugin module is expected to expose.
 * Only `onLoad` is required; `onUnload` is optional cleanup.
 */
export interface PluginModule {
  onLoad?: (api: PluginAPI, ctx: { manifest: PluginManifest }) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
  /**
   * Map of command id → handler. Populated when `commands.register`
   * is called inside `onLoad`. Used by the host to dispatch
   * `commands.execute` back into the plugin.
   */
  handleCommand?: (id: string) => void | Promise<void>;
  /** Receive a host event. Wired up by the runtime; plugins shouldn't define this manually. */
  handleEvent?: (subscriptionId: number, payload: unknown) => void;
}

/** Thrown host-side when a plugin tries to call a method without permission. */
export class PermissionDeniedError extends Error {
  readonly pluginId: string;
  readonly permission: Permission;
  constructor(pluginId: string, permission: Permission) {
    super(`Plugin "${pluginId}" lacks permission "${permission}".`);
    this.name = "PermissionDeniedError";
    this.pluginId = pluginId;
    this.permission = permission;
  }
}

/** Thrown when the host can't accept a manifest (bad apiVersion etc). */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export const SUPPORTED_API_VERSION: ApiVersion = 1;
