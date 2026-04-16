import { describe, expect, it, vi } from "vitest";
import { buildHostApi, type CommandRegistry, type NotificationSink, type PluginStorageAdapter } from "./host-api";
import { HostEventBus } from "./events";
import { PermissionDeniedError, type Permission, type PluginManifest } from "../types";

function manifest(perms: Permission[] = []): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    apiVersion: 1,
    author: "x",
    description: "x",
    entry: "",
    permissions: perms,
  };
}

function makeStorage(): PluginStorageAdapter {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
  };
}

function makeCommands(): CommandRegistry {
  return {
    register: vi.fn(),
    unregisterAllForPlugin: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockReturnValue([]),
  };
}

function makeNotifications(): NotificationSink {
  return { show: vi.fn() };
}

function build(perms: Permission[] = [], deliverEvent = vi.fn()) {
  const storage = makeStorage();
  const commands = makeCommands();
  const notifications = makeNotifications();
  const hostEventBus = new HostEventBus();
  const m = manifest(perms);
  const { api, dispose } = buildHostApi({
    manifest: m,
    appVersion: "1.2.3",
    storage,
    hostEventBus,
    notifications,
    commands,
    deliverEvent,
  });
  return { api, dispose, storage, commands, notifications, hostEventBus, manifest: m };
}

describe("buildHostApi — app", () => {
  it("exposes the app version verbatim", () => {
    const { api } = build();
    expect(api.app.version).toBe("1.2.3");
  });
});

describe("buildHostApi — storage", () => {
  it("requires the 'storage' permission", async () => {
    const { api } = build([]);
    await expect(api.storage.get("k")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(api.storage.set("k", 1)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(api.storage.remove("k")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(api.storage.keys()).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("forwards calls to the adapter with the plugin id namespaced", async () => {
    const { api, storage } = build(["storage"]);
    await api.storage.set("foo", "bar");
    expect(storage.set).toHaveBeenCalledWith("test-plugin", "foo", "bar");
    await api.storage.get("foo");
    expect(storage.get).toHaveBeenCalledWith("test-plugin", "foo");
    await api.storage.remove("foo");
    expect(storage.remove).toHaveBeenCalledWith("test-plugin", "foo");
    await api.storage.keys();
    expect(storage.keys).toHaveBeenCalledWith("test-plugin");
  });

  it("strips non-JSON-serializable values from storage.set", async () => {
    const { api, storage } = build(["storage"]);
    const dirty = { keep: "ok", drop: () => "no" };
    await api.storage.set("k", dirty);
    expect(storage.set).toHaveBeenCalledTimes(1);
    const passed = (storage.set as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(passed).toEqual({ keep: "ok" });
  });
});

describe("buildHostApi — notifications", () => {
  it("requires the 'notifications' permission", async () => {
    const { api } = build([]);
    await expect(api.notifications.show("hi")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("forwards string messages to the sink", async () => {
    const { api, notifications } = build(["notifications"]);
    await api.notifications.show("hello");
    expect(notifications.show).toHaveBeenCalledWith("test-plugin", "hello");
  });

  it("rejects non-string messages with a TypeError", async () => {
    const { api } = build(["notifications"]);
    await expect(
      // @ts-expect-error — intentionally calling with a wrong type
      api.notifications.show(42),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("buildHostApi — commands", () => {
  it("requires the 'commands' permission for both register and execute", async () => {
    const { api } = build([]);
    await expect(api.commands.register("a", "A")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(api.commands.execute("a")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("registers and executes via the host registry", async () => {
    const { api, commands } = build(["commands"]);
    await api.commands.register("cmd:greet", "Greet");
    expect(commands.register).toHaveBeenCalledWith(
      "test-plugin",
      "cmd:greet",
      "Greet",
    );
    await api.commands.execute("cmd:greet");
    expect(commands.execute).toHaveBeenCalledWith("cmd:greet");
  });

  it("rejects non-string ids with a TypeError", async () => {
    const { api } = build(["commands"]);
    await expect(
      // @ts-expect-error — intentionally wrong type
      api.commands.register(1, "x"),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      // @ts-expect-error — intentionally wrong type
      api.commands.execute(1),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("buildHostApi — events", () => {
  it("requires events:reader for reader:page-change", async () => {
    const { api } = build([]);
    await expect(api.events.on("reader:page-change")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("requires events:book for book:opened/closed", async () => {
    const { api } = build([]);
    await expect(api.events.on("book:opened")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(api.events.on("book:closed")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("returns sequential numeric subscription ids", async () => {
    const { api } = build(["events:book"]);
    const id1 = await api.events.on("book:opened");
    const id2 = await api.events.on("book:closed");
    expect(typeof id1).toBe("number");
    expect(typeof id2).toBe("number");
    expect(id2).toBeGreaterThan(id1);
  });

  it("delivers emitted bus events through deliverEvent with the right id", async () => {
    const deliver = vi.fn();
    const { api, hostEventBus } = build(["events:book"], deliver);
    const subId = await api.events.on("book:opened");
    hostEventBus.emit("book:opened", { docId: "x", title: "T" });
    expect(deliver).toHaveBeenCalledWith(subId, { docId: "x", title: "T" });
  });

  it("events.off stops delivery for that subscription only", async () => {
    const deliver = vi.fn();
    const { api, hostEventBus } = build(["events:book"], deliver);
    const sub1 = await api.events.on("book:opened");
    const sub2 = await api.events.on("book:opened");
    await api.events.off(sub1);
    hostEventBus.emit("book:opened", { docId: "x", title: "T" });
    // Only sub2 should have received the payload.
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(sub2, { docId: "x", title: "T" });
  });

  it("events.off on an unknown id is a silent no-op", async () => {
    const { api } = build(["events:book"]);
    await expect(api.events.off(9999)).resolves.toBeUndefined();
  });

  it("rejects unknown event names with a TypeError", async () => {
    const { api } = build(["events:book", "events:reader"]);
    await expect(
      // @ts-expect-error — intentionally bogus event name
      api.events.on("something:weird"),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("buildHostApi — dispose", () => {
  it("dispose unsubscribes every event subscription", async () => {
    const deliver = vi.fn();
    const { api, hostEventBus, dispose } = build(["events:book"], deliver);
    await api.events.on("book:opened");
    await api.events.on("book:closed");
    dispose();
    hostEventBus.emit("book:opened", { docId: "x", title: "T" });
    hostEventBus.emit("book:closed", { docId: "x" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("dispose unregisters the plugin's commands from the host registry", () => {
    const { commands, dispose, manifest: m } = build(["commands"]);
    dispose();
    expect(commands.unregisterAllForPlugin).toHaveBeenCalledWith(m.id);
  });
});
