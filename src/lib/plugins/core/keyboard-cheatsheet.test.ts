/**
 * Keyboard cheatsheet plugin: registers a command, listens for `?` to
 * toggle a DOM overlay. Tested against the happy-dom DOM and a fake
 * `PluginAPI`.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createKeyboardCheatsheetModule } from "./keyboard-cheatsheet";
import type { PluginAPI, PluginModule } from "../types";

const OVERLAY_ID = "plugin-keyboard-cheatsheet-overlay";

function buildFakeApi() {
  const registered: Array<[string, string]> = [];
  const api: PluginAPI = {
    app: { version: "0.0.0" },
    commands: {
      register: vi.fn(async (id: string, label: string) => {
        registered.push([id, label]);
      }),
      execute: vi.fn(async () => {}),
    },
    storage: {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    },
    notifications: {
      show: vi.fn(async () => {}),
    },
    events: {
      on: vi.fn(async () => -1),
      off: vi.fn(async () => {}),
    },
  };
  return { api, registered };
}

let module: PluginModule;
let fake: ReturnType<typeof buildFakeApi>;

beforeEach(async () => {
  // Reset DOM and re-create module fresh.
  document.body.innerHTML = "";
  module = createKeyboardCheatsheetModule();
  fake = buildFakeApi();
  await module.onLoad?.(fake.api, {
    manifest: {
      id: "keyboard-cheatsheet",
      name: "Keyboard Cheatsheet",
      version: "1.0.0",
      apiVersion: 1,
      author: "x",
      description: "x",
      entry: "",
    },
  });
});

afterEach(async () => {
  await module.onUnload?.();
  document.body.innerHTML = "";
});

describe("keyboard-cheatsheet — onLoad", () => {
  it("registers the toggle-cheatsheet command", () => {
    expect(fake.registered).toEqual([
      ["keyboard-cheatsheet:show", "Keyboard: Toggle cheatsheet"],
    ]);
  });

  it("does not show the overlay until the command runs or `?` is pressed", () => {
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });
});

describe("keyboard-cheatsheet — command handler", () => {
  it("appends the overlay to the body on first invocation", async () => {
    await module.handleCommand?.("keyboard-cheatsheet:show");
    expect(document.getElementById(OVERLAY_ID)).not.toBeNull();
  });

  it("toggles the overlay off on a second invocation", async () => {
    await module.handleCommand?.("keyboard-cheatsheet:show");
    await module.handleCommand?.("keyboard-cheatsheet:show");
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });

  it("ignores unknown command ids", async () => {
    await module.handleCommand?.("some:other:command");
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });
});

describe("keyboard-cheatsheet — `?` keyboard listener", () => {
  it("opens the overlay when `?` is pressed outside an input", () => {
    const event = new KeyboardEvent("keydown", { key: "?" });
    window.dispatchEvent(event);
    expect(document.getElementById(OVERLAY_ID)).not.toBeNull();
  });

  it("does NOT open the overlay when `?` is pressed inside an <input>", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent("keydown", { key: "?" });
    Object.defineProperty(event, "target", { value: input });
    window.dispatchEvent(event);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });

  it("does NOT open the overlay when `?` is pressed inside a <textarea>", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    const event = new KeyboardEvent("keydown", { key: "?" });
    Object.defineProperty(event, "target", { value: ta });
    window.dispatchEvent(event);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });
});

describe("keyboard-cheatsheet — onUnload", () => {
  it("removes the overlay from the DOM", async () => {
    await module.handleCommand?.("keyboard-cheatsheet:show");
    expect(document.getElementById(OVERLAY_ID)).not.toBeNull();
    await module.onUnload?.();
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
  });

  it("removes the keydown listener so further `?` presses are ignored", async () => {
    await module.onUnload?.();
    const event = new KeyboardEvent("keydown", { key: "?" });
    window.dispatchEvent(event);
    expect(document.getElementById(OVERLAY_ID)).toBeNull();
    // Mark module so the afterEach unload is a no-op.
    module = { onUnload: async () => {} };
  });
});
