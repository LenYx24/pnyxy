import type {
  Point,
  WhiteboardBackground,
  WhiteboardElement,
} from "@/types/whiteboard";
import { getElementBounds } from "./math-utils";
import { wrapText, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY } from "./text-layout";

const GRID_SIZE = 20;
const GRID_COLOR = "rgba(255, 255, 255, 0.08)";

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: WhiteboardBackground,
  width: number,
  height: number,
  panX: number,
  panY: number,
  zoom: number,
) {
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, width, height);

  if (bg === "grid") {
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;

    const scaledGrid = GRID_SIZE * zoom;
    const offsetX = panX % scaledGrid;
    const offsetY = panY % scaledGrid;

    ctx.beginPath();
    for (let x = offsetX; x <= width; x += scaledGrid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = offsetY; y <= height; y += scaledGrid) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
}

/** Draw a single element. Assumes the world transform is already applied. */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement,
) {
  ctx.strokeStyle = el.strokeColor;
  ctx.lineWidth = el.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Rotation: pivot around the element's local-bbox centre. We
  // translate→rotate→translate back so each branch can keep its
  // existing axis-aligned coordinates.
  const rot = el.rotation ?? 0;
  let restore = false;
  if (rot !== 0) {
    const b = getElementBounds(el);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.translate(-cx, -cy);
    restore = true;
  }

  switch (el.type) {
    case "pen": {
      if (el.points.length === 0) return;
      if (el.points.length === 1) {
        ctx.beginPath();
        ctx.arc(el.points[0].x, el.points[0].y, el.strokeWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = el.strokeColor;
        ctx.fill();
        return;
      }
      // Smooth quadratic bezier through midpoints
      ctx.beginPath();
      ctx.moveTo(el.points[0].x, el.points[0].y);
      if (el.points.length === 2) {
        ctx.lineTo(el.points[1].x, el.points[1].y);
      } else {
        for (let i = 1; i < el.points.length - 1; i++) {
          const midX = (el.points[i].x + el.points[i + 1].x) / 2;
          const midY = (el.points[i].y + el.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, midX, midY);
        }
        const last = el.points[el.points.length - 1];
        ctx.lineTo(last.x, last.y);
      }
      ctx.stroke();
      break;
    }

    case "rectangle": {
      ctx.beginPath();
      ctx.rect(el.x, el.y, el.width, el.height);
      ctx.stroke();
      break;
    }

    case "ellipse": {
      ctx.beginPath();
      ctx.ellipse(el.cx, el.cy, Math.abs(el.rx), Math.abs(el.ry), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "line": {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      break;
    }

    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      const headLen = Math.max(10, el.strokeWidth * 4);
      ctx.beginPath();
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - headLen * Math.cos(angle - Math.PI / 6),
        el.y2 - headLen * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - headLen * Math.cos(angle + Math.PI / 6),
        el.y2 - headLen * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }

    case "text": {
      ctx.fillStyle = el.color;
      ctx.font = `${el.fontSize}px ${TEXT_FONT_FAMILY}`;
      ctx.textBaseline = "top";
      const lines = wrapText(ctx, el.text, el.width);
      const lineStep = el.fontSize * TEXT_LINE_HEIGHT;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], el.x, el.y + i * lineStep);
      }
      break;
    }
  }

  if (restore) ctx.restore();
}

export type ResizeHandle =
  | "nw" | "n" | "ne"
  | "w"          | "e"
  | "sw" | "s" | "se";

export const RESIZE_HANDLES: ResizeHandle[] = [
  "nw", "n", "ne", "e", "se", "s", "sw", "w",
];

/** A handle position, expressed in rotated world space (so callers can
 *  hit-test against pointer position directly). */
export interface HandleScreenInfo {
  kind: ResizeHandle | "rotate";
  x: number;
  y: number;
}

const HANDLE_SIZE_PX = 8;
const ROTATE_OFFSET_PX = 24;

/** Compute world-space positions of the 8 resize handles + the rotate
 *  handle for a single element, accounting for its rotation. zoom is
 *  needed to keep handle screen-size constant. */
