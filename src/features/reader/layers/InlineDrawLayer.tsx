import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  makeId,
  useInlineDrawStore,
  type InlineElement,
  type Pt,
} from "@/stores/inline-draw-store";
import {
  clamp01,
  getBounds,
  handlePositions,
  hitElement,
  resizeBounds,
  setBounds,
  translateElement,
  type Bounds,
  type HandleId,
} from "./inline-draw-geometry";

/**
 * SVG overlay sized to a single PDF page. Renders stored drawing
 * elements for that page and, when inline-draw mode is active, captures
 * pointer events for the current tool: freehand pen, shapes (rectangle,
 * ellipse, line, arrow), an eraser, and a select tool that
 * moves/resizes placed elements.
 *
 * Coordinates are NORMALISED (0..1 per axis) so drawings render
 * correctly at any zoom; `viewBox="0 0 1 1"` maps unit space to the
 * page's rendered pixel box. Stroke widths use `non-scaling-stroke` so
 * they stay a constant pixel width.
 */
interface InlineDrawLayerProps {
  pageNum: number;
}

const EMPTY: InlineElement[] = [];

type Drag =
  | { mode: "move"; id: string; start: Pt; orig: InlineElement }
  | { mode: "resize"; id: string; handle: HandleId; orig: InlineElement };

