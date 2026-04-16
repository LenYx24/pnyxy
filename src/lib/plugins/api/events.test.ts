import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostEventBus } from "./events";

describe("HostEventBus", () => {
  let bus: HostEventBus;

  beforeEach(() => {
    bus = new HostEventBus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers an emitted payload to a subscriber", () => {
    const fn = vi.fn();
    bus.on("book:opened", fn);
    bus.emit("book:opened", { docId: "abc", title: "Test" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ docId: "abc", title: "Test" });
  });

  it("delivers to multiple subscribers of the same event", () => {
    const a = vi.fn();
    const b = vi.fn();
    bus.on("book:opened", a);
    bus.on("book:opened", b);
    bus.emit("book:opened", { docId: "x", title: "y" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("does not deliver across event names", () => {
    const onBook = vi.fn();
    const onPage = vi.fn();
    bus.on("book:opened", onBook);
    bus.on("reader:page-change", onPage);
    bus.emit("book:opened", { docId: "x", title: "y" });
    expect(onBook).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });

  it("returned unsubscribe stops delivering further events", () => {
    const fn = vi.fn();
    const off = bus.on("book:closed", fn);
    bus.emit("book:closed", { docId: "1" });
    off();
    bus.emit("book:closed", { docId: "2" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ docId: "1" });
  });

  it("emit on an event with no listeners is a no-op", () => {
    expect(() => bus.emit("book:closed", { docId: "x" })).not.toThrow();
  });

  it("isolates a throwing listener from sibling listeners", () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = vi.fn(() => {
      throw new Error("boom");
    });
    const ok = vi.fn();
    bus.on("book:opened", broken);
    bus.on("book:opened", ok);
    expect(() =>
      bus.emit("book:opened", { docId: "x", title: "y" }),
    ).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(consoleErr).toHaveBeenCalled();
  });
});
