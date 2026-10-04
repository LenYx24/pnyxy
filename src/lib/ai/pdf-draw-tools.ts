// Drawing tools for the reader's AI chat while inline-draw mode is on. The
// model sees the current page with the user's drawings (page-capture.ts); these
// let it draw back on that page. Everything goes through the inline-draw store
// in the same normalised page coordinates the pointer tools use, so an AI mark
// is an ordinary element: selectable, movable, erasable and undoable.
//
// Approval policy matches the whiteboard tools: adding is additive and undo
// takes it back, so it runs unattended; erasing asks first.

import type { ToolDef } from "@/lib/roadmap/roadmap-tools";
import {
  INLINE_DRAW_DEFAULT_WIDTH,
  makeId,
  useInlineDrawStore,
  type InlineElement,
  type Pt,
} from "@/stores/inline-draw-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import { teacherBlock } from "@/lib/ai/teacher-mode";
import type { ToolOutcome } from "@/lib/ai/whiteboard-tools";

/** Keeps one reply from burying the page; the model can always add more. */
const MAX_SHAPES_PER_CALL = 30;
const MAX_POINTS_PER_STROKE = 400;
const MAX_LISTED_ELEMENTS = 80;
/** Shapes smaller than this (fraction of the page) would be invisible specks. */
const MIN_EXTENT = 0.002;
const MIN_WIDTH = 1;
const MAX_WIDTH = 12;
/** AI marks default to blue so they stand apart from the user's red pen. */
export const AI_DEFAULT_COLOR = "#3b82f6";

export interface PdfDrawTarget {
  /** Reader document id; also the inline-draw store's book id. */
  docId: string;
  /** 1-based page the user is on (and the one in the attached image). */
  page: number;
  /** Page count, when known, to reject out-of-range `page` arguments. */
  totalPages?: number;
}

const PAGE_PROP = {
  type: "integer",
  description: "1-based page number. Defaults to the page in the attached image.",
};

export const PDF_DRAW_TOOLS: ToolDef[] = [
  {
    name: "list_page_drawings",
    description:
      "List the drawings currently on a page: each element's id, type, colour and rough position (as page fractions). Use it before erasing anything, or when the attached image is unclear.",
    input_schema: { type: "object", properties: { page: PAGE_PROP } },
  },
  {
    name: "draw_shapes",
    description:
      "Draw shapes on the PDF page. Coordinates are fractions of the page: x from 0 (left edge) to 1 (right edge), y from 0 (top edge) to 1 (bottom edge), matching the attached page image. Additive and undoable, so no confirmation is needed. Prefer one call with several shapes over many calls.",
    input_schema: {
      type: "object",
      properties: {
        page: PAGE_PROP,
        shapes: {
          type: "array",
          description: `Shapes to draw, in order (at most ${MAX_SHAPES_PER_CALL}).`,
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["rectangle", "ellipse", "line", "arrow", "stroke"],
              },
              x: { type: "number", description: "Rectangle left edge (0..1)." },
              y: { type: "number", description: "Rectangle top edge (0..1)." },
              w: { type: "number", description: "Rectangle width (fraction of page width)." },
              h: { type: "number", description: "Rectangle height (fraction of page height)." },
              cx: { type: "number", description: "Ellipse centre x (0..1)." },
              cy: { type: "number", description: "Ellipse centre y (0..1)." },
              rx: { type: "number", description: "Ellipse horizontal radius (fraction of page width)." },
              ry: { type: "number", description: "Ellipse vertical radius (fraction of page height)." },
              x1: { type: "number", description: "Line/arrow start x (0..1)." },
              y1: { type: "number", description: "Line/arrow start y (0..1)." },
              x2: { type: "number", description: "Line/arrow end x (0..1); the arrow head lands here." },
              y2: { type: "number", description: "Line/arrow end y (0..1)." },
              points: {
                type: "array",
                description: "Freehand path for type=stroke, as [{x,y}, …] in 0..1.",
                items: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
              },
              color: {
                type: "string",
                description: `Colour as #rrggbb. Defaults to ${AI_DEFAULT_COLOR} (blue).`,
              },
              strokeWidth: {
                type: "number",
                description: `Stroke thickness in screen px, ${MIN_WIDTH}..${MAX_WIDTH} (default ${INLINE_DRAW_DEFAULT_WIDTH}).`,
              },
            },
            required: ["type"],
          },
        },
      },
      required: ["shapes"],
    },
  },
  {
    name: "erase_elements",
    description:
      "Erase drawings from a page by id (from list_page_drawings). Asks the user for approval first.",
    input_schema: {
      type: "object",
      properties: {
        page: PAGE_PROP,
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
    },
  },
];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
/** Only #rgb / #rrggbb get through, so a bad guess can't inject CSS. */
function asColor(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fallback;
}
function r2(v: number): string {
  return v.toFixed(2);
}

