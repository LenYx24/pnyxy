import { useCallback, useRef, useState, type PointerEvent } from "react";
import {
  INLINE_DRAW_STROKE_WIDTH,
  useInlineDrawStore,
  type Stroke,
} from "@/stores/inline-draw-store";

/**
 * SVG overlay sized to a single PDF page. Renders any stored strokes
 * for that page, and — when inline draw mode is active — captures
 * pointer events to record new strokes.
 *
 * Coordinates are NORMALISED to the page (0..1 along each axis), so
 * the same stroke draws correctly at any zoom level and any per-slot
 * CSS scale. We pass the unit space straight into the SVG via
 * `viewBox="0 0 1 1"` and let it scale to whatever pixel size the
 * PageSlot ends up rendered at.
 */
interface InlineDrawLayerProps {
  pageNum: number;
}

export function InlineDrawLayer({ pageNum }: InlineDrawLayerProps) {
  const active = useInlineDrawStore((s) => s.active);
  const color = useInlineDrawStore((s) => s.color);
  const strokes = useInlineDrawStore((s) =>
    (s.drawingsByPage.get(pageNum) ?? EMPTY),
  );
  const addStroke = useInlineDrawStore((s) => s.addStroke);

  const svgRef = useRef<SVGSVGElement>(null);
  // In-flight stroke (between pointer-down and pointer-up). Local
  // state so the partial line renders as the user moves; on
  // pointer-up we hand it off to the store and clear the buffer.
  const [draft, setDraft] = useState<Stroke | null>(null);

  const toUnit = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    if (e.button !== 0 && e.pointerType === "mouse") return; // left button only
    const p = toUnit(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    setDraft({
      color,
      width: INLINE_DRAW_STROKE_WIDTH,
      points: [p],
    });
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!active || !draft) return;
    const p = toUnit(e);
    if (!p) return;
    e.preventDefault();
    setDraft((prev) => {
      if (!prev) return prev;
      // Skip if the cursor barely moved — keeps stroke point counts
      // bounded for long drags.
      const last = prev.points[prev.points.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.002) return prev;
      return { ...prev, points: [...prev.points, p] };
    });
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    e.preventDefault();
    if (draft.points.length >= 2) {
      addStroke(pageNum, draft);
    }
    setDraft(null);
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      // not captured — ignore
    }
  };

  // Hide entirely when there are no strokes AND the user isn't drawing.
  // Avoids stacking another zero-effect overlay on every page.
  if (!active && strokes.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      // Cursor-target only when the user is in draw mode; otherwise
      // we still mount the SVG to display existing strokes but it
      // shouldn't intercept clicks meant for the text layer below.
      style={{
        position: "absolute",
        inset: 0,
        // pointer-events lets selection / scroll / etc. pass through
        // when not drawing, but become catchable when active.
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "crosshair" : undefined,
        // Sit above the text layer (z-index 2 in pdfjs's textLayer
        // CSS) but below any overlay panels that the reader uses
        // for TOC / comments / AI chat.
        zIndex: 15,
        touchAction: active ? "none" : "auto",
      }}
    >
      {strokes.map((s, i) => (
        <StrokePath key={i} stroke={s} />
      ))}
      {draft && <StrokePath stroke={draft} />}
    </svg>
  );
}

function StrokePath({ stroke }: { stroke: Stroke }) {
  if (stroke.points.length === 0) return null;
  const d = stroke.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`)
    .join(" ");
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke.color}
      // viewBox is 0..1 so we need to convert px width into the
      // unit-space equivalent by dividing by ~the page width. Using
      // a vector-effect keeps the stroke a constant pixel width
      // regardless of the SVG's actual rendered size.
      strokeWidth={stroke.width}
      vectorEffect="non-scaling-stroke"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.95}
    />
  );
}

const EMPTY: Stroke[] = [];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
