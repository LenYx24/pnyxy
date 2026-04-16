import { describe, expect, it, vi } from "vitest";
import { DirectRuntime } from "./direct";
import type { PluginAPI, PluginManifest, PluginModule } from "../types";

const fakeApi = {} as PluginAPI;

const manifest: PluginManifest = {
  id: "test",
  name: "Test",
  version: "1.0.0",
  apiVersion: 1,
  author: "x",
  description: "x",
  entry: "",
};

describe("DirectRuntime", () => {
  it("identifies as 'direct'", () => {
    expect(new DirectRuntime().kind).toBe("direct");
  });

  it("throws when coreModule is not provided", async () => {
    const rt = new DirectRuntime();
    await expect(
      rt.load({ manifest, bundle: null, api: fakeApi }),
    ).rejects.toThrow(/requires coreModule/);
  });

  it("calls onLoad with the api and manifest context", async () => {
    const onLoad = vi.fn();
    const module: PluginModule = { onLoad };
    const rt = new DirectRuntime();
    await rt.load({ manifest, bundle: null, coreModule: module, api: fakeApi });
    expect(onLoad).toHaveBeenCalledWith(fakeApi, { manifest });
  });

  it("returns a handle whose destroy() invokes onUnload", async () => {
    const onUnload = vi.fn();
    const rt = new DirectRuntime();
    const handle = await rt.load({
      manifest,
      bundle: null,
      coreModule: { onUnload },
      api: fakeApi,
    });
    await handle.destroy();
    expect(onUnload).toHaveBeenCalledTimes(1);
  });

  it("deliverEvent forwards to handleEvent with id and payload", async () => {
    const handleEvent = vi.fn();
    const rt = new DirectRuntime();
    const handle = await rt.load({
      manifest,
      bundle: null,
      coreModule: { handleEvent },
      api: fakeApi,
    });
    handle.deliverEvent(7, { x: 1 });
    expect(handleEvent).toHaveBeenCalledWith(7, { x: 1 });
  });

  it("invokeCommand forwards to handleCommand with the command id", async () => {
    const handleCommand = vi.fn();
    const rt = new DirectRuntime();
    const handle = await rt.load({
      manifest,
      bundle: null,
      coreModule: { handleCommand },
      api: fakeApi,
    });
    await handle.invokeCommand("cmd:greet");
    expect(handleCommand).toHaveBeenCalledWith("cmd:greet");
  });

  it("module without lifecycle handlers behaves as a no-op", async () => {
    const rt = new DirectRuntime();
    const handle = await rt.load({
      manifest,
      bundle: null,
      coreModule: {},
      api: fakeApi,
    });
    await expect(handle.destroy()).resolves.toBeUndefined();
    await expect(handle.invokeCommand("anything")).resolves.toBeUndefined();
    expect(() => handle.deliverEvent(1, null)).not.toThrow();
  });
});
