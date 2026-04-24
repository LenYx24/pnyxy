import { useEffect, useState } from "react";

/**
 * Returns the height (in px) that the on-screen keyboard currently
 * occupies at the bottom of the viewport — 0 when no keyboard is
 * open. Backed by `window.visualViewport`, which reliably reports
 * the visible-above-keyboard height on iOS Safari and modern Android
 * Chrome. Falls back to 0 when the API is unavailable (older
 * browsers, SSR).
 *
 * Usage: add `paddingBottom: inset` (or a transform) to whatever
 * contains the focused input so the keyboard doesn't cover it.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const recompute = () => {
      // offsetTop accounts for pinch-zoom + scroll inside the layout
      // viewport. (window.innerHeight - vv.height - vv.offsetTop)
      // is the part of the layout viewport covered by keyboard.
      const covered = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop,
      );
      setInset(covered);
    };

    recompute();
    vv.addEventListener("resize", recompute);
    vv.addEventListener("scroll", recompute);
    return () => {
      vv.removeEventListener("resize", recompute);
      vv.removeEventListener("scroll", recompute);
    };
  }, []);

  return inset;
}
