import { describe, it, expect } from "vitest";
import { buildElement } from "./whiteboard-tools";

// The model hands us loose JSON, so buildElement is the gate between "what
// the model said" and "what lands on the user's board": it fills in the
// user's pen defaults, rejects degenerate shapes instead of drawing
// invisible junk, and never lets an arbitrary string through as a colour.
const defaults = { color: "#000000", strokeWidth: 2 };

describe("buildElement", () => {
  it("builds a rectangle and inherits the pen defaults", () => {
    const el = buildElement(
      { type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
      defaults,
    );
    expect(el).toMatchObject({
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      strokeColor: "#000000",
      strokeWidth: 2,
    });
    expect(el?.id).toBeTruthy();
  });

  it("rejects shapes with no extent", () => {
    expect(
      buildElement({ type: "rectangle", x: 0, y: 0, width: 0, height: 10 }, defaults),
    ).toBeNull();
    expect(buildElement({ type: "ellipse", cx: 0, cy: 0, rx: 0, ry: 5 }, defaults)).toBeNull();
    expect(
      buildElement({ type: "line", x1: 5, y1: 5, x2: 5, y2: 5 }, defaults),
    ).toBeNull();
    expect(buildElement({ type: "text", text: "   " }, defaults)).toBeNull();
    expect(
      buildElement({ type: "stroke", points: [{ x: 1, y: 1 }] }, defaults),
    ).toBeNull();
  });

  it("keeps a valid hex colour and falls back on anything else", () => {
    expect(
      buildElement(
        { type: "arrow", x1: 0, y1: 0, x2: 10, y2: 10, color: "#ff0000" },
        defaults,
      ),
    ).toMatchObject({ strokeColor: "#ff0000" });
    expect(
      buildElement(
        { type: "arrow", x1: 0, y1: 0, x2: 10, y2: 10, color: "red; url(x)" },
        defaults,
      ),
    ).toMatchObject({ strokeColor: "#000000" });
  });

  it("maps a stroke onto a pen element and drops malformed points", () => {
    const el = buildElement(
      {
        type: "stroke",
        points: [{ x: 0, y: 0 }, { x: "nope", y: 3 }, { x: 4, y: 5 }],
      },
      defaults,
    );
    expect(el).toMatchObject({ type: "pen" });
    expect(el && "points" in el ? el.points : []).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 5 },
    ]);
  });

  it("clamps the stroke width and ignores an unknown type", () => {
    expect(
      buildElement(
        { type: "rectangle", x: 0, y: 0, width: 5, height: 5, strokeWidth: 999 },
        defaults,
      ),
    ).toMatchObject({ strokeWidth: 40 });
    expect(buildElement({ type: "spiral" }, defaults)).toBeNull();
  });
});
