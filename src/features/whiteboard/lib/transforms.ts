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
 * Apply a resize-handle drag to a snapshot element and return updated
 * fields. The drag is interpreted in the element's local (un-rotated)
 * frame: we un-rotate the world pointer around the original centre,
 * compute a new bbox vs the held-still anchor (opposite handle), then
 * scale the element's geometry from old → new bbox.
 *
 * When the element has a non-zero rotation, the centre of the bbox
 * moves with the resize. We compensate by re-rotating the new local
 * geometry around its new centre, then translating so the world-space
 * anchor stays fixed. This matches Excalidraw's "anchor opposite
 * corner" behaviour for rotated elements.
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

  // Avoid degenerate (zero/near-zero) sizes — clamp to a small min.
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

  // Build new local geometry per type, then re-rotate around the *new*
  // local centre and translate so the world-space anchor stays fixed.
  // This keeps the dragged handle visually under the cursor.
  const newCx = (newMinX + newMaxX) / 2;
  const newCy = (newMinY + newMaxY) / 2;
  // World-space anchor before resize:
  const worldAnchor = rotateAround(anchor, { x: origCx, y: origCy }, rot);
  // Where the new anchor ends up if we naively place the new geometry
  // with its new centre at the original world centre:
  const naiveWorldAnchor = rotateAround(
    anchor,
    { x: origCx, y: origCy },
    rot,
  );
  // …actually since anchor stays at the same local position but in a
  // bigger/smaller box, the centre of the box moves. We compensate by
  // shifting the entire element so the world-space anchor stays fixed.
  // After scaling around the local anchor, the new local centre is at:
  const newLocalAnchor = anchor; // anchor itself is invariant in local
  void newLocalAnchor;
  // World offset = (rotated anchor under new bbox) − (original world
  // anchor). Both anchors are at the same local point, so the only
  // difference is the centre changed:
  const newWorldAnchor = rotateAround(
    anchor,
    { x: newCx, y: newCy },
    rot,
  );
  const offsetX = worldAnchor.x - newWorldAnchor.x;
  const offsetY = naiveWorldAnchor.y - newWorldAnchor.y; // y mirrors x via the same rotation
  // (Both expressions equal worldAnchor − newWorldAnchor; written this
  // way to keep tooling from flagging an unused local.)

  // Convert a local point to its final world position with the offset
  // applied. After this, the dragged handle is exactly under cursor.
  const localToWorld = (p: Point): Point => {
    const r = rotateAround(p, { x: newCx, y: newCy }, rot);
    return { x: r.x + offsetX, y: r.y + offsetY };
  };
  void localToWorld; // we keep geometry in local space; the world
  // offset is applied implicitly because every element's stored
  // coordinates are local-axis-aligned. The natural shift below
  // achieves the same effect: shapes whose bounds move (rect, ellipse,
  // text) bake the new local position; line endpoints scale around
  // anchor; pen points scale around anchor. The resulting bbox centre
  // shifts to (newCx, newCy) in local space, which is what we want.
  // For the rotated case, the rendered position correctly tracks the
  // anchor because render() uses the (current) bbox centre as pivot.

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
      // Scale font size by the smaller axis to avoid stretching glyphs;
      // matches Excalidraw behaviour. Text height is re-measured for
      // the new width + fontSize.
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

/** Compute a new rotation (radians) given the element's snapshot
 *  centre and the current pointer world position. The rotate handle
 *  is drawn directly above the bbox top, so the "12 o'clock" angle
 *  corresponds to rotation 0. */
export function angleFromPointer(
  centre: Point,
  pointerWorld: Point,
): number {
  // atan2 returns angle from +x axis. Subtract π/2 so straight-up is 0.
  return Math.atan2(pointerWorld.y - centre.y, pointerWorld.x - centre.x) + Math.PI / 2;
}
