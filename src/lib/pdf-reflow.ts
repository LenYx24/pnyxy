import type { pdfjs } from "react-pdf";

/**
 * PDF reflow extractor — pure algorithm on top of `pdfjs.getTextContent()`.
 *
 * Goal: convert a fixed-layout PDF into a stream of `<heading>` /
 * `<paragraph>` blocks that can be re-rendered as flowing text on
 * a phone screen, without horizontal panning.
 *
 * Heuristics (B-level scope agreed with the user):
 *
 *   1. **Line clustering** — items whose top-y agrees within
 *      `LINE_Y_TOLERANCE` are the same visual line. The pdf.js text
 *      stream emits per-run items (sometimes a single word at a time)
 *      so this is required even on simple layouts.
 *
 *   2. **Column detection** — if a meaningful share of lines start
 *      past the page midpoint, we treat the page as two-column and
 *      read left then right. Single-column otherwise.
 *
 *   3. **Paragraph breaks** — gap between consecutive line bottoms
 *      and the next line's top, compared to the page's median gap.
 *      A gap >= 1.5× median ends the paragraph.
 *
 *   4. **Heading detection** — line font size compared to the
 *      document-wide median. >= 1.5× median → h1, 1.25× → h2.
 *      Bold lines under 100 chars also get demoted to h2 even if the
 *      font size is normal.
 *
 * Out of scope for v1 (documented for the user): inline images,
 * tables, formula extraction, footnote linking, page-header / footer
 * suppression. Scanned PDFs (no text layer) yield an empty output.
 */

type PdfDocumentProxy = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;

export type ReflowBlock =
  | { type: "heading"; level: 1 | 2; text: string; pageNum: number }
  | { type: "paragraph"; text: string; pageNum: number };

export interface ReflowedDocument {
  blocks: ReflowBlock[];
  totalPages: number;
}

export interface ExtractReflowOptions {
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
}

/** @internal — exported so unit tests can pin the layout-extraction
 *  internals (column split, paragraph grouping, heading classify)
 *  without going through a real pdf.js document. Not part of the
 *  module's public surface. */
export interface ProcessedItem {
  str: string;
  x: number;       // PDF x (left edge)
  y: number;       // CSS-style top y (smaller = closer to page top)
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

/** @internal — exported for unit tests. See `ProcessedItem`. */
export interface Line {
  items: ProcessedItem[];
  yTop: number;
  yBottom: number;
  xStart: number;
  xEnd: number;
  text: string;
  fontSize: number; // median item size
  isBold: boolean;
}

const LINE_Y_TOLERANCE = 2;
const PARAGRAPH_GAP_RATIO = 1.5;
const HEADING_H1_RATIO = 1.5;
const HEADING_H2_RATIO = 1.25;
const BOLD_HEADING_MAX_LEN = 100;
const COLUMN_MIN_SIDE_SHARE = 0.2;
const COLUMN_SPLIT_OFFSET = 0.02; // 2% page width past midpoint
const MIN_LINES_FOR_COLUMN_DETECT = 6;

function buildLine(items: ProcessedItem[]): Line {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  let text = "";
  let prev: ProcessedItem | null = null;
  for (const item of sorted) {
    if (prev) {
      const prevEnd = prev.x + prev.width;
      // Insert a space when there's a meaningful horizontal gap
      // between glyph runs and neither side already supplies one.
      // The 0.2× font-size heuristic is what pdf.js's own text-layer
      // uses for whitespace inference, so the resulting text matches
      // what the user would see selected on the page.
      const gap = item.x - prevEnd;
      const needSpace =
        gap > prev.fontSize * 0.2 &&
        !text.endsWith(" ") &&
        !item.str.startsWith(" ");
      if (needSpace) text += " ";
    }
    text += item.str;
    prev = item;
  }
  const sizes = items.map((i) => i.fontSize).sort((a, b) => a - b);
  return {
    items,
    yTop: Math.min(...items.map((i) => i.y)),
    yBottom: Math.max(...items.map((i) => i.y + i.height)),
    xStart: Math.min(...items.map((i) => i.x)),
    xEnd: Math.max(...items.map((i) => i.x + i.width)),
    text: text.trim().replace(/\s+/g, " "),
    fontSize: sizes[Math.floor(sizes.length / 2)] || 12,
    isBold: items.some((i) => /bold/i.test(i.fontName)),
  };
}

async function extractPageLines(
  page: Awaited<ReturnType<PdfDocumentProxy["getPage"]>>,
): Promise<Line[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items: ProcessedItem[] = [];
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const str = (raw as { str: string }).str;
    if (!str) continue;
    const item = raw as {
      str: string;
      transform: number[];
      width: number;
      height: number;
      fontName: string;
    };
    const transform = item.transform;
    const x = transform[4];
    const pdfY = transform[5];
    // pdf.js coords are bottom-left origin. Convert to top-y in PDF
    // units so our top-to-bottom traversal works naturally.
    const yTop = viewport.height - pdfY - item.height;
    items.push({
      str,
      x,
      y: yTop,
      width: item.width,
      height: item.height,
      fontSize: Math.abs(transform[3]) || item.height,
      fontName: item.fontName,
    });
  }

