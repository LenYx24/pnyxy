// happy-dom (the project's default vitest environment) has a bug where a
// forbidden tag nested inside another element isn't removed by DOMPurify's
// FORBID_TAGS (verified against jsdom, where the exact same call behaves
// correctly), so this security-sensitive suite pins jsdom instead.
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("sanitizeHtml", () => {
  it("strips form and input elements", () => {
    const out = sanitizeHtml(
      '<form action="https://evil.example/steal"><input name="x" /></form><p>keep</p>',
    );
    expect(out).not.toContain("<form");
    expect(out).not.toContain("<input");
    expect(out).toContain("keep");
  });

  it("strips style tags", () => {
    const out = sanitizeHtml("<style>body{display:none}</style><p>keep</p>");
    expect(out).not.toContain("<style");
    expect(out).toContain("keep");
  });

  it("removes javascript: hrefs", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
  });

  it("removes onclick and other inline event handlers", () => {
    const out = sanitizeHtml('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain("onclick");
  });

  it("forces rel=noopener noreferrer and target=_blank on external links", () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">go</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("drops target on internal/relative links even if present", () => {
    const out = sanitizeHtml('<a href="/reader/123" target="_blank">go</a>');
    expect(out).not.toContain('target="_blank"');
  });

  it("keeps a KaTeX span's style attribute when allowStyleAttr is set", () => {
    const out = sanitizeHtml(
      '<span class="katex" style="position:relative;top:0.1em">x</span>',
      { allowStyleAttr: true },
    );
    expect(out).toContain("style=");
    expect(out).toContain("katex");
  });

  it("strips the style attribute entirely when allowStyleAttr is not set", () => {
    const out = sanitizeHtml('<span style="color:red">x</span>');
    expect(out).not.toContain("style=");
  });

  it("drops url() from style even when allowStyleAttr is set", () => {
    const out = sanitizeHtml(
      '<div style="background:url(https://evil.example/x.png)">x</div>',
      { allowStyleAttr: true },
    );
    expect(out).not.toContain("style=");
  });

  it("keeps data:image/* only on img src", () => {
    const out = sanitizeHtml('<img src="data:image/png;base64,AAAA" />');
    expect(out).toContain("data:image/png");
  });

  it("strips non-image data: URIs", () => {
    const out = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain("data:");
  });
});
