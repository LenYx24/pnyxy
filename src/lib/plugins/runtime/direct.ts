import type { PluginAPI, PluginManifest, PluginModule } from "../types";
import type { PluginHandle, PluginRuntime } from "./types";

/**
 * In-process runtime for **core** plugins. The plugin module is
 * imported as part of the bundle (no fetch, no iframe, no JSON-RPC
 * boundary). Lifecycle calls go directly to the module's exports.
 *
 * Existence of this runtime keeps community and core plugins on the
 * same lifecycle/manager code path — only the call mechanism differs.
 */
export class DirectRuntime implements PluginRuntime {
  readonly kind = "direct" as const;

  async load(opts: {
    manifest: PluginManifest;
    bundle: string | null;
    coreModule?: PluginModule;
    api: PluginAPI;
  }): Promise<PluginHandle> {
    const { manifest, coreModule, api } = opts;
    if (!coreModule) {
      throw new Error(
        `DirectRuntime requires coreModule for plugin "${manifest.id}"`,
      );
    }

    await coreModule.onLoad?.(api, { manifest });

    return {
      manifest,
      async destroy() {
        await coreModule.onUnload?.();
      },
      deliverEvent(subscriptionId, payload) {
        coreModule.handleEvent?.(subscriptionId, payload);
      },
      async invokeCommand(commandId) {
        await coreModule.handleCommand?.(commandId);
      },
    };
  }
}
