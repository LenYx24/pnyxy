export {
  CORE_PLUGINS,
  buildDefaultPluginSettings,
  getPluginManifest,
} from "./core-registry";
export type { CorePluginId, CorePluginEntry } from "./core-registry";
export { PluginManager } from "./manager";
export type { PluginLoadStatus } from "./manager";
export { hostEventBus } from "./api/events";
export { ALL_PERMISSIONS } from "./api/permissions";
export type {
  ApiVersion,
  HostEventName,
  HostEvents,
  Permission,
  PluginAPI,
  PluginManifest,
  PluginModule,
} from "./types";
export {
  ManifestError,
  PermissionDeniedError,
  SUPPORTED_API_VERSION,
} from "./types";
