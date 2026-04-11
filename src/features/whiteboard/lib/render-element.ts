import type { WhiteboardElement, WhiteboardBackground } from "@/types/whiteboard";
import { getElementBounds } from "./math-utils";

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
  }
}

/** Draw selection handles around selected elements. */
export function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  elements: WhiteboardElement[],
  selectedIds: Set<string>,
  zoom: number,
) {
  const padding = 4 / zoom;
  const handleSize = 6 / zoom;

  for (const el of elements) {
    if (!selectedIds.has(el.id)) continue;

    const bounds = getElementBounds(el);
    const x = bounds.minX - padding;
    const y = bounds.minY - padding;
    const w = bounds.maxX - bounds.minX + padding * 2;
    const h = bounds.maxY - bounds.minY + padding * 2;

    // Dashed bounding box
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.strokeStyle = "#7c5cfc";
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Corner handles
    ctx.fillStyle = "#7c5cfc";
    const corners = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ];
    for (const [cx, cy] of corners) {
      ctx.fillRect(
        cx - handleSize / 2,
        cy - handleSize / 2,
        handleSize,
        handleSize,
      );
    }
  }
}
