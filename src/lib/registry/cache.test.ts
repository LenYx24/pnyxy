import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fetchCached, getCached, setCached } from "./cache";

const URL_A = "https://example.com/a.json";
const URL_B = "https://example.com/b.json";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getCached / setCached", () => {
  it("returns null for an unset key", () => {
    expect(getCached(URL_A)).toBeNull();
  });

  it("round-trips a value within the default TTL", () => {
    setCached(URL_A, "hello");
    expect(getCached(URL_A)).toBe("hello");
  });

  it("returns null after the TTL has elapsed and removes the entry", () => {
    setCached(URL_A, "hello", 1000);
    expect(getCached(URL_A)).toBe("hello");
    vi.advanceTimersByTime(1001);
    expect(getCached(URL_A)).toBeNull();
    // Re-reading must not resurrect it.
    expect(getCached(URL_A)).toBeNull();
  });

  it("namespaces values by URL", () => {
    setCached(URL_A, "a");
    setCached(URL_B, "b");
    expect(getCached(URL_A)).toBe("a");
    expect(getCached(URL_B)).toBe("b");
  });

  it("survives corrupted storage by returning null", () => {
    localStorage.setItem("pnyxy-reader:registry-cache", "{not json");
    expect(getCached(URL_A)).toBeNull();
    // setCached must still work: it overwrites the corrupt blob.
    setCached(URL_A, "fresh");
    expect(getCached(URL_A)).toBe("fresh");
  });
});

describe("fetchCached", () => {
  it("returns the cached value without calling fetch on a hit", async () => {
    setCached(URL_A, "from-cache");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCached(URL_A)).resolves.toBe("from-cache");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and writes the value on a miss", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve("from-network"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCached(URL_A)).resolves.toBe("from-network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(URL_A);
    // Second call should hit the cache.
    await expect(fetchCached(URL_A)).resolves.toBe("from-network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws and does not cache when the response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCached(URL_A)).rejects.toThrow(/404/);
    expect(getCached(URL_A)).toBeNull();
  });
});
