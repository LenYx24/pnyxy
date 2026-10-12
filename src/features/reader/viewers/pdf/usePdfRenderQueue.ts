import { useLayoutEffect, useState, type RefObject } from "react";
import { upperBound } from "./pdf-layout";
import { createRenderQueue, type RenderQueue } from "./render-queue";

/**
 * One render queue per viewer, prioritising the page under the viewport
 * centre (read live from the scroll container when a slot frees up).
 */
export function usePdfRenderQueue(
  containerRef: RefObject<HTMLDivElement | null>,
  pageOffsets: number[],
  liveScaleRef: RefObject<number>,
): RenderQueue {
  const [queue] = useState(() => createRenderQueue());
  // Layout effect so the focus source is current before the child slots'
  // passive effects request their renders.
  useLayoutEffect(() => {
    queue.setFocus(() => {
      const el = containerRef.current;
      if (!el) return 1;
      const scale = liveScaleRef.current || 1;
      const centre = (el.scrollTop + el.clientHeight / 2) / scale;
      return Math.max(1, upperBound(pageOffsets, centre));
    });
  }, [queue, containerRef, liveScaleRef, pageOffsets]);
  return queue;
}
