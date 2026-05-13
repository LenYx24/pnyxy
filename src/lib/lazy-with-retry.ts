import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Drop-in for React.lazy that recovers from the post-deploy
 * "Failed to fetch dynamically imported module" failure.
 *
 * The failure mode:
 *   1. User loads the SPA at time T1; HTML references chunk
 *      `ChatPage-OLD.js`.
 *   2. A new deploy at T2 renames every chunk (Vite content-hashes
 *      filenames) — `ChatPage-OLD.js` no longer exists on the CDN.
 *   3. User navigates to /chat. React tries to dynamically import
 *      the OLD chunk filename baked into their cached HTML; the
 *      origin returns 404. The Promise rejects with
 *      "Failed to fetch dynamically imported module: …".
 *
 * The fix: catch the import rejection ONCE, set a session flag so
 * we can't infinite-loop if the rejection is something else, and
 * hard-reload the page. The reload pulls fresh HTML, which points
 * at the new chunk names, and the import succeeds.
 *
 * We don't retry the original import — the URL is dead, retries
 * won't bring it back. We bypass cache + service worker via
 * `window.location.reload()` so the new HTML is guaranteed to
 * carry the new chunk references.
 */
const RELOAD_FLAG = "pnyxy:chunk-reload";

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err);
  // The exact phrasing differs between bundlers/browsers; this set
  // covers Vite + Webpack + the common variants Chromium/Safari/
  // Firefox produce when a dynamic import 404s or hits a network
  // failure.
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const result = await factory();
      // Successful import — clear the one-shot retry flag so a
      // *future* chunk failure (e.g. a second deploy mid-session)
      // can reload again. Without this, the flag would stay set
      // after the first recovery and block subsequent ones.
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // ignore — see catch handler for the rationale
      }
      return result;
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      // Guard against the (rare) case where the network is just
      // down and reloading wouldn't help — without this we'd
      // refresh in a loop. The flag is cleared after any successful
      // import above, so a future failure can reload again.
      let alreadyTried = false;
      try {
        alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === "1";
      } catch {
        // sessionStorage may be unavailable in some embedded
        // contexts (older Tauri, strict iOS private mode). Treat
        // as not-tried; the user will at worst see one fast
        // reload cycle.
      }
      if (alreadyTried) throw err;
      try {
        sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        // ignore
      }
      // Reload without honoring the bf-cache — we want the browser
      // to re-fetch the document and pick up new chunk hashes.
      window.location.reload();
      // Block the render path forever while the reload is in
      // flight; React doesn't need a resolved component because
      // the document is going away.
      return new Promise<{ default: T }>(() => {});
    }
  });
}
