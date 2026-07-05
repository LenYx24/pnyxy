const CACHE_KEY = "pnyxy-reader:registry-cache";
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  value: string;
  expiresAt: number;
}

type CacheMap = Record<string, CacheEntry>;

function read(): CacheMap {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CacheMap;
  } catch {
    return {};
  }
}

function write(map: CacheMap): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // quota or privacy-mode failure, best-effort cache only
  }
}

export function getCached(url: string): string | null {
  const map = read();
  const entry = map[url];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete map[url];
    write(map);
    return null;
  }
  return entry.value;
}

export function setCached(url: string, value: string, ttlMs = DEFAULT_TTL_MS): void {
  const map = read();
  map[url] = { value, expiresAt: Date.now() + ttlMs };
  write(map);
}

export async function fetchCached(url: string, ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const cached = getCached(url);
  if (cached !== null) return cached;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  setCached(url, text, ttlMs);
  return text;
}
