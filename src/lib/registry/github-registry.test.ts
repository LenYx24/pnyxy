import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cache", () => ({
  fetchCached: vi.fn(),
}));

import { GitHubRegistry } from "./github-registry";
import { fetchCached } from "./cache";

const fetchCachedMock = fetchCached as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchCachedMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHubRegistry — URL construction", () => {
  it("uses the default base URL when no override is given", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({ apiVersion: 1, plugins: [], themes: [] }),
    );
    const reg = new GitHubRegistry();
    await reg.listPlugins();
    expect(fetchCachedMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/LenYx24/pnyxy-community/master/index.json",
    );
  });

  it("respects a custom baseUrl", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({ apiVersion: 1, plugins: [], themes: [] }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://example.com/repo" });
    await reg.listThemes();
    expect(fetchCachedMock).toHaveBeenCalledWith(
      "https://example.com/repo/index.json",
    );
  });

  it("strips a trailing slash from the baseUrl", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({ apiVersion: 1, plugins: [], themes: [] }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://example.com/repo///" });
    await reg.listThemes();
    expect(fetchCachedMock).toHaveBeenCalledWith(
      "https://example.com/repo/index.json",
    );
  });

  it("hits themes/<id>.json for fetchThemeManifest", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({ id: "solar", name: "Solar", apiVersion: 1, tokens: {} }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    const t = await reg.fetchThemeManifest("solar");
    expect(fetchCachedMock).toHaveBeenCalledWith("https://x/repo/themes/solar.json");
    expect(t.id).toBe("solar");
  });

  it("hits plugins/<id>/manifest.json for fetchPluginManifest", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({
        id: "hello",
        name: "Hello",
        version: "1.0.0",
        apiVersion: 1,
        author: "x",
        description: "x",
        entry: "",
      }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    const m = await reg.fetchPluginManifest("hello");
    expect(fetchCachedMock).toHaveBeenCalledWith(
      "https://x/repo/plugins/hello/manifest.json",
    );
    expect(m.id).toBe("hello");
  });

  it("hits plugins/<id>/<version>/plugin.js for fetchPluginBundle", async () => {
    fetchCachedMock.mockResolvedValueOnce("// bundle source");
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    const bundle = await reg.fetchPluginBundle("hello", "1.0.0");
    expect(fetchCachedMock).toHaveBeenCalledWith(
      "https://x/repo/plugins/hello/1.0.0/plugin.js",
    );
    expect(bundle).toBe("// bundle source");
  });
});

describe("GitHubRegistry — index parsing", () => {
  it("returns plugins/themes from the parsed index", async () => {
    fetchCachedMock.mockResolvedValue(
      JSON.stringify({
        apiVersion: 1,
        plugins: [{ kind: "plugin", id: "a", name: "A", version: "1" }],
        themes: [{ kind: "theme", id: "b", name: "B", version: "1" }],
      }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    expect(await reg.listPlugins()).toEqual([
      { kind: "plugin", id: "a", name: "A", version: "1" },
    ]);
    expect(await reg.listThemes()).toEqual([
      { kind: "theme", id: "b", name: "B", version: "1" },
    ]);
  });

  it("returns empty arrays when the index omits plugins or themes", async () => {
    fetchCachedMock.mockResolvedValue(
      JSON.stringify({ apiVersion: 1 }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    expect(await reg.listPlugins()).toEqual([]);
    expect(await reg.listThemes()).toEqual([]);
  });

  it("throws on an unsupported apiVersion", async () => {
    fetchCachedMock.mockResolvedValue(
      JSON.stringify({ apiVersion: 99, plugins: [], themes: [] }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await expect(reg.listPlugins()).rejects.toThrow(/Unsupported registry apiVersion: 99/);
  });
});