export function InlineDrawLayer({ pageNum }: InlineDrawLayerProps) {
  const active = useInlineDrawStore((s) => s.active);
  const tool = useInlineDrawStore((s) => s.tool);
  const color = useInlineDrawStore((s) => s.color);
  const width = useInlineDrawStore((s) => s.width);
  const selectedId = useInlineDrawStore((s) => s.selectedId);
  const elements = useInlineDrawStore((s) => s.drawingsByPage.get(pageNum) ?? EMPTY);
  const addElement = useInlineDrawStore((s) => s.addElement);
  const updateElement = useInlineDrawStore((s) => s.updateElement);
  const removeElement = useInlineDrawStore((s) => s.removeElement);
  const select = useInlineDrawStore((s) => s.select);
  const setTool = useInlineDrawStore((s) => s.setTool);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<InlineElement | null>(null);
  // Live preview of an element being moved/resized (overrides the stored
  // copy until pointer-up commits it).
  const [preview, setPreview] = useState<{ id: string; el: InlineElement } | null>(
    null,
  );
  // Rendered pixel size of the SVG, for px→unit conversions (handles,
  // hit tolerance, arrowheads). Kept in state so it survives zoom.
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const minPx = Math.max(1, Math.min(size.w || 1, size.h || 1));
  const hitTol = size.w ? 8 / minPx : 0.02;
  const handleTol = size.w ? 12 / minPx : 0.03;

  const toUnit = useCallback((e: PointerEvent<SVGSVGElement>): Pt | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }, []);

  const hitHandle = useCallback(
    (b: Bounds, p: Pt): HandleId | null => {
      const hp = handlePositions(b);
      for (const k of ["nw", "ne", "sw", "se"] as HandleId[]) {
        if (Math.abs(p.x - hp[k].x) <= handleTol && Math.abs(p.y - hp[k].y) <= handleTol) {
          return k;
        }
      }
      return null;
    },
    [handleTol],
  );

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = toUnit(e);
    if (!p) return;

    if (tool === "eraser") {
      // Topmost-first hit.
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitElement(elements[i], p, hitTol)) {
          e.preventDefault();
          e.stopPropagation();
          removeElement(pageNum, elements[i].id);
          break;
        }
      }
      return;
    }

    if (tool === "select") {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      // Resize handle of the current selection?
      const sel = elements.find((el) => el.id === selectedId);
      if (sel) {
        const handle = hitHandle(getBounds(sel), p);
        if (handle) {
          dragRef.current = { mode: "resize", id: sel.id, handle, orig: sel };
          setPreview({ id: sel.id, el: sel });
          return;
        }
      }
      // Select / start move (topmost-first).
      for (let i = elements.length - 1; i >= 0; i--) {
        if (hitElement(elements[i], p, hitTol)) {
          const el = elements[i];
          select(el.id);
          dragRef.current = { mode: "move", id: el.id, start: p, orig: el };
          setPreview({ id: el.id, el });
          return;
        }
      }
      select(null);
      return;
    }

    // Drawing tools.
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const base = { id: makeId(), color, width };
    let el: InlineElement;
    switch (tool) {
      case "pen":
        el = { ...base, type: "pen", points: [p] };
        break;
      case "rectangle":
        el = { ...base, type: "rectangle", x: p.x, y: p.y, w: 0, h: 0 };
        break;
      case "ellipse":
        el = { ...base, type: "ellipse", cx: p.x, cy: p.y, rx: 0, ry: 0 };
        break;
      case "line":
        el = { ...base, type: "line", x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        break;
      case "arrow":
        el = { ...base, type: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        break;
      default:
        return;
    }
    setDraft(el);
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    const p = toUnit(e);
    if (!p) return;

    const drag = dragRef.current;
    if (drag) {
      e.preventDefault();
      if (drag.mode === "move") {
        setPreview({
          id: drag.id,
          el: translateElement(drag.orig, p.x - drag.start.x, p.y - drag.start.y),
        });
      } else {
        const nb = resizeBounds(getBounds(drag.orig), drag.handle, p);
        setPreview({ id: drag.id, el: setBounds(drag.orig, nb) });
      }
      return;
    }

    if (draft) {
      e.preventDefault();
      setDraft((prev) => (prev ? updateDraft(prev, p) : prev));
    }
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag) {
      e.preventDefault();
      if (preview) updateElement(pageNum, drag.id, preview.el);
      dragRef.current = null;
      setPreview(null);
      releaseCapture(e);
      return;
    }
    if (draft) {
      e.preventDefault();
      const committed = finalizeDraft(draft);
      if (committed) {
        addElement(pageNum, committed);
        // Discrete shapes auto-select + flip to the select tool so the
        // user can immediately nudge/resize them; pen stays sticky.
        if (committed.type !== "pen") {
          select(committed.id);
          setTool("select");
        }
      }
      setDraft(null);
      releaseCapture(e);
    }
  };

  // Hide entirely when nothing to show and not drawing.
  if (!active && elements.length === 0) return null;

  const selectedEl =
    tool === "select" && selectedId
      ? preview?.id === selectedId
        ? preview.el
        : elements.find((el) => el.id === selectedId)
      : undefined;

  const cursor = !active
    ? undefined
    : tool === "eraser"
      ? "cell"
      : tool === "select"
        ? "default"
        : "crosshair";

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
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: active ? "auto" : "none",
        cursor,
        zIndex: 15,
        touchAction: active ? "none" : "auto",
      }}
    >
      {elements.map((el) => (
        <ElementShape
          key={el.id}
          el={preview?.id === el.id ? preview.el : el}
          size={size}
        />
      ))}
      {draft && <ElementShape el={draft} size={size} />}
      {selectedEl && <SelectionOverlay el={selectedEl} size={size} />}
    </svg>
  );
}

