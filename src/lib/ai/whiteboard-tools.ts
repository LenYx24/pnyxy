// Whiteboard tools for the board's AI side-chat. The model already sees the
// board as an image (board-capture.ts); these let it draw back. Everything
// runs client-side against the whiteboard store, in the same world
// coordinates the pointer tools use, so an AI stroke is an ordinary element:
// selectable, movable, erasable and undoable.
//
// Approval policy mirrors what a person can take back. Adding is additive and
// a single undo removes it, so it runs unattended; deleting and rewriting
// someone else's work asks first (see library-tools.ts for the same shape).

import type { ToolDef } from "@/lib/roadmap/roadmap-tools";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import { measureTextHeight, TEXT_LINE_HEIGHT } from "@/features/whiteboard/lib/text-layout";
import type {
  ArrowElement,
  EllipseElement,
  LineElement,
  PenElement,
  Point,
  RectangleElement,
  TextElement,
  WhiteboardElement,
} from "@/types/whiteboard";

/** Text width used when the model doesn't pick one, matching the canvas. */
const DEFAULT_TEXT_WIDTH = 240;
const DEFAULT_TEXT_FONT_SIZE = 16;
/** Keeps one reply from burying the board; the model can always add more. */
const MAX_ELEMENTS_PER_CALL = 40;
const MAX_SNAPSHOT_ELEMENTS = 60;

export interface ToolOutcome {
  ok: boolean;
  /** One-line note shown in the chat thread. */
  summary: string;
  /** What the model reads back as the tool result. */
  modelOutput: string;
}

export const WHITEBOARD_TOOLS: ToolDef[] = [
  {
    name: "list_board",
    description:
      "List what is currently on the whiteboard: each element's id, type, position and (for text) its content. Use it before moving or deleting anything, or when the attached image is unclear.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "draw_shapes",
    description:
      "Draw one or more shapes on the whiteboard in world coordinates (x grows right, y grows down; the user's current view is described in the system prompt). Additive and undoable, so no confirmation is needed. Prefer one call with several shapes over many calls.",
    input_schema: {
      type: "object",
      properties: {
        shapes: {
          type: "array",
          description: "Shapes to draw, in order.",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["rectangle", "ellipse", "line", "arrow", "text", "stroke"],
              },
              x: { type: "number", description: "Left edge (rectangle) / top-left (text)." },
              y: { type: "number", description: "Top edge (rectangle) / top-left (text)." },
              width: { type: "number", description: "Rectangle width, or text wrap width." },
              height: { type: "number", description: "Rectangle height." },
              cx: { type: "number", description: "Ellipse centre x." },
              cy: { type: "number", description: "Ellipse centre y." },
              rx: { type: "number", description: "Ellipse radius x." },
              ry: { type: "number", description: "Ellipse radius y." },
              x1: { type: "number", description: "Line/arrow start x." },
              y1: { type: "number", description: "Line/arrow start y." },
              x2: { type: "number", description: "Line/arrow end x (arrow head lands here)." },
              y2: { type: "number", description: "Line/arrow end y." },
              text: { type: "string", description: "Text content, for type=text." },
              fontSize: { type: "number", description: "Text size in world units (default 16)." },
              points: {
                type: "array",
                description: "Freehand path for type=stroke, as [{x,y}, …].",
                items: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
              },
              color: {
                type: "string",
                description: "Stroke/text colour as #rrggbb. Defaults to the user's current pen colour.",
              },
              strokeWidth: { type: "number", description: "Line thickness, default 2." },
            },
            required: ["type"],
          },
        },
      },
      required: ["shapes"],
    },
  },
  {
    name: "update_text",
    description:
      "Replace the content of an existing text element (ids come from list_board). Asks the user for approval first.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
      },
      required: ["id", "text"],
    },
  },
  {
    name: "erase_elements",
    description:
      "Delete elements from the board by id (from list_board). Asks the user for approval first.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
      },
      required: ["ids"],
    },
  },
];

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
/** Only #rgb / #rrggbb get through, so a bad guess can't inject CSS. */
function asColor(v: unknown, fallback: string): string {
  const s = asString(v).trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fallback;
}

function describeElement(el: WhiteboardElement): string {
  switch (el.type) {
    case "rectangle":
      return `[rectangle] id: ${el.id}, x: ${Math.round(el.x)}, y: ${Math.round(el.y)}, w: ${Math.round(el.width)}, h: ${Math.round(el.height)}`;
    case "ellipse":
      return `[ellipse] id: ${el.id}, cx: ${Math.round(el.cx)}, cy: ${Math.round(el.cy)}, rx: ${Math.round(el.rx)}, ry: ${Math.round(el.ry)}`;
    case "line":
    case "arrow":
      return `[${el.type}] id: ${el.id}, from: (${Math.round(el.x1)}, ${Math.round(el.y1)}), to: (${Math.round(el.x2)}, ${Math.round(el.y2)})`;
    case "text":
      return `[text] id: ${el.id}, x: ${Math.round(el.x)}, y: ${Math.round(el.y)}, text: ${JSON.stringify(el.text)}`;
    case "pen":
      return `[stroke] id: ${el.id}, ${el.points.length} points starting at (${Math.round(el.points[0]?.x ?? 0)}, ${Math.round(el.points[0]?.y ?? 0)})`;
    default:
      return `[element] id: ${(el as WhiteboardElement).id}`;
  }
}

