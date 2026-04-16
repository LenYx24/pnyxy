import type { PluginAPI, PluginManifest, PluginModule } from "../types";

/** Opaque handle returned by `PluginRuntime.load`. */
export interface PluginHandle {
  manifest: PluginManifest;
  /** Tear down everything the runtime allocated for this plugin. */
  destroy(): Promise<void>;
  /**
   * Dispatch a host-originated event to the plugin runtime. Used by
   * the manager when `PluginAPI.events.on` returned a subscription
   * and the host bus fires.
   */
  deliverEvent(subscriptionId: number, payload: unknown): void;
  /** Ask the plugin to run a command it previously registered. */
  invokeCommand(commandId: string): Promise<void>;
}

export interface PluginRuntime {
  readonly kind: "sandboxed" | "native" | "direct";
  /**
   * Load the bundle. `bundle` is the JS source as a string
   * (sandboxed/native may load a URL but the host always fetches
   * first so all runtimes consume identical input). For core
   * plugins, `bundle` is `null` and `coreModule` provides the
   * implementation directly.
   */
  load(opts: {
    manifest: PluginManifest;
    bundle: string | null;
    coreModule?: PluginModule;
    api: PluginAPI;
  }): Promise<PluginHandle>;
}
