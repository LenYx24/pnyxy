import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { getAppRouter } from "@/lib/app-router-ref";

/** How long a navigation must hang before the bar appears; instant
 *  (cached-chunk) navigations never flash it. */
const SHOW_DELAY_MS = 150;
/** A real chunk load finishes well within this; past it the mismatch is a
 *  path-normalization quirk, not a pending navigation, so the bar gives up. */
const MAX_VISIBLE_MS = 8_000;

/** "/a/b/" and "/a/b", or an encoded vs decoded segment, are the same route. */
function normalizePath(path: string): string {
  let p = path;
  try {
    p = decodeURI(p);
  } catch {
    // malformed escape: compare the raw string
  }
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/**
 * Gemini-style slim indeterminate bar at the top of the viewport while
 * a navigation is pending. Router state flips to the new location
 * immediately, but the committed tree keeps the OLD location until the
 * lazy chunk resolves; the mismatch between the two is the pending
 * signal.
 */
export function RouteLoadingBar() {
  const location = useLocation();
  // Track the PATHNAME only. Lazy route chunks load per route (pathname),
  // not per query string, so a same-route search-param update (the reader
  // syncing page/zoom, chat state, a tab switch) is not a pending
  // navigation and must not flash the bar. Comparing the full path+search
  // made the bar fire on that churn, and any search normalization mismatch
  // kept it stuck visible.
  const committed = normalizePath(location.pathname);
  const [target, setTarget] = useState(committed);

  useEffect(() => {
    const router = getAppRouter();
    if (!router) return;
    return router.subscribe((state) => {
      setTarget(normalizePath(state.location.pathname));
    });
  }, []);

  // Read the router's live location too: once it equals the committed one
  // the navigation has landed, whatever a stale `target` still says.
  const live = getAppRouter()?.state.location.pathname;
  const pending =
    target !== committed &&
    (live === undefined || normalizePath(live) !== committed);
  const [visible, setVisible] = useState(false);
  // hide instantly when the navigation lands (render-time guard, not an
  // effect, so there is no extra committed frame with a stale bar)
  const [pendingSnapshot, setPendingSnapshot] = useState(pending);
  if (pending !== pendingSnapshot) {
    setPendingSnapshot(pending);
    if (!pending) setVisible(false);
  }
  useEffect(() => {
    if (!pending) return;
    const show = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    const giveUp = setTimeout(() => setVisible(false), MAX_VISIBLE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  if (!visible) return null;
  return (
    <div
      className="route-loading-bar"
      role="progressbar"
      aria-label="Loading"
    />
  );
}
