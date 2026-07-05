// Every param/return on PluginAPI must be JSON-serializable (it round-trips
// over JSON-RPC to a cross-origin iframe). No functions/DOM nodes/class
// instances/non-finite numbers. Use string tokens instead of callbacks.

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
  /** Acceptable runtimes. Defaults to ["sandboxed"]. */
  runtime?: Array<"sandboxed" | "native">;
  /** Enabled out of the box for new users (read by settings-store migration). */
  defaultEnabled?: boolean;
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
    /** Register a command; host references it by id. Runs in-runtime on execute(id). */
    register(id: string, label: string): Promise<void>;
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
    /** Subscribe; returns a numeric id (not a function, must be JSON) to pass to off. */
    on(name: HostEventName): Promise<number>;
    off(subscriptionId: number): Promise<void>;
  };
}

/** Lifecycle entry points a plugin module exposes. Only onLoad is required. */
export interface PluginModule {
  onLoad?: (api: PluginAPI, ctx: { manifest: PluginManifest }) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
  /** Dispatches commands.execute back into the plugin by id. */
  handleCommand?: (id: string) => void | Promise<void>;
  /** Wired up by the runtime; plugins shouldn't define this manually. */
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
