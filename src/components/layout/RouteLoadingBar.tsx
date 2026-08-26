import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { getAppRouter } from "@/lib/app-router-ref";

/** How long a navigation must hang before the bar appears; instant
 *  (cached-chunk) navigations never flash it. */
const SHOW_DELAY_MS = 150;

/**
 * Gemini-style slim indeterminate bar at the top of the viewport while
 * a navigation is pending. Router state flips to the new location
 * immediately, but the committed tree keeps the OLD location until the
 * lazy chunk resolves; the mismatch between the two is the pending
 * signal.
 */
export function RouteLoadingBar() {
  const location = useLocation();
  const committed = location.pathname + location.search;
  const [target, setTarget] = useState(committed);

  useEffect(() => {
    const router = getAppRouter();
    if (!router) return;
    return router.subscribe((state) => {
      setTarget(state.location.pathname + state.location.search);
    });
  }, []);

  const pending = target !== committed;
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
    const id = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(id);
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
