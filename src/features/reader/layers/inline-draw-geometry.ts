import type { InlineElement, Pt } from "@/stores/inline-draw-store";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function norm(ax: number, ay: number, bx: number, by: number): Bounds {
  return {
    minX: Math.min(ax, bx),
    minY: Math.min(ay, by),
    maxX: Math.max(ax, bx),
    maxY: Math.max(ay, by),
  };
}

/** Axis-aligned bounds of an element in normalised (0..1) page space. */
export function getBounds(el: InlineElement): Bounds {
  switch (el.type) {
    case "pen": {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of el.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return { minX, minY, maxX, maxY };
    }
    case "rectangle":
      return norm(el.x, el.y, el.x + el.w, el.y + el.h);
    case "ellipse":
      return {
        minX: el.cx - Math.abs(el.rx),
        minY: el.cy - Math.abs(el.ry),
        maxX: el.cx + Math.abs(el.rx),
        maxY: el.cy + Math.abs(el.ry),
      };
    case "line":
    case "arrow":
      return norm(el.x1, el.y1, el.x2, el.y2);
  }
}

/** Re-fit an element to new bounds (proportional remap). Used by resize. */
export function setBounds(el: InlineElement, nb: Bounds): InlineElement {
  const ob = getBounds(el);
  const ow = ob.maxX - ob.minX || 1e-6;
  const oh = ob.maxY - ob.minY || 1e-6;
  const sx = (nb.maxX - nb.minX) / ow;
  const sy = (nb.maxY - nb.minY) / oh;
  const mapX = (x: number) => nb.minX + (x - ob.minX) * sx;
  const mapY = (y: number) => nb.minY + (y - ob.minY) * sy;
  switch (el.type) {
    case "pen":
      return { ...el, points: el.points.map((p) => ({ x: mapX(p.x), y: mapY(p.y) })) };
    case "rectangle":
      return {
        ...el,
        x: nb.minX,
        y: nb.minY,
        w: nb.maxX - nb.minX,
        h: nb.maxY - nb.minY,
      };
    case "ellipse":
      return {
        ...el,
        cx: (nb.minX + nb.maxX) / 2,
        cy: (nb.minY + nb.maxY) / 2,
        rx: (nb.maxX - nb.minX) / 2,
        ry: (nb.maxY - nb.minY) / 2,
      };
    case "line":
    case "arrow":
      return {
        ...el,
        x1: mapX(el.x1),
        y1: mapY(el.y1),
        x2: mapX(el.x2),
        y2: mapY(el.y2),
      };
  }
}

/** Translate an element by (dx, dy) in normalised space, clamped to page. */
export function translateElement(
  el: InlineElement,
  dx: number,
  dy: number,
): InlineElement {
  // Clamp so the element's bounds stay within the page.
  const b = getBounds(el);
  const cdx = Math.max(-b.minX, Math.min(1 - b.maxX, dx));
  const cdy = Math.max(-b.minY, Math.min(1 - b.maxY, dy));
  switch (el.type) {
    case "pen":
      return { ...el, points: el.points.map((p) => ({ x: p.x + cdx, y: p.y + cdy })) };
    case "rectangle":
      return { ...el, x: el.x + cdx, y: el.y + cdy };
    case "ellipse":
      return { ...el, cx: el.cx + cdx, cy: el.cy + cdy };
    case "line":
    case "arrow":
      return {
        ...el,
        x1: el.x1 + cdx,
        y1: el.y1 + cdy,
        x2: el.x2 + cdx,
        y2: el.y2 + cdy,
      };
  }
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function penNear(points: Pt[], p: Pt, tol: number): boolean {
  for (let i = 1; i < points.length; i++) {
    if (segDist(p, points[i - 1], points[i]) <= tol) return true;
  }
  // Single-point / dot fallback.
  return points.length > 0 && Math.hypot(points[0].x - p.x, points[0].y - p.y) <= tol;
}

/** Is point `p` (unit space) within `tol` of the element (for select /
 *  eraser). Closed shapes (rect/ellipse) also hit on their interior so
 *  they're easy to grab. */
export function hitElement(el: InlineElement, p: Pt, tol: number): boolean {
  switch (el.type) {
    case "pen":
      return penNear(el.points, p, tol);
    case "line":
    case "arrow":
      return segDist(p, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) <= tol;
    case "rectangle": {
      const b = getBounds(el);
      return (
        p.x >= b.minX - tol &&
        p.x <= b.maxX + tol &&
        p.y >= b.minY - tol &&
        p.y <= b.maxY + tol
      );
    }
    case "ellipse": {
      const rx = Math.abs(el.rx) || 1e-6;
      const ry = Math.abs(el.ry) || 1e-6;
      const dx = (p.x - el.cx) / rx;
      const dy = (p.y - el.cy) / ry;
      return dx * dx + dy * dy <= 1 + tol * 2;
    }
  }
}

export type HandleId = "nw" | "ne" | "sw" | "se";

export function handlePositions(b: Bounds): Record<HandleId, Pt> {
  return {
    nw: { x: b.minX, y: b.minY },
    ne: { x: b.maxX, y: b.minY },
    sw: { x: b.minX, y: b.maxY },
    se: { x: b.maxX, y: b.maxY },
  };
}

/** New bounds after dragging `handle` to unit point `p`, keeping the
 *  opposite corner fixed. */
export function resizeBounds(b: Bounds, handle: HandleId, p: Pt): Bounds {
  let { minX, minY, maxX, maxY } = b;
  if (handle === "nw") {
    minX = p.x;
    minY = p.y;
  } else if (handle === "ne") {
    maxX = p.x;
    minY = p.y;
  } else if (handle === "sw") {
    minX = p.x;
    maxY = p.y;
  } else {
    maxX = p.x;
    maxY = p.y;
  }
  return norm(minX, minY, maxX, maxY);
}
