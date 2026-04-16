/**
 * Unit tests for the adapter dispatcher. Each adapter factory is
 * heavily mocked so this test stays fast and isolated — we're just
 * verifying that the right factory gets called for a given file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./pdf-adapter", () => ({
  createPdfAdapter: vi.fn(() => ({ __kind: "pdf" })),
}));
vi.mock("./text-adapter", () => ({
  createTextAdapter: vi.fn((format: "text" | "markdown") => ({
    __kind: format,
  })),
}));
vi.mock("./epub-adapter", () => ({
  createEpubAdapter: vi.fn(() => ({ __kind: "epub" })),
}));

async function load() {
  return import("./index");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function file(name: string, type = ""): File {
  return new File([new Uint8Array([1])], name, { type });
}

describe("detectFormat", () => {
  it("detects PDF by extension", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("book.pdf"))).toBe("pdf");
  });

  it("detects PDF by MIME when the extension is missing", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("book", "application/pdf"))).toBe("pdf");
  });

  it("detects EPUB by extension", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("book.epub"))).toBe("epub");
  });

  it("detects EPUB by MIME", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("book", "application/epub+zip"))).toBe("epub");
  });

  it("detects markdown by .md and .markdown", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("notes.md"))).toBe("markdown");
    expect(detectFormat(file("notes.markdown"))).toBe("markdown");
  });

  it("falls back to text for anything else", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("notes.txt"))).toBe("text");
    expect(detectFormat(file("mystery"))).toBe("text");
  });

  it("is case-insensitive on the extension", async () => {
    const { detectFormat } = await load();
    expect(detectFormat(file("BOOK.PDF"))).toBe("pdf");
    expect(detectFormat(file("BOOK.EPUB"))).toBe("epub");
    expect(detectFormat(file("NOTES.MD"))).toBe("markdown");
  });
});

describe("createAdapterForFile", () => {
  it("returns the PDF adapter for .pdf files", async () => {
    const mod = await load();
    const { createPdfAdapter } = await import("./pdf-adapter");
    mod.createAdapterForFile(file("book.pdf"));
    expect(createPdfAdapter).toHaveBeenCalledOnce();
  });

  it("returns the EPUB adapter for .epub files", async () => {
    const mod = await load();
    const { createEpubAdapter } = await import("./epub-adapter");
    mod.createAdapterForFile(file("book.epub"));
    expect(createEpubAdapter).toHaveBeenCalledOnce();
  });

  it("returns a markdown text-adapter for .md files", async () => {
    const mod = await load();
    const { createTextAdapter } = await import("./text-adapter");
    mod.createAdapterForFile(file("notes.md"));
    expect(createTextAdapter).toHaveBeenCalledExactlyOnceWith("markdown");
  });

  it("returns a markdown text-adapter for .markdown files", async () => {
    const mod = await load();
    const { createTextAdapter } = await import("./text-adapter");
    mod.createAdapterForFile(file("notes.markdown"));
    expect(createTextAdapter).toHaveBeenCalledExactlyOnceWith("markdown");
  });

  it("returns a plain-text text-adapter for .txt files", async () => {
    const mod = await load();
    const { createTextAdapter } = await import("./text-adapter");
    mod.createAdapterForFile(file("notes.txt"));
    expect(createTextAdapter).toHaveBeenCalledExactlyOnceWith("text");
  });

  it("falls back to a plain-text adapter for unknown extensions", async () => {
    const mod = await load();
    const { createTextAdapter } = await import("./text-adapter");
    mod.createAdapterForFile(file("unknown.bin"));
    expect(createTextAdapter).toHaveBeenCalledExactlyOnceWith("text");
  });
});
