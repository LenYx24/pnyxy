import { describe, expect, it, vi } from "vitest";

// the painter is pure; keep pdfjs and the network client out of the test
vi.mock("@/lib/ai/ai-client", () => ({ renderPdfPagesToImages: vi.fn() }));

import {
  arrowHeadPoints,
  drawInlineElements,
  strokeScaleFor,
  type DrawContext,
} from "./page-capture";
import type { InlineElement } from "@/stores/inline-draw-store";

/** Records path calls and the stroke state at each stroke(). */
function recorder() {
  const calls: Array<[string, ...number[]]> = [];
  const strokes: Array<{ color: string; width: number }> = [];
  const ctx = {
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {
      calls.push(["beginPath"]);
    },
    moveTo(x: number, y: number) {
      calls.push(["moveTo", x, y]);
    },
    lineTo(x: number, y: number) {
      calls.push(["lineTo", x, y]);
    },
    rect(x: number, y: number, w: number, h: number) {
      calls.push(["rect", x, y, w, h]);
    },
    ellipse(x: number, y: number, rx: number, ry: number) {
      calls.push(["ellipse", x, y, rx, ry]);
    },
    stroke() {
      strokes.push({ color: String(ctx.strokeStyle), width: ctx.lineWidth });
    },
  };
  return { ctx: ctx as unknown as DrawContext, calls, strokes };
}

describe("strokeScaleFor", () => {
  it("scales 1x stroke widths by the capture-to-page ratio", () => {
    expect(strokeScaleFor(1224, 612)).toBe(2);
    expect(strokeScaleFor(0, 612)).toBe(1);
    expect(strokeScaleFor(1280, 0)).toBe(1);
  });
});

describe("arrowHeadPoints", () => {
  it("puts both legs behind the tip, symmetric about the shaft", () => {
    const head = arrowHeadPoints(0, 0, 100, 0, 10);
    expect(head).not.toBeNull();
    expect(head!.a.x).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6));
    expect(head!.b.x).toBeCloseTo(head!.a.x);
    expect(head!.a.y).toBeCloseTo(-head!.b.y);
    expect(Math.abs(head!.a.y)).toBeCloseTo(5);
  });

  it("has no head for a zero-length shaft", () => {
    expect(arrowHeadPoints(5, 5, 5, 5, 10)).toBeNull();
  });
});

describe("drawInlineElements", () => {
  const base = { id: "x", color: "#ef4444", width: 2 };

  it("maps normalised coords to canvas px and scales the stroke", () => {
    const { ctx, calls, strokes } = recorder();
    const els: InlineElement[] = [
      { ...base, type: "rectangle", x: 0.5, y: 0.5, w: -0.25, h: 0.1 },
      { ...base, type: "ellipse", cx: 0.5, cy: 0.25, rx: 0.1, ry: 0.05 },
      { ...base, type: "pen", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ];
    drawInlineElements(ctx, els, { width: 1000, height: 2000, scale: 2 });
    expect(calls).toContainEqual(["rect", 250, 1000, 250, 200]);
    expect(calls).toContainEqual(["ellipse", 500, 500, 100, 100]);
    expect(calls).toContainEqual(["lineTo", 1000, 2000]);
    expect(strokes).toEqual([
      { color: "#ef4444", width: 4 },
      { color: "#ef4444", width: 4 },
      { color: "#ef4444", width: 4 },
    ]);
  });

  it("draws an arrow as a shaft plus two head legs", () => {
    const { ctx, calls } = recorder();
    drawInlineElements(
      ctx,
      [{ ...base, type: "arrow", x1: 0, y1: 0.5, x2: 1, y2: 0.5 }],
      { width: 200, height: 100, scale: 1 },
    );
    const lineTos = calls.filter((c) => c[0] === "lineTo");
    expect(lineTos).toHaveLength(3);
    expect(lineTos[0]).toEqual(["lineTo", 200, 50]);
  });
});
