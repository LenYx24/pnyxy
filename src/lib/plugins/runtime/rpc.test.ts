import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRequest, makeResponse, nextId, timeout } from "./rpc";

describe("nextId", () => {
  it("returns strictly increasing numbers across calls", () => {
    const a = nextId();
    const b = nextId();
    const c = nextId();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("returns positive integers", () => {
    const id = nextId();
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
  });
});

describe("makeRequest", () => {
  it("builds a well-formed RpcRequest", () => {
    const req = makeRequest("storage.get", ["foo"]);
    expect(req.type).toBe("rpc:req");
    expect(typeof req.id).toBe("number");
    expect(req.method).toBe("storage.get");
    expect(req.args).toEqual(["foo"]);
  });

  it("assigns a fresh id every call", () => {
    const a = makeRequest("a", []);
    const b = makeRequest("b", []);
    expect(b.id).toBeGreaterThan(a.id);
  });
});

describe("makeResponse", () => {
  it("builds an ok response with `result` and no `error`", () => {
    const res = makeResponse(7, true, { v: 1 });
    expect(res).toEqual({ type: "rpc:res", id: 7, ok: true, result: { v: 1 } });
    expect(res.error).toBeUndefined();
  });

  it("builds a failure response with `error` and no `result`", () => {
    const err = { name: "Error", message: "boom" };
    const res = makeResponse(8, false, undefined, err);
    expect(res).toEqual({ type: "rpc:res", id: 8, ok: false, error: err });
    expect(res.result).toBeUndefined();
  });
});

describe("timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the inner promise's value before the timer fires", async () => {
    const inner = Promise.resolve("value");
    const wrapped = timeout(inner, 100, "test");
    vi.advanceTimersByTime(50);
    await expect(wrapped).resolves.toBe("value");
  });

  it("rejects with a labelled timeout error after `ms`", async () => {
    const inner = new Promise<string>(() => {
      /* never resolves */
    });
    const wrapped = timeout(inner, 100, "rpc-call");
    const assertion = expect(wrapped).rejects.toThrow(
      /rpc-call timed out after 100ms/,
    );
    vi.advanceTimersByTime(101);
    await assertion;
  });

  it("propagates rejection from the inner promise", async () => {
    const inner = Promise.reject(new Error("inner failed"));
    const wrapped = timeout(inner, 1000, "test");
    await expect(wrapped).rejects.toThrow(/inner failed/);
  });
});
