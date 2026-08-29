import { marked, type Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import { sanitizeHtml } from "@/lib/sanitize-html";
import markedKatex from "marked-katex-extension";

// only register the languages we use; full hljs bundle is ~3MB
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

// breaks: true so single newlines become <br>, matching model output
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
    // raw source is base64'd into data-copy-text so newlines/special chars survive the attribute roundtrip
    const encoded = btoa(unescape(encodeURIComponent(text)));
    const langBadge = displayLang
      ? `<span class="pnyxy-code-lang">${escapeHtml(displayLang)}</span>`
      : "";
    return (
      `<pre class="pnyxy-code-block">` +
      `<div class="pnyxy-code-toolbar">${langBadge}` +
      // a <span role=button>, not <button>: the sanitizer forbids form
      // controls in model output, which silently dropped the old button
      `<span role="button" tabindex="0" data-copy-code data-copy-text="${encoded}" class="pnyxy-copy-code" aria-label="Copy code">Copy</span>` +
      `</div>` +
      `<code class="hljs language-${escapeHtml(displayLang || "plaintext")}">${highlighted}</code>` +
      `</pre>`
    );
  },
};

marked.use({ renderer: codeRenderer });
// throwOnError:false renders malformed math as an error span instead of crashing the whole message.
// nonStandard:true accepts $...$ without surrounding whitespace (e.g. "the value is $x^2$.")
marked.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
    // html-only output (no MathML twin) keeps the DOMPurify profile to <span> + inline styles
    output: "html",
  }),
);

// Normalize the LaTeX LLMs emit into what marked-katex expects.
//  - \(...\)  -> $...$   (inline)
//  - \[...\]  -> block display math
//  - $$...$$  -> block display math, re-emitted so it always parses
// The code-block alternation runs first so we don't rewrite math inside fences.
//
// Display math is forced onto its OWN un-indented lines with blank-line
// separation. Without this, models routinely indent a $$...$$ under a list
// item (4-space indent = a Markdown code block, so it renders as raw text) or
// place it flush against a preceding sentence with no blank line (parses as
// block only intermittently), the classic "sometimes it renders, sometimes
// it doesn't". A leading/trailing newline guarantees the block tokenizer wins.
function toDisplayBlock(inner: string): string {
  return `\n\n$$\n${inner.trim()}\n$$\n\n`;
}

function normalizeLatexDelimiters(text: string): string {
  return text.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g,
    (
      _match,
      code: string | undefined,
      inlineMath: string | undefined,
      bracketDisplay: string | undefined,
      dollarDisplay: string | undefined,
    ) => {
      if (code !== undefined) return code;
      if (inlineMath !== undefined) return `$${inlineMath}$`;
      if (bracketDisplay !== undefined) return toDisplayBlock(bracketDisplay);
      if (dollarDisplay !== undefined) return toDisplayBlock(dollarDisplay);
      return _match;
    },
  );
}

export function renderMarkdown(
  text: string,
  sourceDocId?: string | null,
): string {
  if (!text) return "";
  // citation pre-pass, only when a source doc is attached. turns [p.42] and
  // [p.42:"passage"] into reader links (q= carries the passage to highlight).
  // quote-aware regex must run first so it wins on overlapping matches.
  let withCitations = text;
  if (sourceDocId) {
    withCitations = withCitations
      .replace(
        /\[(p\.?\s?(\d+)):"([^"\n]+)"\]/g,
        (_match, label: string, page: string, quote: string) =>
          `[${label}](/reader/${sourceDocId}?page=${page}&q=${encodeURIComponent(quote)})`,
      )
      .replace(
        /\[(p\.?\s?(\d+))\]/g,
        (_match, label: string, page: string) =>
          `[${label}](/reader/${sourceDocId}?page=${page})`,
      );
  }
  const normalized = normalizeLatexDelimiters(withCitations);
  const raw = marked.parse(normalized, { async: false }) as string;
  // allowStyleAttr: KaTeX positions every glyph via inline style, drop it
  // and formulas collapse. addAttr: the copy-code button's data hooks.
  return sanitizeHtml(raw, {
    allowStyleAttr: true,
    addAttr: ["data-copy-code", "data-copy-text"],
  });
}

/**
 * On a click of an external http(s) link, prevent nav and return the href so the
 * caller can show a confirm dialog (AI-emitted URLs can be wrong or malicious).
 * Returns null for non-anchor, relative/internal, or already-prevented clicks.
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
 * Click handler for the message container. Intercepts copy-code button clicks,
 * decodes the base64 source, writes to clipboard, and flashes "Copied".
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
