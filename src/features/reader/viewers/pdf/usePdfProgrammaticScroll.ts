import { useCallback, useRef, type RefObject } from "react";
import { clamp } from "./pdf-layout";

export interface PdfProgrammaticScroll {
  /** Write a programmatic scroll and arm the marker. */
  writeProgrammaticScroll: (el: HTMLElement, top: number, left?: number) => void;
  /** True (and consumes the marker) when the scroll matches the last
   *  programmatic target within 1px. */
  consumeProgrammaticScroll: (el: HTMLElement) => boolean;
  /** Whether the last scroll was ours. Single-shot, consumer clears it. */
  lastScrollWasProgrammaticRef: RefObject<boolean>;
}

/**
 * Marker for the viewer's own scrollTop writes so the scroll handler can
 * tell them from user scrolls. Shared by the zoom pivot (applyScale) and
 * every scroll-anchor effect, so it lives above both.
 */
export function usePdfProgrammaticScroll(): PdfProgrammaticScroll {
  // Target of the last programmatic scroll write, so handleScroll can tell
  // our writes from user scrolls. Consumed single-shot.
  const programmaticScrollTargetRef = useRef<{ top: number; left: number } | null>(null);
  const lastScrollWasProgrammaticRef = useRef(false);

  /** Write a programmatic scroll and arm the marker. Clamp to live max
   *  (browser clamps too) so the matcher survives a past-edge target. */
  const writeProgrammaticScroll = useCallback(
    (el: HTMLElement, top: number, left: number = el.scrollLeft) => {
      const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const ct = clamp(top, 0, maxTop);
      const cl = clamp(left, 0, maxLeft);
      programmaticScrollTargetRef.current = { top: ct, left: cl };
      el.scrollTop = ct;
      el.scrollLeft = cl;
    },
    [],
  );

  /** True (and consumes the marker) when the scroll matches the last
   *  programmatic target within 1px. Callers skip user-scroll side effects. */
  const consumeProgrammaticScroll = useCallback((el: HTMLElement): boolean => {
    const target = programmaticScrollTargetRef.current;
    if (!target) return false;
    const matches =
      Math.abs(el.scrollTop - target.top) <= 1 &&
      Math.abs(el.scrollLeft - target.left) <= 1;
    if (matches) {
      programmaticScrollTargetRef.current = null;
      return true;
    }
    return false;
  }, []);

  return {
    writeProgrammaticScroll,
    consumeProgrammaticScroll,
    lastScrollWasProgrammaticRef,
  };
}
