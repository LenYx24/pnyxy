import DOMPurify from "dompurify";

export interface SanitizeHtmlOptions {
  /**
   * Keep the `style` attribute on elements. Needed for KaTeX, which
   * positions every glyph via inline styles. Even when allowed, a style
   * value containing `url(`, `expression(`, `@import`, or `position:fixed`
   * is stripped, those are the properties used for cross-origin loads,
   * old-IE script execution, and clickjacking overlays.
   */
  allowStyleAttr?: boolean;
  /** Extra attributes to allow on top of the safe baseline (e.g. data-* hooks used by a renderer). */
  addAttr?: string[];
}

const FORBID_TAGS = [
  "style",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
];

// target/rel are always attacker-controlled input attributes, we set them
// ourselves in the afterSanitizeAttributes hook below.
const FORBID_ATTR = ["action", "formaction", "onload", "target", "rel"];

// http(s), mailto, in-page anchors, and root-relative paths. Notably
// excludes javascript: and data: (data:image/* is allowed separately,
// only for <img src>, via the uponSanitizeAttribute hook below).
const SAFE_URI_REGEXP = /^(?:https?:|mailto:|#|\/)/i;

const DANGEROUS_STYLE_PATTERN = /url\(|expression\(|@import|position\s*:\s*fixed/i;

// Registered once, globally, the first time this module is imported.
// uponSanitizeAttribute fires before DOMPurify's own URI-safety check, so
// setting forceKeepAttr lets a data:image/* <img src> through even though
// SAFE_URI_REGEXP above rejects data: everywhere else.
DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (
    data.attrName === "src" &&
    node.tagName === "IMG" &&
    /^data:image\//i.test(data.attrValue)
  ) {
    data.forceKeepAttr = true;
  }
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // `target`/`rel` are decided by us, not the input HTML (an attacker-
  // controlled target is pointless and DOMPurify's own URI-safety regex
  // ends up validating the target value too, which would drop it for a
  // non-URI-shaped value like "_blank"). Set them directly via the DOM
  // API here, which bypasses the attribute allowlist entirely: external
  // http(s) links get target=_blank + rel=noopener noreferrer (no
  // window.opener handle back to us); anything else gets neither, an
  // internal `#id` or `/path` href has no business popping a new tab.
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } else {
      node.removeAttribute("target");
      node.removeAttribute("rel");
    }
  }

  if (node.hasAttribute("style")) {
    const style = node.getAttribute("style");
    if (style && DANGEROUS_STYLE_PATTERN.test(style)) {
      node.removeAttribute("style");
    }
  }
});

/**
 * Shared HTML sanitizer for every `dangerouslySetInnerHTML` site in the
 * app (rendered markdown, forum posts/comments, resource text). Strips
 * script-capable and form-capable tags, blocks javascript:/data: URIs on
 * links, and locks down target="_blank" popups.
 */
export function sanitizeHtml(html: string, opts: SanitizeHtmlOptions = {}): string {
  const { allowStyleAttr = false, addAttr = [] } = opts;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS,
    // DOMPurify allows `style` by default, so forbid it explicitly
    // unless the caller opts in (KaTeX needs it for glyph positioning).
    FORBID_ATTR: allowStyleAttr ? FORBID_ATTR : [...FORBID_ATTR, "style"],
    ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
    ADD_ATTR: addAttr,
  }) as unknown as string;
}
