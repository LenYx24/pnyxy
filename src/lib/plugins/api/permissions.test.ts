import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, checkPermission, hasPermission } from "./permissions";
import { PermissionDeniedError, type PluginManifest } from "../types";

function manifest(perms: PluginManifest["permissions"]): PluginManifest {
  return {
    id: "test",
    name: "Test",
    version: "1.0.0",
    apiVersion: 1,
    author: "x",
    description: "x",
    entry: "",
    permissions: perms,
  };
}

describe("ALL_PERMISSIONS", () => {
  it("lists every permission the host enforces", () => {
    expect(ALL_PERMISSIONS).toEqual([
      "storage",
      "notifications",
      "events:reader",
      "events:book",
      "commands",
    ]);
  });
});

describe("hasPermission", () => {
  it("returns true when the manifest grants the permission", () => {
    expect(hasPermission(manifest(["storage"]), "storage")).toBe(true);
    expect(
      hasPermission(manifest(["storage", "commands"]), "commands"),
    ).toBe(true);
  });

  it("returns false when the manifest does not grant the permission", () => {
    expect(hasPermission(manifest(["storage"]), "commands")).toBe(false);
  });

  it("returns false when the manifest has no permissions field at all", () => {
    expect(hasPermission(manifest(undefined), "storage")).toBe(false);
  });

  it("returns false for an empty permissions array", () => {
    expect(hasPermission(manifest([]), "storage")).toBe(false);
  });
});

describe("checkPermission", () => {
  it("does nothing when the permission is granted", () => {
    expect(() => checkPermission(manifest(["storage"]), "storage")).not.toThrow();
  });

  it("throws PermissionDeniedError carrying both pluginId and permission", () => {
    const m = manifest(["storage"]);
    try {
      checkPermission(m, "commands");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionDeniedError);
      const pe = err as PermissionDeniedError;
      expect(pe.pluginId).toBe(m.id);
      expect(pe.permission).toBe("commands");
      expect(pe.name).toBe("PermissionDeniedError");
      expect(pe.message).toContain(m.id);
      expect(pe.message).toContain("commands");
    }
  });

  it("throws when the manifest has no permissions field", () => {
    expect(() =>
      checkPermission(manifest(undefined), "storage"),
    ).toThrow(PermissionDeniedError);
  });
});
