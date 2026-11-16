import { describe, expect, it } from "vitest";
import { renderInlineMarkdown, renderMarkdown } from "./markdown-message";

describe("renderInlineMarkdown", () => {
  it("renders inline math without a wrapping paragraph", () => {
    const html = renderInlineMarkdown("Mennyi $a^{p-1} \\bmod p$?");
    expect(html).toContain("katex");
    expect(html.startsWith("<p>")).toBe(false);
  });
  it("renders \\( \\) and display math inline", () => {
    expect(renderInlineMarkdown("\\(x^2\\)")).toContain("katex");
    expect(renderInlineMarkdown("$$x^2$$")).toContain("katex");
  });
});

describe("page citations", () => {
  it("links a page range to its first page", () => {
    const html = renderMarkdown("lásd [p.15-20]", "doc1");
    expect(html).toContain('href="/reader/doc1?page=15"');
    expect(html).toContain("p.15-20");
  });
});

describe("quoted page citations", () => {
  it("keeps a quote with parentheses inside the link", () => {
    const html = renderMarkdown('lásd [p.12:"a (mod n) maradék"] itt', "doc1");
    expect(html).toContain("q=a%20%28mod%20n%29");
    expect(html).not.toContain("/reader/doc1?page=12&amp;q=a%20(");
    expect(html).toContain(">p.12</a> itt");
  });
  it("accepts Hungarian quotes and a space after the colon", () => {
    const html = renderMarkdown("[p.3: „tétel”]", "doc1");
    expect(html).toContain('href="/reader/doc1?page=3&amp;q=');
  });
});
