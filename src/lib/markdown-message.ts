import { marked, type Tokens } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import markedKatex from "marked-katex-extension";

// Curated language list — covers the languages users in Pnyxy's
// student/researcher audience are most likely to paste, without
// pulling in the full ~3MB highlight.js bundle. Add more here only
// when there's a real ask; an unknown language still renders as
// plain monospaced text via the default `code` renderer.
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c++", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);

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
 *
 * Code blocks: fenced ``` blocks get syntax-highlighted via
 * highlight.js for the curated language list above, and a small
 * Copy button is injected into each block. The button has a
 * `data-copy-code` attribute that the message-container click
 * handler uses to dispatch the clipboard write — keeps the markdown
 * pipeline pure HTML output and avoids per-block React effects.
 */

marked.setOptions({
  gfm: true,
  breaks: true,
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const codeRenderer = {
  code(token: Tokens.Code): string {
    const { text, lang } = token;
    const requested = (lang ?? "").trim().toLowerCase();
    let highlighted = "";
    let displayLang = "";
    if (requested && hljs.getLanguage(requested)) {
      try {
        highlighted = hljs.highlight(text, {
          language: requested,
          ignoreIllegals: true,
        }).value;
        displayLang = requested;
      } catch {
        highlighted = escapeHtml(text);
      }
    } else {
      highlighted = escapeHtml(text);
    }
    // The Copy button lives inside the <pre> with `data-copy-code` so
    // the delegated click handler in the message container can read
    // the raw source from `data-copy-text` (base64-encoded so newlines
    // and special chars survive the attribute roundtrip without
    // colliding with the HTML escape applied by `escapeHtml`).
    const encoded = btoa(unescape(encodeURIComponent(text)));
    const langBadge = displayLang
      ? `<span class="pnyxy-code-lang">${escapeHtml(displayLang)}</span>`
      : "";
    return (
      `<pre class="pnyxy-code-block">` +
      `<div class="pnyxy-code-toolbar">${langBadge}` +
      `<button type="button" data-copy-code data-copy-text="${encoded}" class="pnyxy-copy-code" aria-label="Copy code">Copy</button>` +
      `</div>` +
      `<code class="hljs language-${escapeHtml(displayLang || "plaintext")}">${highlighted}</code>` +
      `</pre>`
    );
  },
};

marked.use({ renderer: codeRenderer });
// KaTeX extension: `$inline$` and `$$display$$` math render via
// KaTeX's HTML output. `throwOnError: false` makes malformed input
// fall back to a styled error span instead of crashing the whole
// message render. `nonStandard: true` accepts $...$ even when not
// surrounded by whitespace, which is how the model usually writes
// it inline (e.g. "the value is $x^2$.").
marked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
    // HTML-only output (no MathML twin) so DOMPurify only has to
    // worry about <span> + inline styles, not the math/svg
    // namespaces. Loses screen-reader accessibility for formulas in
    // exchange for a simpler sanitization profile — the chat UI is a
    // read-aloud target via TTS rather than via screen-reader math
    // annotations anyway.
    output: "html",
  }),
);

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
    // - target/rel: anchors emitted by `marked`'s autolinker.
    // - data-copy-*: our `code` renderer override (see above).
    // - style: KaTeX leans on inline `style` for the precise
    //   spacing/positioning of every glyph; without it the formula
    //   visually collapses. KaTeX's CSS itself keeps the values
    //   bounded (transforms/widths/heights), so allowing the
    //   attribute here doesn't open a meaningful XSS hole — every
    //   <style> child is still stripped, only the inline
    //   per-element style attributes survive.
    ADD_ATTR: ["target", "rel", "data-copy-code", "data-copy-text", "style"],
  });
}

/**
 * Detects clicks on external (http / https) links emitted by the
 * markdown renderer — i.e. URLs the LLM put in its response. When
 * one's hit, prevents default + propagation and returns the href so
 * the caller can show a "verify before opening" confirmation modal.
 *
 * Returns null for:
 *  - clicks not on an <a>
 *  - relative / internal links (citation links handled by
 *    `use-page-citation.ts`, mailto/tel handled by the browser)
 *  - already-prevented events (lets earlier handlers like
 *    `handleCodeBlockCopy` short-circuit cleanly)
 *
 * Why we gate AI-emitted URLs: the model can confidently emit URLs
 * that don't exist, point at the wrong place, or even at malicious
 * domains. Surfacing the actual href in a confirm dialog before any
 * navigation lets the user notice obvious issues (typosquats,
 * unrelated domains, weird paths).
 */
export function detectAiLinkClick(
  e: React.MouseEvent<HTMLElement>,
): string | null {
  if (e.defaultPrevented) return null;
  const a = (e.target as HTMLElement)?.closest?.("a");
  if (!(a instanceof HTMLAnchorElement)) return null;
  const href = a.getAttribute("href") ?? "";
  if (!/^https?:\/\//i.test(href)) return null;
  e.preventDefault();
  e.stopPropagation();
  return href;
}

/**
 * Companion click handler for the message container — call this from
 * the `onClick` on whichever element wraps `dangerouslySetInnerHTML`.
 * Intercepts clicks on copy-code buttons, decodes the base64 source,
 * writes to clipboard, and briefly swaps the button label to "Copied".
 * Falls through silently if the click wasn't on a copy button.
 */
export function handleCodeBlockCopy(e: React.MouseEvent<HTMLElement>): void {
  const btn = (e.target as HTMLElement)?.closest?.("[data-copy-code]");
  if (!(btn instanceof HTMLElement)) return;
  const encoded = btn.dataset.copyText;
  if (!encoded) return;
  let source: string;
  try {
    source = decodeURIComponent(escape(atob(encoded)));
  } catch {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  void navigator.clipboard?.writeText?.(source).catch(() => {});
  const originalLabel = btn.textContent;
  btn.textContent = "Copied";
  btn.classList.add("pnyxy-copy-code--copied");
  window.setTimeout(() => {
    btn.textContent = originalLabel;
    btn.classList.remove("pnyxy-copy-code--copied");
  }, 1500);
}
