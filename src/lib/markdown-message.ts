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
 *
 * Citations: when `sourceDocId` is provided, `[p.N]` tokens in the
 * model's output are rewritten into clickable links to
 * `/reader/<id>?page=N`. The system prompt in `ai-client.ts` already
 * tells the model to use this exact shape (see migration
 * `00030_chat_source_context.sql` for the canonical spec). The
 * companion click dispatcher in `use-page-citation.ts` intercepts
 * those links so an in-reader click jumps the active viewer instead
 * of triggering a full navigation.
 */

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(
  text: string,
  sourceDocId?: string | null,
): string {
  if (!text) return "";
  // Citation pre-pass: only when the conversation has a source doc
  // attached. Conversations without one render `[p.N]` as plain text
  // (no link target to send the user to anyway).
  const withCitations = sourceDocId
    ? text.replace(
        /\[(p\.?\s?(\d+))\]/g,
        (_match, label: string, page: string) =>
          `[${label}](/reader/${sourceDocId}?page=${page})`,
      )
    : text;
  const raw = marked.parse(withCitations, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    // Keep code highlighting attributes that marked emits + the link
    // attrs we need (`marked` emits them on autolinked URLs).
    ADD_ATTR: ["target", "rel"],
  });
}
