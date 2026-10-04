import { beforeEach, describe, expect, it } from "vitest";
import {
  AI_DEFAULT_COLOR,
  buildInlineElement,
  dispatchPdfDrawTool,
} from "./pdf-draw-tools";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";

// buildInlineElement is the gate between the model's loose JSON and the
// user's page: everything must land inside the page, degenerate shapes are
// dropped, and only hex colours get through.
describe("buildInlineElement", () => {
  it("builds a rectangle with the AI defaults", () => {
    const el = buildInlineElement({ type: "rectangle", x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    expect(el).toMatchObject({
      type: "rectangle",
      x: 0.1,
      y: 0.2,
      color: AI_DEFAULT_COLOR,
    });
    expect(el && el.type === "rectangle" && el.w).toBeCloseTo(0.3);
    expect(el?.id).toBeTruthy();
  });

  it("accepts whiteboard-style width/height and normalises negative sizes", () => {
    const el = buildInlineElement({ type: "rectangle", x: 0.5, y: 0.5, width: -0.2, height: 0.1 });
    expect(el).toMatchObject({ type: "rectangle", y: 0.5 });
    if (el?.type !== "rectangle") throw new Error("expected rectangle");
    expect(el.x).toBeCloseTo(0.3);
    expect(el.w).toBeCloseTo(0.2);
  });

  it("clamps shapes onto the page", () => {
    const rect = buildInlineElement({ type: "rectangle", x: 0.9, y: -0.5, w: 0.5, h: 0.7 });
    if (rect?.type !== "rectangle") throw new Error("expected rectangle");
    expect(rect.x).toBeCloseTo(0.9);
    expect(rect.x + rect.w).toBeCloseTo(1);
    expect(rect.y).toBe(0);
    expect(rect.h).toBeCloseTo(0.2);

    const arrow = buildInlineElement({ type: "arrow", x1: -1, y1: 0.5, x2: 2, y2: 0.5 });
    expect(arrow).toMatchObject({ type: "arrow", x1: 0, x2: 1 });

    const ellipse = buildInlineElement({ type: "ellipse", cx: 1.4, cy: 0.5, rx: 3, ry: 0.1 });
    expect(ellipse).toMatchObject({ type: "ellipse", cx: 1, rx: 0.5 });

    const stroke = buildInlineElement({
      type: "stroke",
      points: [{ x: -0.1, y: 0.2 }, { x: 0.5, y: 1.3 }, { x: "bad", y: 1 }, null],
    });
    expect(stroke).toMatchObject({
      type: "pen",
      points: [{ x: 0, y: 0.2 }, { x: 0.5, y: 1 }],
    });
  });

  it("rejects shapes that are missing fields or have no extent", () => {
    expect(buildInlineElement({ type: "rectangle", x: 0.1, y: 0.1, w: 0.2 })).toBeNull();
    expect(buildInlineElement({ type: "rectangle", x: 1.2, y: 0.1, w: 0.2, h: 0.2 })).toBeNull();
    expect(buildInlineElement({ type: "ellipse", cx: 0.5, cy: 0.5, rx: 0, ry: 0.1 })).toBeNull();
    expect(buildInlineElement({ type: "line", x1: 0.3, y1: 0.3, x2: 0.3, y2: 0.3 })).toBeNull();
    expect(buildInlineElement({ type: "stroke", points: [{ x: 0.1, y: 0.1 }] })).toBeNull();
    expect(buildInlineElement({ type: "text", text: "hi" })).toBeNull();
  });

  it("keeps hex colours, clamps stroke width, and ignores anything else", () => {
    expect(
      buildInlineElement({ type: "line", x1: 0, y1: 0, x2: 1, y2: 1, color: "#10b981", strokeWidth: 99 }),
    ).toMatchObject({ color: "#10b981", width: 12 });
    expect(
      buildInlineElement({ type: "line", x1: 0, y1: 0, x2: 1, y2: 1, color: "red; url(x)", strokeWidth: 0 }),
    ).toMatchObject({ color: AI_DEFAULT_COLOR, width: 1 });
  });
});

describe("dispatchPdfDrawTool", () => {
  const target = { docId: "doc-1", page: 3, totalPages: 10 };

  beforeEach(() => {
    localStorage.clear();
    useInlineDrawStore.setState({
      currentBookId: "doc-1",
      drawingsByPage: new Map(),
      selectedId: null,
    });
    useToolApprovalStore.getState().endTurn();
  });

  it("draws valid shapes onto the current page and reports skips", async () => {
    const res = await dispatchPdfDrawTool(
      "draw_shapes",
      {
        shapes: [
          { type: "arrow", x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4 },
          { type: "ellipse", cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.05 },
          { type: "rectangle" },
        ],
      },
      target,
    );
    expect(res.ok).toBe(true);
    expect(res.modelOutput).toContain("1 skipped");
    const els = useInlineDrawStore.getState().elementsForPage(3);
    expect(els.map((e) => e.type)).toEqual(["arrow", "ellipse"]);
  });

  it("honours an explicit page and rejects one out of range", async () => {
    await dispatchPdfDrawTool(
      "draw_shapes",
      { page: 5, shapes: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 0 }] },
      target,
    );
    expect(useInlineDrawStore.getState().elementsForPage(5)).toHaveLength(1);

    const res = await dispatchPdfDrawTool(
      "draw_shapes",
      { page: 11, shapes: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 0 }] },
      target,
    );
    expect(res.ok).toBe(false);
    expect(useInlineDrawStore.getState().elementsForPage(11)).toHaveLength(0);
  });

  it("caps the number of shapes per call", async () => {
    const shapes = Array.from({ length: 45 }, (_, i) => ({
      type: "line",
      x1: 0,
      y1: i / 50,
      x2: 1,
      y2: i / 50,
    }));
    const res = await dispatchPdfDrawTool("draw_shapes", { shapes }, target);
    expect(res.ok).toBe(true);
    expect(useInlineDrawStore.getState().elementsForPage(3)).toHaveLength(30);
    expect(res.modelOutput).toContain("15 over");
  });

  it("refuses to draw once the document is no longer open", async () => {
    useInlineDrawStore.setState({ currentBookId: "other-doc" });
    const res = await dispatchPdfDrawTool(
      "draw_shapes",
      { shapes: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] },
      target,
    );
    expect(res.ok).toBe(false);
    expect(useInlineDrawStore.getState().elementsForPage(3)).toHaveLength(0);
  });

  it("lists the page's drawings with their ids", async () => {
    await dispatchPdfDrawTool(
      "draw_shapes",
      { shapes: [{ type: "rectangle", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
      target,
    );
    const id = useInlineDrawStore.getState().elementsForPage(3)[0].id;
    const res = await dispatchPdfDrawTool("list_page_drawings", {}, target);
    expect(res.modelOutput).toContain(`[rectangle] id: ${id}`);
  });

  it("erases only after approval", async () => {
    await dispatchPdfDrawTool(
      "draw_shapes",
      { shapes: [{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] },
      target,
    );
    const id = useInlineDrawStore.getState().elementsForPage(3)[0].id;

    const declined = dispatchPdfDrawTool("erase_elements", { ids: [id] }, target);
    await Promise.resolve();
    expect(useToolApprovalStore.getState().pending?.tool).toBe("erase_elements");
    useToolApprovalStore.getState().reject();
    expect((await declined).ok).toBe(false);
    expect(useInlineDrawStore.getState().elementsForPage(3)).toHaveLength(1);

    const approved = dispatchPdfDrawTool("erase_elements", { ids: [id] }, target);
    await Promise.resolve();
    useToolApprovalStore.getState().approve();
    expect((await approved).ok).toBe(true);
    expect(useInlineDrawStore.getState().elementsForPage(3)).toHaveLength(0);
  });
});
