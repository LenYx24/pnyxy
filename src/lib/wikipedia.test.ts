import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWikipediaSummary } from "./wikipedia";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const okJsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response;

describe("fetchWikipediaSummary", () => {
  it("returns null on a trimmed-empty title without hitting the network", async () => {
    const result = await fetchWikipediaSummary("   ", "en");
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on a 404 (no matching page)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    const result = await fetchWikipediaSummary("Nonexistent Foobar", "en");
    expect(result).toBeNull();
  });

  it("throws on a 5xx response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 } as Response);
    await expect(
      fetchWikipediaSummary("Outage Page", "en"),
    ).rejects.toThrow("Wikipedia HTTP 502");
  });

  it("parses a standard article response into the typed shape", async () => {
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        title: "Algorithm",
        type: "standard",
        extract: "An algorithm is a finite sequence of well-defined rules.",
        thumbnail: { source: "https://example.org/algo.png" },
        content_urls: {
          desktop: { page: "https://en.wikipedia.org/wiki/Algorithm" },
        },
      }),
    );
    const result = await fetchWikipediaSummary("Algorithm", "en");
    expect(result).toEqual({
      title: "Algorithm",
      lang: "en",
      type: "standard",
      extract: "An algorithm is a finite sequence of well-defined rules.",
      thumbnailUrl: "https://example.org/algo.png",
      pageUrl: "https://en.wikipedia.org/wiki/Algorithm",
    });
  });

  it("flags disambiguation pages with type: 'disambiguation'", async () => {
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        title: "Python",
        type: "disambiguation",
        extract: "Python may refer to…",
      }),
    );
    const result = await fetchWikipediaSummary("Python", "en");
    expect(result?.type).toBe("disambiguation");
  });

  it("falls back to the canonical Wikipedia URL when content_urls is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        title: "Test",
        type: "standard",
        extract: "x",
      }),
    );
    const result = await fetchWikipediaSummary("Test Page", "en");
    expect(result?.pageUrl).toBe("https://en.wikipedia.org/wiki/Test_Page");
  });

  it("encodes the title with underscores in the request URL", async () => {
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({ title: "x", type: "standard", extract: "" }),
    );
    await fetchWikipediaSummary("Multi word title", "hu");
    const [url] = fetchMock.mock.calls[0] as [string];
    // Spaces should become underscores in the path component so the
    // REST endpoint reads them as part of the title slug rather than
    // a delimited query.
    expect(url).toContain("/page/summary/Multi_word_title");
    expect(url).toContain("hu.wikipedia.org");
  });

  it("propagates an AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
      // Real fetch throws AbortError synchronously when given a
      // pre-aborted signal. Mirror that here so the contract is the
      // same.
      if (init?.signal?.aborted) {
        const err = new DOMException("Aborted", "AbortError");
        return Promise.reject(err);
      }
      return Promise.resolve({ ok: true } as Response);
    });
    await expect(
      fetchWikipediaSummary("anything", "en", { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });

  it("returns empty-extract entries with a defaulted type and empty extract string", async () => {
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        title: "Stub",
        // No `type` field at all — coerceType falls back to "standard".
        // No `extract` — should collapse to "".
      }),
    );
    const result = await fetchWikipediaSummary("Stub", "en");
    expect(result?.type).toBe("standard");
    expect(result?.extract).toBe("");
    expect(result?.thumbnailUrl).toBeNull();
  });
});
