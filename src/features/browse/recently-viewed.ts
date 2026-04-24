const KEY = "pnyxy:recently-viewed-catalog";
const MAX_ENTRIES = 20;

/**
 * Small per-device log of catalog book ids the user has opened. Used
 * by the "Recently viewed" shelf on Browse. Stored in localStorage so
 * it survives a refresh; capped at MAX_ENTRIES so the JSON stays tiny.
 */

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function getRecentlyViewedIds(): string[] {
  return readRaw();
}

export function trackRecentlyViewed(bookId: string): void {
  if (!bookId) return;
  const existing = readRaw();
  // Move-to-front: if the id is already present, drop it first so the
  // most-recent view bubbles to position 0.
  const next = [bookId, ...existing.filter((id) => id !== bookId)].slice(
    0,
    MAX_ENTRIES,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pnyxy:recently-viewed-changed"));
  } catch {
    // Storage blocked — silently drop; shelf just stays empty.
  }
}