/**
 * Where the user is looking, in world units, plus a short inventory. The model
 * needs this to put a drawing on screen instead of off in empty space.
 */
export function buildWhiteboardSystemPrompt(viewport?: {
  width: number;
  height: number;
}): string {
  const s = useWhiteboardStore.getState();
  const zoom = s.zoom || 1;
  // screen (0,0) maps to this world point; see the canvas transform
  const left = -s.panX / zoom;
  const top = -s.panY / zoom;
  const viewW = (viewport?.width ?? 1000) / zoom;
  const viewH = (viewport?.height ?? 700) / zoom;

  const inventory = s.elements
    .slice(-MAX_SNAPSHOT_ELEMENTS)
    .map(describeElement)
    .join("\n");

  return [
    "You are drawing on the user's whiteboard through tools.",
    "",
    "Coordinates are world units: x grows right, y grows down. The user's",
    `visible area is roughly x ${Math.round(left)}..${Math.round(left + viewW)}, y ${Math.round(top)}..${Math.round(top + viewH)}.`,
    "Draw inside that area unless the user asks otherwise, leave a margin from",
    "the edges, and do not overlap existing elements without a reason.",
    "",
    "Guidance: sketch with a handful of deliberate shapes rather than many tiny",
    "ones. Label boxes with text elements placed inside them. Connect boxes with",
    "arrows whose endpoints touch the box edges. Keep to the user's pen colour",
    "unless they ask for colour. After drawing, say in one short sentence what",
    "you drew; the board itself shows the detail.",
    "",
    s.elements.length > 0
      ? `Currently on the board (${s.elements.length} elements, newest last):\n${inventory}`
      : "The board is empty.",
  ].join("\n");
}

/** Build one element from the model's shape spec, or null when unusable.
 *  Exported for the unit tests: this is where a model's loose JSON is
 *  turned into a board element, so it is the part worth pinning down. */
