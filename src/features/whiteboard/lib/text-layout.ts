export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_FONT_FAMILY =
  "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * Word-wrap a block of text against a max pixel width using the given
 * 2D context. Respects hard newlines in the input. Words longer than
 * maxWidth fall onto their own line without further breaking, browser
 * behaviour for overflowing single tokens in a fixed-width container.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine === "") {
      lines.push("");
      continue;
    }
    const words = rawLine.split(" ");
    let current = words[0] ?? "";
    for (let i = 1; i < words.length; i++) {
      const candidate = current ? current + " " + words[i] : words[i];
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    if (current !== "" || words.length > 0) lines.push(current);
  }
  return lines;
}

/** Measure a text block's height without requiring a live canvas. */
export function measureTextHeight(
  text: string,
  maxWidth: number,
  fontSize: number,
): number {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return fontSize * TEXT_LINE_HEIGHT;
  ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
  const lines = wrapText(ctx, text, maxWidth);
  return Math.max(1, lines.length) * fontSize * TEXT_LINE_HEIGHT;
}