function releaseCapture(e: PointerEvent<SVGSVGElement>) {
  try {
    (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
  } catch {
    // not captured
  }
}

/** Update an in-progress draft with the current pointer position. */
function updateDraft(prev: InlineElement, p: Pt): InlineElement {
  switch (prev.type) {
    case "pen": {
      const last = prev.points[prev.points.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.002) return prev;
      return { ...prev, points: [...prev.points, p] };
    }
    case "rectangle":
      return { ...prev, w: p.x - prev.x, h: p.y - prev.y };
    case "ellipse":
      return { ...prev, rx: p.x - prev.cx, ry: p.y - prev.cy };
    case "line":
    case "arrow":
      return { ...prev, x2: p.x, y2: p.y };
  }
}

/** Normalise a finished draft; return null if it's too small to keep. */
function finalizeDraft(el: InlineElement): InlineElement | null {
  const EPS = 0.004;
  switch (el.type) {
    case "pen":
      return el.points.length >= 2 ? el : null;
    case "rectangle": {
      let { x, y, w, h } = el;
      if (w < 0) {
        x += w;
        w = -w;
      }
      if (h < 0) {
        y += h;
        h = -h;
      }
      if (w < EPS && h < EPS) return null;
      return { ...el, x, y, w, h };
    }
    case "ellipse": {
      const rx = Math.abs(el.rx);
      const ry = Math.abs(el.ry);
      if (rx < EPS && ry < EPS) return null;
      return { ...el, rx, ry };
    }
    case "line":
    case "arrow":
      return Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < EPS ? null : el;
  }
}

function ElementShape({
  el,
  size,
}: {
  el: InlineElement;
  size: { w: number; h: number };
}) {
  const common = {
    fill: "none",
    stroke: el.color,
    strokeWidth: el.width,
    vectorEffect: "non-scaling-stroke" as const,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    opacity: 0.95,
  };

  switch (el.type) {
    case "pen": {
      if (el.points.length === 0) return null;
      const d = el.points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`)
        .join(" ");
      return <path d={d} {...common} />;
    }
    case "rectangle": {
      const x = Math.min(el.x, el.x + el.w);
      const y = Math.min(el.y, el.y + el.h);
      return (
        <rect x={x} y={y} width={Math.abs(el.w)} height={Math.abs(el.h)} {...common} />
      );
    }
    case "ellipse":
      return (
        <ellipse
          cx={el.cx}
          cy={el.cy}
          rx={Math.abs(el.rx)}
          ry={Math.abs(el.ry)}
          {...common}
        />
      );
    case "line":
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...common} />;
    case "arrow": {
      const head = arrowHead(el, size);
      return (
        <g>
          <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...common} />
          {head && (
            <>
              <line x1={el.x2} y1={el.y2} x2={head.a.x} y2={head.a.y} {...common} />
              <line x1={el.x2} y1={el.y2} x2={head.b.x} y2={head.b.y} {...common} />
            </>
          )}
        </g>
      );
    }
  }
}

/** Arrowhead endpoints, computed in screen space then mapped back to
 *  unit space so the head keeps a constant pixel size and correct angle
 *  under the SVG's non-uniform (preserveAspectRatio="none") scale. */
function arrowHead(
  el: { x1: number; y1: number; x2: number; y2: number },
  size: { w: number; h: number },
): { a: Pt; b: Pt } | null {
  if (!size.w || !size.h) return null;
  const sdx = (el.x2 - el.x1) * size.w;
  const sdy = (el.y2 - el.y1) * size.h;
  if (sdx === 0 && sdy === 0) return null;
  const ang = Math.atan2(sdy, sdx);
  const headPx = 11;
  const a1 = ang - Math.PI / 6;
  const a2 = ang + Math.PI / 6;
  return {
    a: {
      x: el.x2 - (headPx * Math.cos(a1)) / size.w,
      y: el.y2 - (headPx * Math.sin(a1)) / size.h,
    },
    b: {
      x: el.x2 - (headPx * Math.cos(a2)) / size.w,
      y: el.y2 - (headPx * Math.sin(a2)) / size.h,
    },
  };
}

function SelectionOverlay({
  el,
  size,
}: {
  el: InlineElement;
  size: { w: number; h: number };
}) {
  const b = getBounds(el);
  const hw = size.w ? 9 / size.w : 0.012;
  const hh = size.h ? 9 / size.h : 0.012;
  const accent = "var(--color-accent)";
  const corners = handlePositions(b);
  return (
    <g pointerEvents="none">
      <rect
        x={b.minX}
        y={b.minY}
        width={b.maxX - b.minX}
        height={b.maxY - b.minY}
        fill="none"
        stroke={accent}
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
        opacity={0.9}
      />
      {(Object.values(corners) as Pt[]).map((c, i) => (
        <rect
          key={i}
          x={c.x - hw / 2}
          y={c.y - hh / 2}
          width={hw}
          height={hh}
          fill={accent}
          stroke="#fff"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}