export function getHandlePositions(
  el: WhiteboardElement,
  zoom: number,
): HandleScreenInfo[] {
  const b = getElementBounds(el);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rot = el.rotation ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  // Local-space (un-rotated) handle anchor points.
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const localPoints: Record<ResizeHandle | "rotate", Point> = {
    nw: { x: b.minX, y: b.minY },
    n: { x: cx, y: b.minY },
    ne: { x: b.maxX, y: b.minY },
    e: { x: b.maxX, y: cy },
    se: { x: b.maxX, y: b.maxY },
    s: { x: cx, y: b.maxY },
    sw: { x: b.minX, y: b.maxY },
    w: { x: b.minX, y: cy },
    rotate: { x: cx, y: b.minY - ROTATE_OFFSET_PX / zoom },
  };
  // Quiet the unused-but-derived warning.
  void w;
  void h;

  const out: HandleScreenInfo[] = [];
  for (const kind of [...RESIZE_HANDLES, "rotate" as const]) {
    const p = localPoints[kind];
    const dx = p.x - cx;
    const dy = p.y - cy;
    out.push({
      kind,
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    });
  }
  return out;
}

/** Draw selection handles around selected elements. Single-selection
 *  gets the full Excalidraw treatment (rotated bbox, 8 resize handles,
 *  rotate handle); multi-selection just gets a dashed axis-aligned
 *  outline because group transforms aren't implemented yet. */
export function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  elements: WhiteboardElement[],
  selectedIds: Set<string>,
  zoom: number,
) {
  const handleSize = HANDLE_SIZE_PX / zoom;
  const padding = 4 / zoom;

  if (selectedIds.size === 1) {
    const el = elements.find((e) => selectedIds.has(e.id));
    if (!el) return;

    const b = getElementBounds(el);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const rot = el.rotation ?? 0;

    // Rotate the 4 padded bbox corners into world space.
    const corners: Point[] = [
      { x: b.minX - padding, y: b.minY - padding },
      { x: b.maxX + padding, y: b.minY - padding },
      { x: b.maxX + padding, y: b.maxY + padding },
      { x: b.minX - padding, y: b.maxY + padding },
    ].map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        x: cx + dx * Math.cos(rot) - dy * Math.sin(rot),
        y: cy + dx * Math.sin(rot) + dy * Math.cos(rot),
      };
    });

    // Dashed rotated bbox
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.strokeStyle = "#7c5cfc";
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // 8 resize handles + 1 rotate handle. Rotate handle is a circle,
    // resize handles are squares.
    const handles = getHandlePositions(el, zoom);
    for (const h of handles) {
      if (h.kind === "rotate") {
        // Stem from top-mid handle to rotate
        const topMid = handles.find((x) => x.kind === "n")!;
        ctx.strokeStyle = "#7c5cfc";
        ctx.lineWidth = 1 / zoom;
        ctx.beginPath();
        ctx.moveTo(topMid.x, topMid.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#7c5cfc";
        ctx.lineWidth = 1.5 / zoom;
        ctx.beginPath();
        ctx.arc(h.x, h.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#7c5cfc";
        ctx.lineWidth = 1.5 / zoom;
        ctx.fillRect(
          h.x - handleSize / 2,
          h.y - handleSize / 2,
          handleSize,
          handleSize,
        );
        ctx.strokeRect(
          h.x - handleSize / 2,
          h.y - handleSize / 2,
          handleSize,
          handleSize,
        );
      }
    }
    return;
  }

  // Multi-selection: just outline each element's axis-aligned bbox.
  for (const el of elements) {
    if (!selectedIds.has(el.id)) continue;
    const b = getElementBounds(el);
    const x = b.minX - padding;
    const y = b.minY - padding;
    const w = b.maxX - b.minX + padding * 2;
    const h = b.maxY - b.minY + padding * 2;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.strokeStyle = "#7c5cfc";
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
}

/** Hit-test the screen-space position against the visible handles of
 *  a single-selected element. Returns the handle kind hit, or null. */
export function hitTestHandle(
  el: WhiteboardElement,
  worldPoint: Point,
  zoom: number,
): ResizeHandle | "rotate" | null {
  const handles = getHandlePositions(el, zoom);
  // Handle hit radius in world units (slightly larger than visual
  // size for forgiveness on touch + thin handles).
  const r = (HANDLE_SIZE_PX + 4) / zoom;
  for (const h of handles) {
    const dx = worldPoint.x - h.x;
    const dy = worldPoint.y - h.y;
    if (Math.abs(dx) <= r && Math.abs(dy) <= r) return h.kind;
  }
  return null;
}
