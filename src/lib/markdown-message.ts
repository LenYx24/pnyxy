import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Render an AI assistant message: parse markdown via `marked`,
 * sanitize the HTML via DOMPurify. Streamed messages call this
 * on every chunk so the renderer must be cheap.
 *
 * `marked` is configured with `breaks: true` so single newlines
 * become `<br>` (matches typical AI output without forcing the
 * model to use blank lines for line breaks). `gfm: true` turns on
 * tables, fenced code blocks, autolinks, strikethrough.
 *
 * LaTeX is preserved as plain text for now — adding KaTeX is a
 * separate dependency change. The intent is for `$x^2$` to at
 * least show as raw source rather than break rendering.
 */

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    // Keep code highlighting attributes that marked emits.
    ADD_ATTR: ["target", "rel"],
  });
}
