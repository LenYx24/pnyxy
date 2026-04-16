/**
 * Tests for the global keyboard shortcut registry. The module attaches
 * a single window keydown listener lazily on first register; we drive
 * it via real KeyboardEvent dispatches against happy-dom's window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRegisteredShortcuts,
  registerShortcut,
  unregisterShortcut,
} from "./keyboard-shortcuts";

function dispatch(
  init: KeyboardEventInit & { key: string },
  target?: EventTarget,
) {
  const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
  if (target) {
    Object.defineProperty(event, "target", { value: target });
  }
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  // The module keeps a singleton Map; clear it between tests so that
  // shortcut state from one test does not leak into the next.
  for (const id of Array.from(getRegisteredShortcuts().keys())) {
    unregisterShortcut(id);
  }
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const id of Array.from(getRegisteredShortcuts().keys())) {
    unregisterShortcut(id);
  }
});

describe("registerShortcut / unregisterShortcut", () => {
  it("invokes the handler when the matching key is pressed", () => {
    const handler = vi.fn();
    registerShortcut({ id: "s1", key: "a", handler });
    dispatch({ key: "a" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("matches keys case-insensitively", () => {
    const handler = vi.fn();
    registerShortcut({ id: "s1", key: "A", handler });
    dispatch({ key: "a" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls preventDefault by default", () => {
    registerShortcut({ id: "s1", key: "x", handler: () => {} });
    const e = dispatch({ key: "x" });
    expect(e.defaultPrevented).toBe(true);
  });

  it("does NOT call preventDefault when preventDefault is false", () => {
    registerShortcut({
      id: "s1",
      key: "x",
      preventDefault: false,
      handler: () => {},
    });
    const e = dispatch({ key: "x" });
    expect(e.defaultPrevented).toBe(false);
  });

  it("unregisterShortcut stops the handler from firing", () => {
    const handler = vi.fn();
    registerShortcut({ id: "s1", key: "a", handler });
    unregisterShortcut("s1");
    dispatch({ key: "a" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("re-registering the same id replaces the previous handler", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerShortcut({ id: "s1", key: "a", handler: a });
    registerShortcut({ id: "s1", key: "a", handler: b });
    dispatch({ key: "a" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("modifier matching", () => {
  it("treats meta and ctrl as the same modifier", () => {
    const handler = vi.fn();
    registerShortcut({ id: "save", key: "s", ctrl: true, handler });
    dispatch({ key: "s", ctrlKey: true });
    dispatch({ key: "s", metaKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("requires ctrl when ctrl: true and ignores plain keypress", () => {
    const handler = vi.fn();
    registerShortcut({ id: "save", key: "s", ctrl: true, handler });
    dispatch({ key: "s" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects ctrl when shortcut omits ctrl: true", () => {
    const handler = vi.fn();
    registerShortcut({ id: "plain", key: "s", handler });
    dispatch({ key: "s", ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires shift when shift: true", () => {
    const handler = vi.fn();
    registerShortcut({ id: "shifted", key: "f", shift: true, handler });
    dispatch({ key: "f" });
    expect(handler).not.toHaveBeenCalled();
    dispatch({ key: "f", shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("requires alt when alt: true", () => {
    const handler = vi.fn();
    registerShortcut({ id: "alted", key: "f", alt: true, handler });
    dispatch({ key: "f" });
    expect(handler).not.toHaveBeenCalled();
    dispatch({ key: "f", altKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("requires the exact combination of all modifiers", () => {
    const handler = vi.fn();
    registerShortcut({
      id: "combo",
      key: "p",
      ctrl: true,
      shift: true,
      handler,
    });
    dispatch({ key: "p", ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
    dispatch({ key: "p", ctrlKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("input/textarea suppression", () => {
  it("does NOT fire when target is an <input>", () => {
    const handler = vi.fn();
    registerShortcut({ id: "s1", key: "a", handler });
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatch({ key: "a" }, input);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire when target is a <textarea>", () => {
    const handler = vi.fn();
    registerShortcut({ id: "s1", key: "a", handler });
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    dispatch({ key: "a" }, ta);
    expect(handler).not.toHaveBeenCalled();
  });

  it("STILL fires Escape inside an <input> (so handlers can blur)", () => {
    const handler = vi.fn();
    registerShortcut({ id: "esc", key: "Escape", handler });
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatch({ key: "Escape" }, input);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("dispatch ordering", () => {
  it("only the first matching shortcut runs (early return)", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerShortcut({ id: "first", key: "x", handler: a });
    registerShortcut({ id: "second", key: "x", handler: b });
    dispatch({ key: "x" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});

describe("getRegisteredShortcuts", () => {
  it("exposes a live view of the registry", () => {
    expect(getRegisteredShortcuts().size).toBe(0);
    registerShortcut({ id: "s1", key: "a", handler: () => {} });
    registerShortcut({ id: "s2", key: "b", handler: () => {} });
    expect(getRegisteredShortcuts().size).toBe(2);
    unregisterShortcut("s1");
    expect(getRegisteredShortcuts().has("s1")).toBe(false);
    expect(getRegisteredShortcuts().has("s2")).toBe(true);
  });
});
