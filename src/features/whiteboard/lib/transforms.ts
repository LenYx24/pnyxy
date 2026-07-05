import type { Point, WhiteboardElement } from "@/types/whiteboard";
import type { ResizeHandle } from "./render-element";
import { getElementBounds } from "./math-utils";
import { measureTextHeight } from "./text-layout";

/** Rotate point `p` by `angle` (rad) around centre `c`. */
function rotateAround(p: Point, c: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/**
 * Apply a resize-handle drag and return the updated fields. Drag is
 * interpreted in the element's local (un-rotated) frame: un-rotate the
 * pointer around the original centre, build a new bbox against the
 * opposite handle as anchor, then scale geometry old to new bbox.
 * Rotated elements need the offset compensation below to keep the
 * anchor fixed in world space.
 */
export function applyResize(
  original: WhiteboardElement,
  handle: ResizeHandle,
  pointerWorld: Point,
): Partial<WhiteboardElement> {
  const orig = getElementBounds(original);
  const origCx = (orig.minX + orig.maxX) / 2;
  const origCy = (orig.minY + orig.maxY) / 2;
  const rot = original.rotation ?? 0;

  // Un-rotate pointer into the element's local (axis-aligned) frame.
  const pLocal = rotateAround(pointerWorld, { x: origCx, y: origCy }, -rot);

  // Anchor in local frame is the opposite handle.
  const anchor: Point = (() => {
    switch (handle) {
      case "nw": return { x: orig.maxX, y: orig.maxY };
      case "n":  return { x: (orig.minX + orig.maxX) / 2, y: orig.maxY };
      case "ne": return { x: orig.minX, y: orig.maxY };
      case "e":  return { x: orig.minX, y: (orig.minY + orig.maxY) / 2 };
      case "se": return { x: orig.minX, y: orig.minY };
      case "s":  return { x: (orig.minX + orig.maxX) / 2, y: orig.minY };
      case "sw": return { x: orig.maxX, y: orig.minY };
      case "w":  return { x: orig.maxX, y: (orig.minY + orig.maxY) / 2 };
    }
  })();

  // Edge handles constrain one axis to the original bound.
  const movesX = handle !== "n" && handle !== "s";
  const movesY = handle !== "e" && handle !== "w";

  // Avoid degenerate (zero/near-zero) sizes, clamp to a small min.
  const MIN = 4;
  const newMinX = movesX ? Math.min(anchor.x, pLocal.x) : orig.minX;
  const newMaxX = movesX ? Math.max(anchor.x, pLocal.x) : orig.maxX;
  const newMinY = movesY ? Math.min(anchor.y, pLocal.y) : orig.minY;
  const newMaxY = movesY ? Math.max(anchor.y, pLocal.y) : orig.maxY;

  const origW = Math.max(MIN, orig.maxX - orig.minX);
  const origH = Math.max(MIN, orig.maxY - orig.minY);
  const newW = Math.max(MIN, newMaxX - newMinX);
  const newH = Math.max(MIN, newMaxY - newMinY);
  const sx = newW / origW;
  const sy = newH / origH;

  // Helper: scale a local-space point around the anchor.
  const scaleLocal = (p: Point): Point => ({
    x: anchor.x + (p.x - anchor.x) * sx,
    y: anchor.y + (p.y - anchor.y) * sy,
  });

  // The anchor stays at the same local point but the bbox centre moves,
  // so compute the world offset that keeps the anchor fixed.
  const newCx = (newMinX + newMaxX) / 2;
  const newCy = (newMinY + newMaxY) / 2;
  const worldAnchor = rotateAround(anchor, { x: origCx, y: origCy }, rot);
  const naiveWorldAnchor = rotateAround(
    anchor,
    { x: origCx, y: origCy },
    rot,
  );
  const newLocalAnchor = anchor; // anchor is invariant in local space
  void newLocalAnchor;
  const newWorldAnchor = rotateAround(
    anchor,
    { x: newCx, y: newCy },
    rot,
  );
  const offsetX = worldAnchor.x - newWorldAnchor.x;
  const offsetY = naiveWorldAnchor.y - newWorldAnchor.y;

  const localToWorld = (p: Point): Point => {
    const r = rotateAround(p, { x: newCx, y: newCy }, rot);
    return { x: r.x + offsetX, y: r.y + offsetY };
  };
  // geometry stays in local space; the offset is applied implicitly since
  // render() uses the current bbox centre as pivot.
  void localToWorld;

  switch (original.type) {
    case "pen":
      return {
        points: original.points.map(scaleLocal),
      };
    case "rectangle": {
      const localTL = scaleLocal({ x: original.x, y: original.y });
      const localBR = scaleLocal({
        x: original.x + original.width,
        y: original.y + original.height,
      });
      return {
        x: Math.min(localTL.x, localBR.x),
        y: Math.min(localTL.y, localBR.y),
        width: Math.abs(localBR.x - localTL.x),
        height: Math.abs(localBR.y - localTL.y),
      };
    }
    case "ellipse": {
      const newCenter = scaleLocal({ x: original.cx, y: original.cy });
      return {
        cx: newCenter.x,
        cy: newCenter.y,
        rx: Math.abs(original.rx) * sx * (original.rx < 0 ? -1 : 1),
        ry: Math.abs(original.ry) * sy * (original.ry < 0 ? -1 : 1),
      };
    }
    case "line":
    case "arrow": {
      const a = scaleLocal({ x: original.x1, y: original.y1 });
      const b = scaleLocal({ x: original.x2, y: original.y2 });
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case "text": {
      const tl = scaleLocal({ x: original.x, y: original.y });
      const br = scaleLocal({
        x: original.x + original.width,
        y: original.y + original.height,
      });
      const newWidth = Math.abs(br.x - tl.x);
      // scale font by the smaller axis so glyphs don't stretch
      const fontScale = Math.min(sx, sy);
      const newFont = Math.max(8, original.fontSize * fontScale);
      const newHeight = measureTextHeight(original.text, newWidth, newFont);
      return {
        x: Math.min(tl.x, br.x),
        y: Math.min(tl.y, br.y),
        width: newWidth,
        height: newHeight,
        fontSize: newFont,
      };
    }
  }
}

/** New rotation (radians) from the bbox centre to the pointer. Straight up is 0. */
export function angleFromPointer(
  centre: Point,
  pointerWorld: Point,
): number {
  // atan2 is from +x axis; +π/2 makes straight-up 0.
  return Math.atan2(pointerWorld.y - centre.y, pointerWorld.x - centre.x) + Math.PI / 2;
}
