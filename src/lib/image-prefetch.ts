// Tiny "warm the browser HTTP cache" helper. Stores feeding the
// Library / Home shelves call `prefetchImages(urls)` after their
// data resolves; the browser kicks off background `<img>` requests
// for the URLs we'll most likely need to render in a beat or two.
// By the time React renders the cards the images are either in cache
// or already in flight, so the user sees the cover *now* instead of
// a 200-500 ms flash of empty placeholder.
//
// Why not a service worker / IndexedDB blob cache? Because the goal
// is "stop being slow this session", not "work fully offline". The
// browser's standard HTTP cache already does the right thing if we
// just ask for the URLs early.

/** URLs we've already kicked off a fetch for this session. Prevents
 *  duplicate Image() instances when the same library data lands
 *  multiple times (re-fetch on filter change, store re-hydrate). */
const seen = new Set<string>();

/** Conservative cap so a 500-book library doesn't trigger 500
 *  parallel image requests. Above-the-fold-ish covers are first in
 *  the array (callers pre-sort newest-first), so the tail rarely
 *  matters and the browser will fetch the rest lazily as the user
 *  scrolls. */
const MAX_PER_CALL = 16;

/** Called from store fetchers after data lands. Filters out empty
 *  strings / nulls / already-seen URLs, then fires off Image() for
 *  the first MAX_PER_CALL entries. The Image instances are
 *  deliberately discarded — only the cache effect matters. */
export function prefetchImages(urls: ReadonlyArray<string | null | undefined>): void {
  // SSR / non-browser contexts are a no-op. Image() exists only in
  // window-scoped environments; the test harness uses jsdom which
  // provides it, so this still runs in unit tests without exploding.
  if (typeof Image === "undefined") return;

  let count = 0;
  for (const url of urls) {
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    // `decoding="async"` keeps the prefetch off the main thread —
    // we don't care when the decode lands, just that the bytes are
    // sitting in the HTTP cache.
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    count += 1;
    if (count >= MAX_PER_CALL) break;
  }
}

/** Test/dev escape hatch — clears the in-memory dedup so a re-run
 *  of the same data triggers fresh prefetches. Not exported to the
 *  app surface; reserved for unit tests if we add any. */
export function _resetPrefetchCacheForTests(): void {
  seen.clear();
}