/** One-line description in page fractions, for the model and approval card. */
export function describeInlineElement(el: InlineElement): string {
  switch (el.type) {
    case "pen": {
      const first = el.points[0];
      return `[stroke] id: ${el.id}, ${el.points.length} points starting at (${r2(first?.x ?? 0)}, ${r2(first?.y ?? 0)}), ${el.color}`;
    }
    case "rectangle":
      return `[rectangle] id: ${el.id}, x: ${r2(el.x)}, y: ${r2(el.y)}, w: ${r2(el.w)}, h: ${r2(el.h)}, ${el.color}`;
    case "ellipse":
      return `[ellipse] id: ${el.id}, cx: ${r2(el.cx)}, cy: ${r2(el.cy)}, rx: ${r2(el.rx)}, ry: ${r2(el.ry)}, ${el.color}`;
    case "line":
    case "arrow":
      return `[${el.type}] id: ${el.id}, from (${r2(el.x1)}, ${r2(el.y1)}) to (${r2(el.x2)}, ${r2(el.y2)}), ${el.color}`;
  }
}

/**
 * Build one inline element from the model's loose shape spec, clamped onto
 * the page, or null when unusable. Exported for the unit tests: this is the
 * gate between "what the model said" and "what lands on the user's page".
 */
export function buildInlineElement(
  spec: Record<string, unknown>,
  defaults: { color: string; width: number } = {
    color: AI_DEFAULT_COLOR,
    width: INLINE_DRAW_DEFAULT_WIDTH,
  },
): InlineElement | null {
  const base = {
    id: makeId(),
    color: asColor(spec.color, defaults.color),
    width: clamp(num(spec.strokeWidth) ?? defaults.width, MIN_WIDTH, MAX_WIDTH),
  };

  switch (spec.type) {
    case "rectangle": {
      const x = num(spec.x);
      const y = num(spec.y);
      // the model sometimes borrows the whiteboard's width/height names
      const w = num(spec.w) ?? num(spec.width);
      const h = num(spec.h) ?? num(spec.height);
      if (x === null || y === null || w === null || h === null) return null;
      const left = clamp01(Math.min(x, x + w));
      const right = clamp01(Math.max(x, x + w));
      const top = clamp01(Math.min(y, y + h));
      const bottom = clamp01(Math.max(y, y + h));
      if (right - left < MIN_EXTENT || bottom - top < MIN_EXTENT) return null;
      return { ...base, type: "rectangle", x: left, y: top, w: right - left, h: bottom - top };
    }
    case "ellipse": {
      const cx = num(spec.cx);
      const cy = num(spec.cy);
      const rx = num(spec.rx);
      const ry = num(spec.ry);
      if (cx === null || cy === null || rx === null || ry === null) return null;
      const crx = clamp(Math.abs(rx), 0, 0.5);
      const cry = clamp(Math.abs(ry), 0, 0.5);
      if (crx < MIN_EXTENT || cry < MIN_EXTENT) return null;
      return { ...base, type: "ellipse", cx: clamp01(cx), cy: clamp01(cy), rx: crx, ry: cry };
    }
    case "line":
    case "arrow": {
      const x1 = num(spec.x1);
      const y1 = num(spec.y1);
      const x2 = num(spec.x2);
      const y2 = num(spec.y2);
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
      const p1 = { x: clamp01(x1), y: clamp01(y1) };
      const p2 = { x: clamp01(x2), y: clamp01(y2) };
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < MIN_EXTENT) return null;
      return { ...base, type: spec.type, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case "stroke":
    case "pen": {
      const raw = Array.isArray(spec.points) ? spec.points : [];
      const points: Pt[] = [];
      for (const p of raw.slice(0, MAX_POINTS_PER_STROKE)) {
        if (!p || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        const px = num(rec.x);
        const py = num(rec.y);
        if (px === null || py === null) continue;
        points.push({ x: clamp01(px), y: clamp01(py) });
      }
      if (points.length < 2) return null;
      return { ...base, type: "pen", points };
    }
    default:
      return null;
  }
}

/** Resolve the optional `page` argument against the target. */
function resolvePage(
  input: Record<string, unknown>,
  target: PdfDrawTarget,
): number | string {
  const raw = num(input.page);
  if (raw === null) return target.page;
  const page = Math.round(raw);
  const max = target.totalPages && target.totalPages > 0 ? target.totalPages : Infinity;
  if (page < 1 || page > max) {
    return `Error: page ${raw} is out of range${Number.isFinite(max) ? ` (1..${max})` : ""}.`;
  }
  return page;
}

/** System prompt for the reader draw loop. */
export function buildPdfDrawSystemPrompt(
  target: PdfDrawTarget,
  extraContext?: string,
): string {
  const elements = useInlineDrawStore.getState().elementsForPage(target.page);
  const inventory = elements
    .slice(-MAX_LISTED_ELEMENTS)
    .map(describeInlineElement)
    .join("\n");

  return [
    "You are a tutor helping the user study a PDF document. The user has the",
    "reader's drawing mode on, so you can see the page they are on and draw on it.",
    "",
    `The image attached to the user's latest message is page ${target.page} of the`,
    "document, with the user's own drawings (pen strokes, boxes, circles, arrows)",
    "painted on top. Read those marks as part of the question: a circled formula",
    "or an arrow usually points at what they are asking about.",
    "",
    "Drawing tools: coordinates are fractions of the page, x from 0 (left) to 1",
    "(right), y from 0 (top) to 1 (bottom), the same frame as the attached image.",
    "There is no text tool: annotate with arrows, boxes, circles, underlines and",
    "short strokes, and put every word of explanation in your reply. Mark only what",
    "helps the explanation, a handful of deliberate shapes beats many tiny ones.",
    "Keep marks tight around the thing they point at and do not cover the text",
    "you are referring to. Your marks default to blue so the user can tell them",
    "from their own. Only draw when it helps; a plain answer is fine otherwise.",
    "After drawing, say briefly what each mark highlights.",
    "",
    elements.length > 0
      ? `Drawings on page ${target.page} (${elements.length}, newest last):\n${inventory}`
      : `Page ${target.page} has no drawings yet.`,
    extraContext ? `\n${extraContext}` : "",
  ].join("\n") + teacherBlock();
}

const DECLINED =
  "The user declined this action. Do not retry it; continue without it.";

export async function dispatchPdfDrawTool(
  name: string,
  rawInput: unknown,
  target: PdfDrawTarget,
): Promise<ToolOutcome> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const store = useInlineDrawStore.getState();

  // the user may have switched documents mid-turn; never draw into another book
  if (store.currentBookId !== target.docId) {
    return {
      ok: false,
      summary: `${name}: the document is no longer open`,
      modelOutput: "Error: the document is no longer open in the reader. Stop drawing and answer in text.",
    };
  }

  const page = resolvePage(input, target);
  if (typeof page === "string") {
    return { ok: false, summary: `${name}: page out of range`, modelOutput: page };
  }

  try {
    switch (name) {
      case "list_page_drawings": {
        const els = store.elementsForPage(page);
        if (els.length === 0) {
          return {
            ok: true,
            summary: `Looked at page ${page} (no drawings)`,
            modelOutput: `Page ${page} has no drawings.`,
          };
        }
        return {
          ok: true,
          summary: `Looked at page ${page} (${els.length} drawings)`,
          modelOutput: els.slice(-MAX_LISTED_ELEMENTS).map(describeInlineElement).join("\n"),
        };
      }

      case "draw_shapes": {
        const specs = Array.isArray(input.shapes) ? input.shapes : [];
        if (specs.length === 0) {
          return {
            ok: false,
            summary: "draw_shapes: nothing to draw",
            modelOutput: "Error: shapes is required and must not be empty.",
          };
        }
        const built: InlineElement[] = [];
        let rejected = 0;
        for (const spec of specs.slice(0, MAX_SHAPES_PER_CALL)) {
          const el =
            spec && typeof spec === "object"
              ? buildInlineElement(spec as Record<string, unknown>)
              : null;
          if (el) built.push(el);
          else rejected += 1;
        }
        const capped = Math.max(0, specs.length - MAX_SHAPES_PER_CALL);
        if (built.length === 0) {
          return {
            ok: false,
            summary: "draw_shapes: no usable shapes",
            modelOutput:
              "Error: none of the shapes were usable. Each needs its fields as page fractions (rectangle: x,y,w,h; ellipse: cx,cy,rx,ry; line/arrow: x1,y1,x2,y2; stroke: at least two points).",
          };
        }
        for (const el of built) store.addElement(page, el);
        const notes: string[] = [];
        if (rejected > 0) notes.push(`${rejected} skipped as malformed`);
        if (capped > 0) notes.push(`${capped} over the ${MAX_SHAPES_PER_CALL}-shape limit dropped`);
        const note = notes.length > 0 ? ` (${notes.join(", ")})` : "";
        return {
          ok: true,
          summary: `Drew ${built.length} mark${built.length === 1 ? "" : "s"} on page ${page}${note}`,
          modelOutput: `Drew ${built.length} element(s) on page ${page}${note}. Ids: ${built.map((e) => e.id).join(", ")}.`,
        };
      }

      case "erase_elements": {
        const raw = Array.isArray(input.ids) ? input.ids : [];
        const ids = raw.filter((v): v is string => typeof v === "string");
        const present = store.elementsForPage(page).filter((el) => ids.includes(el.id));
        if (present.length === 0) {
          return {
            ok: false,
            summary: "erase_elements: nothing matched",
            modelOutput: `Error: none of those ids are on page ${page}. Call list_page_drawings first.`,
          };
        }
        const ok = await useToolApprovalStore.getState().request({
          tool: name,
          summary: `Erase ${present.length} drawing${present.length === 1 ? "" : "s"} on page ${page}`,
          details: present.slice(0, 8).map(describeInlineElement),
        });
        if (!ok) {
          return { ok: false, summary: "Skipped erasing", modelOutput: DECLINED };
        }
        const live = useInlineDrawStore.getState();
        for (const el of present) live.removeElement(page, el.id);
        return {
          ok: true,
          summary: `Erased ${present.length} drawing${present.length === 1 ? "" : "s"}`,
          modelOutput: `Erased ${present.length} element(s) from page ${page}.`,
        };
      }

      default:
        return { ok: false, summary: `Unknown tool ${name}`, modelOutput: `Error: unknown tool "${name}".` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `${name} failed`, modelOutput: `Error: ${message}` };
  }
}
