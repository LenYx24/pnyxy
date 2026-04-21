import type { Point, WhiteboardElement } from "@/types/whiteboard";

export function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function pointToSegmentDistance(
  p: Point,
  a: Point,
  b: Point,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getElementBounds(el: WhiteboardElement): BoundingBox {
  switch (el.type) {
    case "pen": {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of el.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case "rectangle":
      return {
        minX: Math.min(el.x, el.x + el.width),
        minY: Math.min(el.y, el.y + el.height),
        maxX: Math.max(el.x, el.x + el.width),
        maxY: Math.max(el.y, el.y + el.height),
      };
    case "ellipse":
      return {
        minX: el.cx - Math.abs(el.rx),
        minY: el.cy - Math.abs(el.ry),
        maxX: el.cx + Math.abs(el.rx),
        maxY: el.cy + Math.abs(el.ry),
      };
    case "line":
    case "arrow":
      return {
        minX: Math.min(el.x1, el.x2),
        minY: Math.min(el.y1, el.y2),
        maxX: Math.max(el.x1, el.x2),
        maxY: Math.max(el.y1, el.y2),
      };
    case "text":
      return {
        minX: el.x,
        minY: el.y,
        maxX: el.x + el.width,
        maxY: el.y + el.height,
      };
  }
}

/** Returns true if two axis-aligned bounding boxes overlap at all. */
export function bboxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

export function screenToWorld(
  sx: number,
  sy: number,
  panX: number,
  panY: number,
  zoom: number,
): Point {
  return {
    x: (sx - panX) / zoom,
    y: (sy - panY) / zoom,
  };
}
