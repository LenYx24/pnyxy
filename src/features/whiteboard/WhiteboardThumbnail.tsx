import { useMemo } from "react";
import type { WhiteboardElement } from "@/types/whiteboard";

/**
 * Lightweight read-only thumbnail of a whiteboard: re-renders its
 * vector elements as a single SVG, auto-fitted to the elements'
 * bounding box. No canvas, no store, pure data → SVG, so it's cheap
 * enough to drop into every library grid card. Rotation is ignored
 * (negligible at thumbnail scale). Returns null for an empty board so
 * callers can fall back to a placeholder icon.
 */
export function WhiteboardThumbnail({
  elements,
  className,
}: {
  elements: WhiteboardElement[];
  className?: string;
}) {
  const view = useMemo(() => computeViewBox(elements), [elements]);
  if (!view) return null;
  return (
    <svg
      className={className}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {elements.map(renderElement)}
    </svg>
  );
}

function computeViewBox(elements: WhiteboardElement[]) {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const ext = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const el of elements) {
    switch (el.type) {
      case "pen":
        for (const p of el.points) ext(p.x, p.y);
        break;
      case "rectangle":
        ext(el.x, el.y);
        ext(el.x + el.width, el.y + el.height);
        break;
      case "ellipse":
        ext(el.cx - el.rx, el.cy - el.ry);
        ext(el.cx + el.rx, el.cy + el.ry);
        break;
      case "line":
      case "arrow":
        ext(el.x1, el.y1);
        ext(el.x2, el.y2);
        break;
      case "text":
        ext(el.x, el.y);
        ext(el.x + el.width, el.y + el.height);
        break;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  // Pad proportionally so strokes near the edge aren't clipped.
  const pad = Math.max(8, (maxX - minX + (maxY - minY)) * 0.04);
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(1, maxX - minX + pad * 2),
    h: Math.max(1, maxY - minY + pad * 2),
  };
}

function renderElement(el: WhiteboardElement) {
  const stroke = {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (el.type) {
    case "pen":
      return (
        <polyline
          key={el.id}
          points={el.points.map((p) => `${p.x},${p.y}`).join(" ")}
          {...stroke}
        />
      );
    case "rectangle":
      return (
        <rect
          key={el.id}
          x={el.x}
          y={el.y}
          width={el.width}
          height={el.height}
          {...stroke}
        />
      );
    case "ellipse":
      return (
        <ellipse
          key={el.id}
          cx={el.cx}
          cy={el.cy}
          rx={el.rx}
          ry={el.ry}
          {...stroke}
        />
      );
    case "line":
    case "arrow":
      return (
        <line
          key={el.id}
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          {...stroke}
        />
      );
    case "text":
      return (
        <text
          key={el.id}
          x={el.x}
          y={el.y + el.fontSize}
          fontSize={el.fontSize}
          fill={el.color}
        >
          {el.text}
        </text>
      );
    default:
      return null;
  }
}