export function buildElement(
  spec: Record<string, unknown>,
  defaults: { color: string; strokeWidth: number },
): WhiteboardElement | null {
  const type = asString(spec.type);
  const strokeColor = asColor(spec.color, defaults.color);
  const strokeWidth = Math.min(
    Math.max(asNumber(spec.strokeWidth, defaults.strokeWidth), 1),
    40,
  );
  const base = {
    id: crypto.randomUUID(),
    strokeColor,
    strokeWidth,
    createdAt: Date.now(),
  };

  switch (type) {
    case "rectangle": {
      const width = asNumber(spec.width, 0);
      const height = asNumber(spec.height, 0);
      if (width === 0 || height === 0) return null;
      return {
        ...base,
        type: "rectangle",
        x: asNumber(spec.x, 0),
        y: asNumber(spec.y, 0),
        width,
        height,
      } satisfies RectangleElement;
    }
    case "ellipse": {
      const rx = asNumber(spec.rx, 0);
      const ry = asNumber(spec.ry, 0);
      if (rx <= 0 || ry <= 0) return null;
      return {
        ...base,
        type: "ellipse",
        cx: asNumber(spec.cx, 0),
        cy: asNumber(spec.cy, 0),
        rx,
        ry,
      } satisfies EllipseElement;
    }
    case "line":
    case "arrow": {
      const x1 = asNumber(spec.x1, 0);
      const y1 = asNumber(spec.y1, 0);
      const x2 = asNumber(spec.x2, 0);
      const y2 = asNumber(spec.y2, 0);
      if (x1 === x2 && y1 === y2) return null;
      return {
        ...base,
        type,
        x1,
        y1,
        x2,
        y2,
      } satisfies LineElement | ArrowElement;
    }
    case "text": {
      const text = asString(spec.text);
      if (!text.trim()) return null;
      const fontSize = Math.min(
        Math.max(asNumber(spec.fontSize, DEFAULT_TEXT_FONT_SIZE), 8),
        200,
      );
      const width = Math.max(asNumber(spec.width, DEFAULT_TEXT_WIDTH), 20);
      return {
        ...base,
        type: "text",
        x: asNumber(spec.x, 0),
        y: asNumber(spec.y, 0),
        width,
        // measured like the canvas does, so hit-testing matches what's drawn
        height: measureTextHeight(text, width, fontSize) || fontSize * TEXT_LINE_HEIGHT,
        text,
        fontSize,
        color: strokeColor,
      } satisfies TextElement;
    }
    case "stroke": {
      const raw = Array.isArray(spec.points) ? spec.points : [];
      const points: Point[] = [];
      for (const p of raw) {
        if (!p || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        if (typeof rec.x !== "number" || typeof rec.y !== "number") continue;
        points.push({ x: rec.x, y: rec.y });
      }
      if (points.length < 2) return null;
      return { ...base, type: "pen", points } satisfies PenElement;
    }
    default:
      return null;
  }
}

export async function dispatchWhiteboardTool(
  name: string,
  rawInput: unknown,
): Promise<ToolOutcome> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const board = useWhiteboardStore.getState();
  const approval = useToolApprovalStore.getState();

  try {
    switch (name) {
      case "list_board": {
        if (board.elements.length === 0) {
          return { ok: true, summary: "Looked at the board (empty)", modelOutput: "The board is empty." };
        }
        const lines = board.elements.slice(-MAX_SNAPSHOT_ELEMENTS).map(describeElement);
        return {
          ok: true,
          summary: `Looked at the board (${board.elements.length} elements)`,
          modelOutput: lines.join("\n"),
        };
      }

      case "draw_shapes": {
        const specs = Array.isArray(input.shapes) ? input.shapes : [];
        if (specs.length === 0) {
          return { ok: false, summary: "draw_shapes: nothing to draw", modelOutput: "Error: shapes is required and must not be empty." };
        }
        const defaults = {
          color: board.strokeColor,
          strokeWidth: board.strokeWidth,
        };
        const built: WhiteboardElement[] = [];
        let rejected = 0;
        for (const spec of specs.slice(0, MAX_ELEMENTS_PER_CALL)) {
          const el =
            spec && typeof spec === "object"
              ? buildElement(spec as Record<string, unknown>, defaults)
              : null;
          if (el) built.push(el);
          else rejected += 1;
        }
        if (built.length === 0) {
          return {
            ok: false,
            summary: "draw_shapes: no usable shapes",
            modelOutput:
              "Error: none of the shapes were usable. Check that each has its required fields (rectangle: x,y,width,height; ellipse: cx,cy,rx,ry; line/arrow: x1,y1,x2,y2; text: text; stroke: at least two points).",
          };
        }
        // One undo entry for the whole reply: the user takes the AI's
        // drawing back in a single Ctrl+Z, not shape by shape.
        board.pushUndo();
        for (const el of built) {
          useWhiteboardStore.setState((s) => ({ elements: [...s.elements, el] }));
        }
        useWhiteboardStore.getState().saveCurrentWhiteboard();
        const note = rejected > 0 ? ` (${rejected} skipped as malformed)` : "";
        return {
          ok: true,
          summary: `Drew ${built.length} element${built.length === 1 ? "" : "s"}${note}`,
          modelOutput: `Drew ${built.length} element(s)${note}. Ids: ${built.map((e) => e.id).join(", ")}.`,
        };
      }

      case "update_text": {
        const id = asString(input.id);
        const text = asString(input.text);
        const target = board.elements.find((el) => el.id === id);
        if (!target) {
          return { ok: false, summary: `update_text: no element ${id}`, modelOutput: `Error: no element with id ${id}. Call list_board first.` };
        }
        if (target.type !== "text") {
          return { ok: false, summary: `update_text: ${id} is not text`, modelOutput: `Error: element ${id} is a ${target.type}, not text.` };
        }
        const ok = await approval.request({
          tool: name,
          summary: "Rewrite a text element",
          details: [`"${target.text}" -> "${text}"`],
        });
        if (!ok) {
          return { ok: false, summary: "Skipped rewriting the text", modelOutput: "The user declined this action. Do not retry it; continue without it." };
        }
        board.pushUndo();
        board.updateElement(id, {
          text,
          height: measureTextHeight(text, target.width, target.fontSize),
        } as Partial<WhiteboardElement>);
        return { ok: true, summary: "Rewrote a text element", modelOutput: `Updated text element ${id}.` };
      }

      case "erase_elements": {
        const raw = Array.isArray(input.ids) ? input.ids : [];
        const ids = raw.filter((v): v is string => typeof v === "string");
        const present = board.elements.filter((el) => ids.includes(el.id));
        if (present.length === 0) {
          return { ok: false, summary: "erase_elements: nothing matched", modelOutput: "Error: none of those ids are on the board. Call list_board first." };
        }
        const ok = await approval.request({
          tool: name,
          summary: `Erase ${present.length} element${present.length === 1 ? "" : "s"}`,
          details: present.slice(0, 8).map(describeElement),
        });
        if (!ok) {
          return { ok: false, summary: "Skipped erasing", modelOutput: "The user declined this action. Do not retry it; continue without it." };
        }
        board.removeElements(present.map((el) => el.id));
        return {
          ok: true,
          summary: `Erased ${present.length} element${present.length === 1 ? "" : "s"}`,
          modelOutput: `Erased ${present.length} element(s).`,
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
