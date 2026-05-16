import { describe, expect, it } from "vitest";
import {
  classifyGroup,
  groupParagraphs,
  splitColumns,
  type Line,
  type ProcessedItem,
} from "./pdf-reflow";

const makeItem = (patch: Partial<ProcessedItem> = {}): ProcessedItem => ({
  str: "x",
  x: 0,
  y: 0,
  width: 10,
  height: 12,
  fontSize: 12,
  fontName: "TimesRoman",
  ...patch,
});

const makeLine = (patch: Partial<Line> = {}): Line => ({
  items: [makeItem()],
  yTop: 0,
  yBottom: 12,
  xStart: 0,
  xEnd: 100,
  text: "Body line",
  fontSize: 12,
  isBold: false,
  ...patch,
});

describe("splitColumns", () => {
  const PAGE_WIDTH = 600;

  it("returns the input as a single column for short pages (< min lines)", () => {
    // MIN_LINES_FOR_COLUMN_DETECT = 6; anything below trivially
    // single-column to avoid noise on cover pages and stubs.
    const lines = [makeLine(), makeLine(), makeLine(), makeLine()];
    expect(splitColumns(lines, PAGE_WIDTH)).toEqual([lines]);
  });

  it("returns single-column when all lines start near the left edge", () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      makeLine({ xStart: 30, yTop: i * 15, yBottom: i * 15 + 12 }),
    );
    expect(splitColumns(lines, PAGE_WIDTH)).toEqual([lines]);
  });

  it("detects two columns when a fair share of lines start past the midpoint", () => {
    const left = Array.from({ length: 6 }, (_, i) =>
      makeLine({ xStart: 30, yTop: i * 15, text: `L${i}` }),
    );
    const right = Array.from({ length: 6 }, (_, i) =>
      makeLine({ xStart: 360, yTop: i * 15, text: `R${i}` }),
    );
    const result = splitColumns([...left, ...right], PAGE_WIDTH);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(6); // left column
    expect(result[1]).toHaveLength(6); // right column
    expect(result[0].every((l) => l.xStart < 300)).toBe(true);
    expect(result[1].every((l) => l.xStart > 300)).toBe(true);
  });

  it("stays single-column when only a tiny fringe of lines crosses the midpoint", () => {
    // COLUMN_MIN_SIDE_SHARE = 0.2, so we need at least ~2 right-of-
    // midpoint lines out of 10. One line shouldn't trigger a split.
    const lines: Line[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeLine({ xStart: 30, yTop: i * 15 }),
      ),
      makeLine({ xStart: 360, yTop: 135 }), // single right-side line
    ];
    expect(splitColumns(lines, PAGE_WIDTH)).toEqual([lines]);
  });
});

describe("groupParagraphs", () => {
  it("returns an empty array for no lines", () => {
    expect(groupParagraphs([])).toEqual([]);
  });

  it("keeps a single line in its own paragraph", () => {
    const line = makeLine();
    expect(groupParagraphs([line])).toEqual([[line]]);
  });

  it("groups closely-spaced lines together", () => {
    // Lines stacked tightly (gap = 3, same as the body line gap).
    // PARAGRAPH_GAP_RATIO = 1.5 × median, so nothing should break.
    const lines = [
      makeLine({ yTop: 0, yBottom: 12 }),
      makeLine({ yTop: 15, yBottom: 27 }), // gap = 3
      makeLine({ yTop: 30, yBottom: 42 }), // gap = 3
      makeLine({ yTop: 45, yBottom: 57 }), // gap = 3
    ];
    const result = groupParagraphs(lines);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(4);
  });

  it("breaks into a new paragraph on a gap > 1.5× median", () => {
    // Three closely-spaced lines, then a big gap, then two more.
    // Median gap is 3 (three same gaps in the consecutive set).
    // The 10-unit gap is well above 1.5× = 4.5.
    const lines = [
      makeLine({ yTop: 0, yBottom: 12 }),
      makeLine({ yTop: 15, yBottom: 27 }),
      makeLine({ yTop: 30, yBottom: 42 }),
      makeLine({ yTop: 52, yBottom: 64 }), // gap = 10 → paragraph break
      makeLine({ yTop: 67, yBottom: 79 }),
    ];
    const result = groupParagraphs(lines);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(3);
    expect(result[1]).toHaveLength(2);
  });
});

describe("classifyGroup", () => {
  const MEDIAN_FONT = 12;

  it("classifies as h1 when the group's largest font is >= 1.5× median", () => {
    const block = classifyGroup(
      [makeLine({ fontSize: 24, text: "Big Heading" })],
      MEDIAN_FONT,
      3,
    );
    expect(block.type).toBe("heading");
    if (block.type === "heading") expect(block.level).toBe(1);
    expect(block.pageNum).toBe(3);
  });

  it("classifies as h2 when font is between 1.25× and 1.5× median", () => {
    const block = classifyGroup(
      [makeLine({ fontSize: 16, text: "Medium Heading" })],
      MEDIAN_FONT,
      1,
    );
    expect(block.type).toBe("heading");
    if (block.type === "heading") expect(block.level).toBe(2);
  });

  it("demotes a short all-bold body-size line to h2", () => {
    // Even at body font size, a fully-bold short line reads like a
    // section label in textbooks. Cap of 100 chars stops sentence-
    // length emphasis from being treated as a heading.
    const block = classifyGroup(
      [
        makeLine({
          fontSize: 12,
          isBold: true,
          text: "Section 3: Linear maps",
        }),
      ],
      MEDIAN_FONT,
      2,
    );
    expect(block.type).toBe("heading");
    if (block.type === "heading") expect(block.level).toBe(2);
  });

  it("classifies as paragraph for body-size non-bold lines", () => {
    const block = classifyGroup(
      [
        makeLine({
          fontSize: 12,
          isBold: false,
          text: "The body paragraph runs across multiple lines.",
        }),
        makeLine({
          fontSize: 12,
          isBold: false,
          text: "It picks up where the previous line left off.",
        }),
      ],
      MEDIAN_FONT,
      4,
    );
    expect(block.type).toBe("paragraph");
    expect(block.text).toContain("The body paragraph");
    expect(block.text).toContain("previous line");
    expect(block.pageNum).toBe(4);
  });

  it("doesn't promote a long all-bold paragraph to heading", () => {
    // Bold-body-paragraph longer than BOLD_HEADING_MAX_LEN (100)
    // stays a paragraph. Textbook intros sometimes bold a full
    // first sentence; we don't want that re-rendered as h2.
    const longBold = makeLine({
      fontSize: 12,
      isBold: true,
      text: "x".repeat(120),
    });
    const block = classifyGroup([longBold], MEDIAN_FONT, 1);
    expect(block.type).toBe("paragraph");
  });

  it("uses the LARGEST font in the group, not the median", () => {
    // A heading line followed by body-size continuation should still
    // classify as a heading (real-world: title + subtitle in the
    // same visual block).
    const block = classifyGroup(
      [
        makeLine({ fontSize: 24, text: "Title" }),
        makeLine({ fontSize: 12, text: "Subtitle" }),
      ],
      MEDIAN_FONT,
      1,
    );
    expect(block.type).toBe("heading");
    if (block.type === "heading") expect(block.level).toBe(1);
  });
});
