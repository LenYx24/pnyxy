import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * We mock `epubjs` with a minimal Book-like fake so we can exercise
 * load/extractToc/search without needing to unzip an actual EPUB.
 */

interface FakeSpineItem {
  href: string;
  text: string;
}

interface FakeBookState {
  metadata: { title: string; creator: string };
  nav: unknown[];
  spine: FakeSpineItem[];
}

let bookState: FakeBookState = {
  metadata: { title: "Fake Book", creator: "A. Writer" },
  nav: [],
  spine: [],
};

const destroyFn = vi.fn();

vi.mock("epubjs", () => {
  function makeBook() {
    return {
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve(bookState.metadata),
        navigation: Promise.resolve({ toc: bookState.nav }),
      },
      spine: {
        each(fn: (item: unknown) => void) {
          for (const item of bookState.spine) {
            fn({
              href: item.href,
              load: async () => {
                const doc = document.implementation.createHTMLDocument(item.href);
                doc.body.textContent = item.text;
                return doc;
              },
              unload() {},
            });
          }
        },
      },
      load() {},
      destroy: destroyFn,
    };
  }
  const ePub = vi.fn(() => makeBook());
  return { default: ePub };
});

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:stub-epub");
  URL.revokeObjectURL = vi.fn();
  destroyFn.mockReset();
  bookState = {
    metadata: { title: "Fake Book", creator: "A. Writer" },
    nav: [],
    spine: [],
  };
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

async function loadAdapter() {
  const mod = await import("./epub-adapter");
  return mod.createEpubAdapter();
}

function fakeEpubFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "book.epub");
}

describe("epub-adapter", () => {
  it("reports epub metadata and read-only capabilities", async () => {
    const adapter = await loadAdapter();
    const meta = await adapter.load(fakeEpubFile());
    expect(meta.format).toBe("epub");
    expect(meta.title).toBe("Fake Book");
    expect(meta.author).toBe("A. Writer");
    expect(meta.capabilities).toEqual({
      paginated: false,
      editable: false,
      searchable: true,
    });
  });

  it("falls back to the filename when metadata has no title", async () => {
    bookState.metadata = { title: "", creator: "" };
    const adapter = await loadAdapter();
    const meta = await adapter.load(fakeEpubFile());
    expect(meta.title).toBe("book");
    expect(meta.author).toBe("Unknown");
  });

  it("translates the navigation.toc into nested TocItems", async () => {
    bookState.nav = [
      {
        label: " Part 1 ",
        href: "a.xhtml",
        subitems: [
          { label: "Chapter 1", href: "a1.xhtml" },
          { label: "Chapter 2", href: "a2.xhtml" },
        ],
      },
      { label: "Part 2", href: "b.xhtml" },
    ];
    const adapter = await loadAdapter();
    await adapter.load(fakeEpubFile());
    const toc = await adapter.extractToc();
    expect(toc).toHaveLength(2);
    expect(toc[0].title).toBe("Part 1");
    expect(toc[0].children.map((c) => c.title)).toEqual([
      "Chapter 1",
      "Chapter 2",
    ]);
  });

  it("searches across spine items and tags each match with its spineHref", async () => {
    bookState.spine = [
      { href: "chap1.xhtml", text: "Alice and the rabbit." },
      { href: "chap2.xhtml", text: "Rabbit, rabbit, rabbit!" },
      { href: "chap3.xhtml", text: "No match here." },
    ];
    const adapter = await loadAdapter();
    await adapter.load(fakeEpubFile());
    const matches = await adapter.search!("rabbit", {
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
    expect(matches).toHaveLength(4);
    expect(matches.map((m) => m.spineHref)).toEqual([
      "chap1.xhtml",
      "chap2.xhtml",
      "chap2.xhtml",
      "chap2.xhtml",
    ]);
  });

  it("returns no matches for an invalid regex", async () => {
    bookState.spine = [{ href: "c.xhtml", text: "anything" }];
    const adapter = await loadAdapter();
    await adapter.load(fakeEpubFile());
    const matches = await adapter.search!("[bad(", {
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    });
    expect(matches).toEqual([]);
  });

  it("destroys the book and revokes the object URL on dispose", async () => {
    const adapter = await loadAdapter();
    await adapter.load(fakeEpubFile());
    adapter.dispose();
    expect(destroyFn).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:stub-epub");
  });
});