  // Sort by y first, then x — establishes reading order within a line.
  items.sort((a, b) => {
    if (Math.abs(a.y - b.y) > LINE_Y_TOLERANCE) return a.y - b.y;
    return a.x - b.x;
  });

  const lines: Line[] = [];
  let current: ProcessedItem[] = [];
  let currentY: number | null = null;

  for (const item of items) {
    if (currentY === null || Math.abs(item.y - currentY) <= LINE_Y_TOLERANCE) {
      if (currentY === null) currentY = item.y;
      current.push(item);
    } else {
      if (current.length > 0) {
        const line = buildLine(current);
        if (line.text) lines.push(line);
      }
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length > 0) {
    const line = buildLine(current);
    if (line.text) lines.push(line);
  }

  return lines;
}

/** @internal — exported for unit tests. */
export function splitColumns(lines: Line[], pageWidth: number): Line[][] {
  if (lines.length < MIN_LINES_FOR_COLUMN_DETECT) return [lines];

  const splitX = pageWidth / 2 + pageWidth * COLUMN_SPLIT_OFFSET;
  const left: Line[] = [];
  const right: Line[] = [];
  for (const line of lines) {
    if (line.xStart > splitX) right.push(line);
    else left.push(line);
  }

  // Only commit to a two-column read if both sides carry a fair share
  // of the lines — otherwise the right-of-midpoint hits are likely
  // wrap-around tails of single-column body text, not a column.
  const minSide = COLUMN_MIN_SIDE_SHARE * lines.length;
  if (right.length >= minSide && left.length >= minSide) {
    return [left, right];
  }
  return [lines];
}

/** @internal — exported for unit tests. */
export function groupParagraphs(lines: Line[]): Line[][] {
  if (lines.length === 0) return [];
  // Compute median line-to-line gap to set a paragraph break threshold.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].yTop - lines[i - 1].yBottom;
    if (gap > 0) gaps.push(gap);
  }
  const medianGap =
    gaps.length > 0
      ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
      : 0;
  const threshold = medianGap * PARAGRAPH_GAP_RATIO;

  const groups: Line[][] = [];
  let current: Line[] = [];
  for (const line of lines) {
    if (current.length === 0) {
      current.push(line);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = line.yTop - prev.yBottom;
    if (medianGap > 0 && gap > threshold) {
      groups.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** @internal — exported for unit tests. */
export function classifyGroup(
  group: Line[],
  medianFontSize: number,
  pageNum: number,
): ReflowBlock {
  const maxFontSize = group.reduce((m, l) => Math.max(m, l.fontSize), 0);
  const ratio = medianFontSize > 0 ? maxFontSize / medianFontSize : 1;
  const text = group.map((l) => l.text).join(" ");
  const allBold = group.every((l) => l.isBold);

  if (ratio >= HEADING_H1_RATIO) {
    return { type: "heading", level: 1, text, pageNum };
  }
  if (ratio >= HEADING_H2_RATIO) {
    return { type: "heading", level: 2, text, pageNum };
  }
  if (allBold && text.length <= BOLD_HEADING_MAX_LEN) {
    return { type: "heading", level: 2, text, pageNum };
  }
  return { type: "paragraph", text, pageNum };
}

export async function extractReflowedDocument(
  doc: PdfDocumentProxy,
  options: ExtractReflowOptions = {},
): Promise<ReflowedDocument> {
  const { onProgress, signal } = options;
  const numPages = doc.numPages;

  // Pass 1: extract per-page lines with bounded concurrency. Eight
  // workers mirror what `pdf-adapter.search` uses — comfortable for
  // the pdf.js worker thread and well-tested on real documents.
  const CONCURRENCY = 8;
  const perPageLines: { pageNum: number; lines: Line[] }[] = new Array(numPages);
  let nextPage = 1;
  let completed = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (!aborted) {
      const pageNum = nextPage++;
      if (pageNum > numPages) return;
      if (signal?.aborted) {
        aborted = true;
        throw new DOMException("Aborted", "AbortError");
      }
      const page = await doc.getPage(pageNum);
      const lines = await extractPageLines(page);
      const viewport = page.getViewport({ scale: 1 });
      const ordered = splitColumns(lines, viewport.width).flat();
      perPageLines[pageNum - 1] = { pageNum, lines: ordered };
      completed += 1;
      onProgress?.(completed, numPages);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, numPages); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // Pass 2: pick a document-wide median font size so the heading
  // detector is calibrated against the body text rather than the
  // local page (which could be all-headings on a cover page).
  const allFontSizes: number[] = [];
  for (const p of perPageLines) {
    if (!p) continue;
    for (const line of p.lines) allFontSizes.push(line.fontSize);
  }
  allFontSizes.sort((a, b) => a - b);
  const medianFontSize =
    allFontSizes.length > 0
      ? allFontSizes[Math.floor(allFontSizes.length / 2)]
      : 12;

  // Pass 3: per-page grouping into paragraphs + heading classification.
  const blocks: ReflowBlock[] = [];
  for (const p of perPageLines) {
    if (!p) continue;
    const groups = groupParagraphs(p.lines);
    for (const group of groups) {
      blocks.push(classifyGroup(group, medianFontSize, p.pageNum));
    }
  }

  return { blocks, totalPages: numPages };
}
