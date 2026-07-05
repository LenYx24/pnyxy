import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * React.lazy that survives a deploy: after a new deploy the cached HTML
 * references old content-hashed chunk names that 404, so the dynamic import
 * rejects with "Failed to fetch dynamically imported module". Hard-reload once
 * to pull fresh HTML with the new chunk names.
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
  // phrasing varies across bundlers/browsers
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
      // clear the flag so a later chunk failure (second deploy mid-session) can reload again
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        // ignore
      }
      return result;
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      // reload only once, else a genuinely-down network loops us forever
      let alreadyTried = false;
      try {
        alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === "1";
      } catch {
        // sessionStorage can be missing (strict iOS private mode, some embeds); treat as not-tried
      }
      if (alreadyTried) throw err;
      try {
        sessionStorage.setItem(RELOAD_FLAG, "1");
      } catch {
        // ignore
      }
      window.location.reload();
      // never resolves; the document is going away
      return new Promise<{ default: T }>(() => {});
    }
  });
}
