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

describe("GitHubRegistry - URL construction", () => {
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

describe("GitHubRegistry - id/version validation", () => {
  it("rejects a theme id that isn't in the allowed charset (path traversal attempt)", async () => {
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await expect(
      reg.fetchThemeManifest("../../other-user/other-repo/master/x"),
    ).rejects.toThrow(/Invalid registry theme id/);
    expect(fetchCachedMock).not.toHaveBeenCalled();
  });

  it("rejects a plugin id with an uppercase or slash character", async () => {
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await expect(reg.fetchPluginManifest("Evil/Plugin")).rejects.toThrow(
      /Invalid registry plugin id/,
    );
    expect(fetchCachedMock).not.toHaveBeenCalled();
  });

  it("rejects a plugin version outside the allowed charset", async () => {
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await expect(
      reg.fetchPluginBundle("hello", "../../../evil"),
    ).rejects.toThrow(/Invalid registry version/);
    expect(fetchCachedMock).not.toHaveBeenCalled();
  });

  it("rejects a fetched theme manifest whose id doesn't match the requested id", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({ id: "not-solar", name: "Solar", apiVersion: 1, tokens: {} }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await expect(reg.fetchThemeManifest("solar")).rejects.toThrow(
      /Theme manifest id mismatch/,
    );
  });

  it("rejects a fetched plugin manifest whose id doesn't match the requested id", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({
        id: "not-hello",
        name: "Hello",
        version: "1.0.0",
        apiVersion: 1,
        author: "x",
        description: "x",
        entry: "",
      }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await expect(reg.fetchPluginManifest("hello")).rejects.toThrow(
      /Plugin manifest id mismatch/,
    );
  });

  it("strips a theme's disallowed tokens on fetch (sanitizeTheme applied)", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({
        id: "solar",
        name: "Solar",
        apiVersion: 1,
        tokens: {
          "--color-bg-primary": "#000",
          "--evil-injected": "#fff",
          "--color-accent": "url(javascript:alert(1))",
        },
      }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    const theme = await reg.fetchThemeManifest("solar");
    expect(theme.tokens).toEqual({ "--color-bg-primary": "#000" });
  });
});

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("GitHubRegistry - integrity verification", () => {
  it("verifies a theme against the index entry's integrity hash after listThemes populated the index cache", async () => {
    const themeJson = JSON.stringify({
      id: "solar",
      name: "Solar",
      apiVersion: 1,
      tokens: { "--color-bg-primary": "#000" },
    });
    const goodHash = await sha256Hex(themeJson);
    fetchCachedMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/index.json")) {
        return JSON.stringify({
          apiVersion: 1,
          plugins: [],
          themes: [
            { kind: "theme", id: "solar", name: "Solar", version: "1", integrity: goodHash },
          ],
        });
      }
      if (url.endsWith("/themes/solar.json")) return themeJson;
      throw new Error(`unexpected url ${url}`);
    });
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await reg.listThemes();
    const theme = await reg.fetchThemeManifest("solar");
    expect(theme.id).toBe("solar");
  });

  it("throws when the fetched content doesn't match the index entry's integrity hash", async () => {
    const themeJson = JSON.stringify({
      id: "solar",
      name: "Solar",
      apiVersion: 1,
      tokens: {},
    });
    fetchCachedMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/index.json")) {
        return JSON.stringify({
          apiVersion: 1,
          plugins: [],
          themes: [
            {
              kind: "theme",
              id: "solar",
              name: "Solar",
              version: "1",
              integrity: "0".repeat(64),
            },
          ],
        });
      }
      if (url.endsWith("/themes/solar.json")) return themeJson;
      throw new Error(`unexpected url ${url}`);
    });
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    await reg.listThemes();
    await expect(reg.fetchThemeManifest("solar")).rejects.toThrow(
      /Integrity check failed/,
    );
  });

  it("does not fetch the index (or check integrity) when no list call has populated the cache", async () => {
    fetchCachedMock.mockResolvedValueOnce(
      JSON.stringify({ id: "solar", name: "Solar", apiVersion: 1, tokens: {} }),
    );
    const reg = new GitHubRegistry({ baseUrl: "https://x/repo" });
    const theme = await reg.fetchThemeManifest("solar");
    expect(theme.id).toBe("solar");
    expect(fetchCachedMock).toHaveBeenCalledTimes(1);
  });
});

describe("GitHubRegistry - index parsing", () => {
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
