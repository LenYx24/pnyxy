import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextAdapter, parseMarkdownHeadings } from "./text-adapter";

function makeFile(content: string, name = "notes.md"): File {
  return new File([content], name);
}

// URL.createObjectURL isn't provided by happy-dom; stub it so the
// adapter's load() doesn't throw.
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

function stubObjectUrl() {
  URL.createObjectURL = vi.fn(() => "blob:stub");
  URL.revokeObjectURL = vi.fn();
}

describe("parseMarkdownHeadings", () => {
  it("returns an empty array when there are no headings", () => {
    expect(parseMarkdownHeadings("Just some prose.\n\nNo headings here."))
      .toEqual([]);
  });

  it("builds a flat list from single-level headings", () => {
    const toc = parseMarkdownHeadings("# First\n\n# Second\n\n# Third");
    expect(toc).toHaveLength(3);
    expect(toc.map((t) => t.title)).toEqual(["First", "Second", "Third"]);
    expect(toc.every((t) => t.children.length === 0)).toBe(true);
  });

  it("nests children under the most-recent higher-level ancestor", () => {
    const md = [
      "# Top",
      "## Sub A",
      "### Deep",
      "## Sub B",
      "# Another",
    ].join("\n");
    const toc = parseMarkdownHeadings(md);
    expect(toc).toHaveLength(2);
    expect(toc[0].title).toBe("Top");
    expect(toc[0].children.map((c) => c.title)).toEqual(["Sub A", "Sub B"]);
    expect(toc[0].children[0].children.map((c) => c.title)).toEqual(["Deep"]);
    expect(toc[1].title).toBe("Another");
  });

  it("pops deeper levels when a shallower heading appears", () => {
    const md = "## A\n### B\n## C";
    const toc = parseMarkdownHeadings(md);
    expect(toc.map((t) => t.title)).toEqual(["A", "C"]);
    expect(toc[0].children.map((c) => c.title)).toEqual(["B"]);
  });

  it("sets pageIndex to 0 for every entry", () => {
    const toc = parseMarkdownHeadings("# Top\n## Sub");
    expect(toc[0].pageIndex).toBe(0);
    expect(toc[0].children[0].pageIndex).toBe(0);
  });
});

describe("createTextAdapter — markdown", () => {
  it("loads file content with the expected capabilities", async () => {
    stubObjectUrl();
    const adapter = createTextAdapter("markdown");
    const meta = await adapter.load(makeFile("# Title\nbody", "hello.md"));
    expect(meta.format).toBe("markdown");
    expect(meta.title).toBe("hello");
    expect(meta.totalPages).toBe(1);
    expect(meta.capabilities).toEqual({
      paginated: false,
      editable: true,
      searchable: true,
    });
    expect(meta.fileUrl).toBe("blob:stub");
  });

  it("round-trips content through getContent/setContent and notifies subscribers", async () => {
    stubObjectUrl();
    const adapter = createTextAdapter("markdown");
    await adapter.load(makeFile("# One\nbody", "one.md"));

    expect(await adapter.getContent?.()).toBe("# One\nbody");

    const cb = vi.fn();
    const unsubscribe = adapter.subscribeContent!(cb);
    await adapter.setContent?.("# Two");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(await adapter.getContent?.()).toBe("# Two");

    unsubscribe();
    await adapter.setContent?.("# Three");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("extracts headings into a nested ToC", async () => {
    stubObjectUrl();
    const adapter = createTextAdapter("markdown");
    await adapter.load(makeFile("# A\n## B\n# C", "chap.md"));
    const toc = await adapter.extractToc();
    expect(toc.map((t) => t.title)).toEqual(["A", "C"]);
    expect(toc[0].children.map((c) => c.title)).toEqual(["B"]);
  });

  it("searches content with case/wholeWord/regex options", async () => {
    stubObjectUrl();
    const adapter = createTextAdapter("markdown");
    await adapter.load(makeFile("cat catalog Cat", "animals.md"));

    const def = await adapter.search!("cat", {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(def.map((m) => m.sourceOffset)).toEqual([0, 4, 12]);

    const cased = await adapter.search!("cat", {
      caseSensitive: true,
      wholeWord: false,
      regex: false,
    });
    expect(cased.map((m) => m.sourceOffset)).toEqual([0, 4]);

    const wholeOnly = await adapter.search!("cat", {
      caseSensitive: false,
      wholeWord: true,
      regex: false,
    });
    expect(wholeOnly.map((m) => m.sourceOffset)).toEqual([0, 12]);

    const asRegex = await adapter.search!("c.t", {
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });
    expect(asRegex).not.toHaveLength(0);
  });

  it("dispose revokes the object URL", async () => {
    stubObjectUrl();
    const revoke = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
    const adapter = createTextAdapter("markdown");
    await adapter.load(makeFile("x", "x.md"));
    adapter.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:stub");
  });
});

describe("createTextAdapter — text", () => {
  it("reports text format and no ToC", async () => {
    stubObjectUrl();
    const adapter = createTextAdapter("text");
    const meta = await adapter.load(makeFile("# Not a heading", "raw.txt"));
    expect(meta.format).toBe("text");
    expect(meta.title).toBe("raw");
    expect(await adapter.extractToc()).toEqual([]);
  });

  it("still supports editable capabilities + search for .txt", async () => {
    stubObjectUrl();
    const adapter = createTextAdapter("text");
    const meta = await adapter.load(makeFile("alpha beta alpha", "file.txt"));
    expect(meta.capabilities.editable).toBe(true);
    const matches = await adapter.search!("alpha", {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(matches).toHaveLength(2);
  });
});
