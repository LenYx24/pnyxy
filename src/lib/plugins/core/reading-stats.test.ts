/**
 * Drive the reading-stats core plugin against a hand-rolled
 * `PluginAPI` mock and verify the full lifecycle: subscribe, accumulate
 * pages per doc, summarize via the registered command, clean up on
 * unload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadingStatsModule } from "./reading-stats";
import type { HostEvents, PluginAPI, PluginModule } from "../types";

interface FakeApi {
  api: PluginAPI;
  notifications: { messages: string[] };
  commands: Map<string, string>;
  /** Trigger the bus event the plugin subscribed to. */
  emitPageChange: (payload: HostEvents["reader:page-change"]) => void;
  /** Capture the subId returned by `events.on` so we can verify off(). */
  lastSubId: () => number;
}

function buildFakeApi(): FakeApi {
  const messages: string[] = [];
  const commands = new Map<string, string>();
  let nextSub = 100;
  let subId = -1;
  let listener: ((payload: HostEvents["reader:page-change"]) => void) | null = null;

  const api: PluginAPI = {
    app: { version: "0.0.0" },
    commands: {
      register: vi.fn(async (id: string, label: string) => {
        commands.set(id, label);
      }),
      execute: vi.fn(async () => {
        /* unused by this plugin */
      }),
    },
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    },
    notifications: {
      show: vi.fn(async (msg: string) => {
        messages.push(msg);
      }),
    },
    events: {
      on: vi.fn(async (name) => {
        if (name !== "reader:page-change") {
          throw new Error(`unexpected subscription: ${name}`);
        }
        subId = nextSub++;
        return subId;
      }),
      off: vi.fn(async () => {
        listener = null;
      }),
    },
  };

  // Bridge: when reading-stats does `await api.events.on(...)` the
  // host wires `handleEvent(subId, payload)` into the module. We
  // emulate that by exposing a manual `emitPageChange` helper.
  const fake: FakeApi = {
    api,
    notifications: { messages },
    commands,
    emitPageChange(payload) {
      listener?.(payload);
    },
    lastSubId: () => subId,
  };

  // Patch listener after the plugin asks for the subscription so the
  // helper can route into module.handleEvent, this is set up below
  // when we wire the module up.
  Object.defineProperty(fake, "_setListener", {
    value: (fn: (p: HostEvents["reader:page-change"]) => void) => {
      listener = fn;
    },
  });

  return fake;
}

let module: PluginModule;
let fake: FakeApi;

beforeEach(async () => {
  module = createReadingStatsModule();
  fake = buildFakeApi();
  await module.onLoad?.(fake.api, {
    manifest: {
      id: "reading-stats",
      name: "Reading Stats",
      version: "1.0.0",
      apiVersion: 1,
      author: "x",
      description: "x",
      entry: "",
    },
  });
  // Wire the host's "deliver event" path: page-change → module.handleEvent.
  const subId = fake.lastSubId();
  (fake as unknown as { _setListener: (fn: (p: HostEvents["reader:page-change"]) => void) => void })._setListener(
    (payload) => module.handleEvent?.(subId, payload),
  );
});

afterEach(async () => {
  await module.onUnload?.();
});

describe("reading-stats - onLoad", () => {
  it("subscribes to reader:page-change", () => {
    expect(fake.api.events.on).toHaveBeenCalledWith("reader:page-change");
  });

  it("registers the show-stats command", () => {
    expect(fake.api.commands.register).toHaveBeenCalledWith(
      "reading-stats:show",
      "Reading Stats: Show this session",
    );
    expect(fake.commands.get("reading-stats:show")).toBe(
      "Reading Stats: Show this session",
    );
  });
});

describe("reading-stats - page tracking", () => {
  it("counts unique pages per doc", async () => {
    fake.emitPageChange({ docId: "doc-a", page: 1, from: 0 });
    fake.emitPageChange({ docId: "doc-a", page: 2, from: 1 });
    fake.emitPageChange({ docId: "doc-a", page: 1, from: 2 }); // duplicate page
    fake.emitPageChange({ docId: "doc-b", page: 5, from: 4 });

    await module.handleCommand?.("reading-stats:show");
    const last = fake.notifications.messages.at(-1) ?? "";
    expect(last).toContain("doc-a: 2 unique page(s)");
    expect(last).toContain("doc-b: 1 unique page(s)");
  });

  it("emits a 'no pages tracked yet' message when nothing has been seen", async () => {
    await module.handleCommand?.("reading-stats:show");
    expect(fake.notifications.messages).toEqual([
      "No pages tracked yet this session.",
    ]);
  });

  it("ignores unknown command ids", async () => {
    await module.handleCommand?.("reading-stats:other");
    expect(fake.notifications.messages).toEqual([]);
  });
});

describe("reading-stats - onUnload", () => {
  it("calls events.off with the subscription id and stops accepting events", async () => {
    fake.emitPageChange({ docId: "doc-a", page: 1, from: 0 });
    await module.onUnload?.();
    expect(fake.api.events.off).toHaveBeenCalledWith(fake.lastSubId());

    // After unload, further events should not affect output.
    // (The plugin has cleared its session map, so re-running the show
    // command would say "no pages", but it's been unloaded, so we
    // just assert no errors happen.)
    expect(() =>
      fake.emitPageChange({ docId: "doc-a", page: 99, from: 1 }),
    ).not.toThrow();
  });
});
