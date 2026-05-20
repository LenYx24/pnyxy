// Tiny per-org localStorage cache of how many books live in each
// folder. The Library reads this synchronously on mount and paints
// that many skeleton cards before fetchLibrary's network call
// resolves, so books fade in instead of popping in from a blank
// container. Writes happen fire-and-forget after every successful
// fetchLibrary. localStorage (not IDB) on purpose: synchronous read =
// skeletons are in the first paint, no async hydration gap.

const STORAGE_KEY_PREFIX = "pnyxy.library.bookCounts.";

// Folder ids are uuids, so a non-uuid sentinel safely stands in for
// the "root" (folder_id === null) bucket inside byFolder.
export const ROOT_FOLDER_KEY = "__root__";

export interface BookCountCache {
  total: number;
  byFolder: Record<string, number>;
}

export function readBookCounts(orgId: string): BookCountCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + orgId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as BookCountCache).total === "number" &&
      typeof (parsed as BookCountCache).byFolder === "object" &&
      (parsed as BookCountCache).byFolder !== null
    ) {
      return parsed as BookCountCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeBookCounts(orgId: string, cache: BookCountCache): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + orgId, JSON.stringify(cache));
  } catch {
    // Quota exceeded / private mode / disabled storage — the cache
    // is purely a UX nicety, so swallow and move on.
  }
}

export function getCachedCount(
  cache: BookCountCache | null,
  folderId: string | null,
): number | null {
  if (!cache) return null;
  const key = folderId ?? ROOT_FOLDER_KEY;
  const v = cache.byFolder[key];
  return typeof v === "number" ? v : null;
}
