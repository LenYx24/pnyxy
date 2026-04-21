import type { Point, WhiteboardElement } from "@/types/whiteboard";
import { getElementBounds, pointToSegmentDistance } from "./math-utils";

/** Un-rotate a world-space point around an element's bbox centre so we
 *  can test against the element's axis-aligned local geometry. */
function toLocalPoint(el: WhiteboardElement, p: Point): Point {
  const rot = el.rotation ?? 0;
  if (rot === 0) return p;
  const b = getElementBounds(el);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Hit-test a single element. Returns true if the world-space point is on/near the element. */
function hitTestElement(
  el: WhiteboardElement,
  p: Point,
  zoom: number,
): boolean {
  const threshold = el.strokeWidth / 2 + 5 / zoom;
  // Translate the test point into element-local (un-rotated) space.
  p = toLocalPoint(el, p);

  switch (el.type) {
    case "pen": {
      for (let i = 0; i < el.points.length - 1; i++) {
        if (pointToSegmentDistance(p, el.points[i], el.points[i + 1]) <= threshold) {
          return true;
        }
      }
      // Single point
      if (el.points.length === 1) {
        const pt = el.points[0];
        const dx = p.x - pt.x;
        const dy = p.y - pt.y;
        return Math.sqrt(dx * dx + dy * dy) <= threshold;
      }
      return false;
    }

    case "rectangle": {
      const { x, y, width, height } = el;
      const x2 = x + width;
      const y2 = y + height;
      const corners: [Point, Point][] = [
        [{ x, y }, { x: x2, y }],
        [{ x: x2, y }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x, y: y2 }],
        [{ x, y: y2 }, { x, y }],
      ];
      for (const [a, b] of corners) {
        if (pointToSegmentDistance(p, a, b) <= threshold) return true;
      }
      return false;
    }

    case "ellipse": {
      const { cx, cy, rx, ry } = el;
      const arx = Math.abs(rx) || 1;
      const ary = Math.abs(ry) || 1;
      const normalized = Math.sqrt(
        ((p.x - cx) / arx) ** 2 + ((p.y - cy) / ary) ** 2,
      );
      // Distance from ellipse boundary (approximate in pixel terms)
      const avgRadius = (arx + ary) / 2;
      return Math.abs(normalized - 1) * avgRadius <= threshold;
    }

    case "line": {
      return (
        pointToSegmentDistance(
          p,
          { x: el.x1, y: el.y1 },
          { x: el.x2, y: el.y2 },
        ) <= threshold
      );
    }

    case "arrow": {
      return (
        pointToSegmentDistance(
          p,
          { x: el.x1, y: el.y1 },
          { x: el.x2, y: el.y2 },
        ) <= threshold
      );
    }

    case "text": {
      // Text is hit as a solid rectangle — makes selection/drag cheap
      // and predictable. Fine for click targets; precise per-glyph
      // hit-testing isn't useful here.
      return (
        p.x >= el.x &&
        p.x <= el.x + el.width &&
        p.y >= el.y &&
        p.y <= el.y + el.height
      );
    }
  }
}

/**
 * Find the topmost element at a world-space point.
 * Elements are tested in reverse z-order (last = topmost).
 */
export function hitTest(
  elements: WhiteboardElement[],
  p: Point,
  zoom: number,
): WhiteboardElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTestElement(elements[i], p, zoom)) {
      return elements[i];
    }
  }
  return null;
}
