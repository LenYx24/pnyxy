import {
  PermissionDeniedError,
  type Permission,
  type PluginManifest,
} from "../types";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "storage",
  "notifications",
  "events:reader",
  "events:book",
  "commands",
] as const;

/** Throws PermissionDeniedError if the manifest doesn't grant `permission`. */
export function checkPermission(
  manifest: PluginManifest,
  permission: Permission,
): void {
  if (!hasPermission(manifest, permission)) {
    throw new PermissionDeniedError(manifest.id, permission);
  }
}

export function hasPermission(
  manifest: PluginManifest,
  permission: Permission,
): boolean {
  return !!manifest.permissions?.includes(permission);
}
