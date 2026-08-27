/**
 * Unit tests for the plugin-sandbox bootstrap's message-routing logic
 * (H6). `createBootstrapHandler` is the pure, self-contained function
 * that the iframe srcdoc embeds verbatim via `.toString()`, so these
 * tests exercise the exact same source that runs inside the sandbox.
 */
import { describe, expect, it, vi } from "vitest";
import { createBootstrapHandler } from "./sandboxed";

function makeDeps(overrides: Partial<Parameters<typeof createBootstrapHandler>[0]> = {}) {
  const parentWindow = {};
  return {
    nonce: "correct-nonce",
    parentWindow,
    onInit: vi.fn(),
    onRun: vi.fn(),
    onUnload: vi.fn(),
    ...overrides,
  };
}

describe("createBootstrapHandler", () => {
  it("ignores any message whose source is not the parent window", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({
      source: {}, // not deps.parentWindow
      data: { type: "run", nonce: "correct-nonce", src: "1+1" },
    });
    expect(deps.onRun).not.toHaveBeenCalled();
  });

  it("ignores a run whose nonce mismatches", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({
      source: deps.parentWindow,
      data: { type: "run", nonce: "wrong-nonce", src: "1+1" },
    });
    expect(deps.onRun).not.toHaveBeenCalled();
  });

  it("ignores an init whose nonce mismatches", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({
      source: deps.parentWindow,
      data: { type: "init", nonce: "wrong-nonce" },
      ports: [{}],
    });
    expect(deps.onInit).not.toHaveBeenCalled();
  });

  it("accepts a run with the correct source and nonce, exactly once", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({
      source: deps.parentWindow,
      data: {
        type: "run",
        nonce: "correct-nonce",
        src: "onLoad = function() {};",
        appVersion: "1.2.3",
        manifest: { id: "x" },
      },
    });
    expect(deps.onRun).toHaveBeenCalledTimes(1);
    expect(deps.onRun).toHaveBeenCalledWith({
      src: "onLoad = function() {};",
      appVersion: "1.2.3",
      manifest: { id: "x" },
    });

    // A second `run` (even correctly sourced and nonced) is ignored:
    // the load already happened once, replaying a new bundle must not
    // re-execute code in an already-initialized plugin context.
    handler({
      source: deps.parentWindow,
      data: { type: "run", nonce: "correct-nonce", src: "malicious" },
    });
    expect(deps.onRun).toHaveBeenCalledTimes(1);
  });

  it("accepts an init with a transferred port exactly once, ignoring a later init", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    const firstPort = { id: "first" };
    const secondPort = { id: "second" };

    handler({
      source: deps.parentWindow,
      data: { type: "init", nonce: "correct-nonce" },
      ports: [firstPort],
    });
    handler({
      source: deps.parentWindow,
      data: { type: "init", nonce: "correct-nonce" },
      ports: [secondPort],
    });

    expect(deps.onInit).toHaveBeenCalledTimes(1);
    expect(deps.onInit).toHaveBeenCalledWith(firstPort);
  });

  it("ignores init when no port was transferred", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({
      source: deps.parentWindow,
      data: { type: "init", nonce: "correct-nonce" },
      ports: [],
    });
    expect(deps.onInit).not.toHaveBeenCalled();
  });

  it("ignores messages with no data or non-object data", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({ source: deps.parentWindow, data: null });
    handler({ source: deps.parentWindow, data: "run" });
    expect(deps.onRun).not.toHaveBeenCalled();
    expect(deps.onInit).not.toHaveBeenCalled();
  });

  it("dispatches unload only for correctly sourced and nonced messages", () => {
    const deps = makeDeps();
    const handler = createBootstrapHandler(deps);
    handler({ source: {}, data: { type: "unload", nonce: "correct-nonce" } });
    expect(deps.onUnload).not.toHaveBeenCalled();
    handler({
      source: deps.parentWindow,
      data: { type: "unload", nonce: "correct-nonce" },
    });
    expect(deps.onUnload).toHaveBeenCalledTimes(1);
  });

  it("round-trips through Function.prototype.toString(), matching how the srcdoc embeds it", () => {
    // The real bootstrap embeds `createBootstrapHandler` in the
    // iframe's <script> via `(${createBootstrapHandler.toString()})(deps)`.
    // Rebuild it the same way here (via `new Function`, not eval, to
    // keep this test's own scope out of it) and confirm the nonce gate
    // still holds in the reconstructed function.
    const rebuilt = new Function(
      "deps",
      `return (${createBootstrapHandler.toString()})(deps);`,
    ) as (deps: ReturnType<typeof makeDeps>) => (ev: unknown) => void;

    const deps = makeDeps();
    const handler = rebuilt(deps);

    handler({
      source: deps.parentWindow,
      data: { type: "run", nonce: "wrong-nonce", src: "x" },
    });
    expect(deps.onRun).not.toHaveBeenCalled();

    handler({
      source: deps.parentWindow,
      data: { type: "run", nonce: "correct-nonce", src: "x", appVersion: "1", manifest: {} },
    });
    expect(deps.onRun).toHaveBeenCalledTimes(1);
  });
});
