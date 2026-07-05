/**
 * Tests for the VSCode-style search store. We don't stub the reader
 * store, instead we register a fake DocumentAdapter through
 * `useReaderStore.addDocument` so the store's existing
 * `getActiveDoc` / `requestScrollToPage` path runs as-is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentAdapter,
  DocumentMeta,
  SearchMatch,
  SearchOptions,
  TocItem,
} from "@/types/document";

// Mocks (shared with the reader-store test pattern)

const loadDocumentMetaMock = vi.fn(async () => undefined);
const saveDocumentMetaMock = vi.fn(async () => {});

vi.mock("@/lib/annotation-storage", () => ({
  loadDocumentMeta: loadDocumentMetaMock,
  saveDocumentMeta: saveDocumentMetaMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => ({ user: null, profile: null }) },
}));

// Helpers

interface FakeAdapterOptions {
  id?: string;
  title?: string;
  format?: "pdf" | "text" | "markdown" | "epub";
  paginated?: boolean;
  editable?: boolean;
  searchable?: boolean;
  totalPages?: number;
  initialContent?: string;
  overrideSearch?: (
    query: string,
    opts: SearchOptions,
  ) => Promise<SearchMatch[]> | SearchMatch[];
}

function makeAdapter(options: FakeAdapterOptions = {}) {
  let content = options.initialContent ?? "";
  const meta: DocumentMeta = {
    id: options.id ?? "doc-search",
    title: options.title ?? "Book",
    author: "Author",
    format: options.format ?? "markdown",
    totalPages: options.totalPages ?? 1,
    fileUrl: "blob:fake",
    capabilities: {
      paginated: options.paginated ?? false,
      editable: options.editable ?? true,
      searchable: options.searchable ?? true,
    },
  };
  const toc: TocItem[] = [];

  const searchFn = vi.fn(async (query: string, opts: SearchOptions) => {
    if (options.overrideSearch) {
      return options.overrideSearch(query, opts);
    }
    const { runTextSearch } = await import("@/lib/text-search");
    return runTextSearch(content, query, opts);
  });
  const getContentFn = vi.fn(async () => content);
  const setContentFn = vi.fn(async (next: string) => {
    content = next;
  });

  const adapter: DocumentAdapter = {
    load: vi.fn(async () => meta),
    extractToc: vi.fn(async () => toc),
    dispose: vi.fn(),
    getContent: getContentFn,
    setContent: setContentFn,
    search: searchFn,
  };
  return { adapter, meta, searchFn, getContentFn, setContentFn };
}

async function loadStores() {
  const { useReaderStore } = await import("./reader-store");
  const { useSearchStore } = await import("./search-store");
  return { useReaderStore, useSearchStore };
}

async function registerDoc(adapter: DocumentAdapter) {
  const { useReaderStore } = await loadStores();
  const file = new File([new Uint8Array([1, 2])], "doc.md");
  return useReaderStore.getState().addDocument(adapter, file);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  loadDocumentMetaMock.mockReset();
  loadDocumentMetaMock.mockResolvedValue(undefined);
  saveDocumentMetaMock.mockReset();
  saveDocumentMetaMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Tests

describe("open / close", () => {
  it("opens in find mode by default", async () => {
    const { useSearchStore } = await loadStores();
    useSearchStore.getState().open();
    expect(useSearchStore.getState().isOpen).toBe(true);
    expect(useSearchStore.getState().mode).toBe("find");
  });

  it("opens in replace mode when the active doc is editable", async () => {
    const { adapter } = makeAdapter({ editable: true });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.getState().open("replace");
    expect(useSearchStore.getState().mode).toBe("replace");
  });

  it("coerces replace mode to find when the active doc is read-only", async () => {
    const { adapter } = makeAdapter({ editable: false });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.getState().open("replace");
    expect(useSearchStore.getState().mode).toBe("find");
  });

  it("close clears matches, cursor, error, and debounced work", async () => {
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({
      isOpen: true,
      matches: [
        {
          id: "m0",
          sourceOffset: 0,
          snippet: "hit",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
      ],
      currentIdx: 0,
      error: "boom",
      isSearching: true,
    });
    useSearchStore.getState().close();
    const s = useSearchStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.matches).toEqual([]);
    expect(s.currentIdx).toBe(-1);
    expect(s.error).toBeNull();
    expect(s.isSearching).toBe(false);
  });
});

describe("search", () => {
  it("runs the adapter search and loads matches", async () => {
    const { adapter } = makeAdapter({
      initialContent: "hello hello world",
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({ query: "hello" });
    await useSearchStore.getState().search();

    const s = useSearchStore.getState();
    expect(s.matches).toHaveLength(2);
    expect(s.currentIdx).toBe(0);
    expect(s.error).toBeNull();
  });

  it("reports an invalid regex as an error and clears matches", async () => {
    const { adapter } = makeAdapter({ initialContent: "abc" });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({
      query: "[invalid(",
      options: { caseSensitive: false, wholeWord: false, regex: true },
    });
    await useSearchStore.getState().search();
    const s = useSearchStore.getState();
    expect(s.matches).toEqual([]);
    expect(s.error).toBe("Invalid regular expression");
    expect(s.currentIdx).toBe(-1);
  });

  it("setQuery('') clears matches immediately without scheduling", async () => {
    const { adapter, searchFn } = makeAdapter({
      initialContent: "hello world",
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({
      matches: [
        {
          id: "x",
          sourceOffset: 0,
          snippet: "hit",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
      ],
      currentIdx: 0,
      error: "prev",
    });
    useSearchStore.getState().setQuery("");
    vi.advanceTimersByTime(1000);
    const s = useSearchStore.getState();
    expect(s.matches).toEqual([]);
    expect(s.currentIdx).toBe(-1);
    expect(s.error).toBeNull();
    expect(searchFn).not.toHaveBeenCalled();
  });

  it("setQuery debounces before calling the adapter", async () => {
    const { adapter, searchFn } = makeAdapter({ initialContent: "abc abc" });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();

    useSearchStore.getState().setQuery("abc");
    expect(searchFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(searchFn).toHaveBeenCalledTimes(1);
  });

  it("setOptions re-runs the search immediately", async () => {
    const { adapter, searchFn } = makeAdapter({
      initialContent: "Cat cat CAT",
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({ query: "cat" });

    useSearchStore.getState().setOptions({ caseSensitive: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().matches).toHaveLength(1);
  });
});

describe("next / prev", () => {
  function seedMatches(store: {
    setState: (s: Partial<{ matches: SearchMatch[]; currentIdx: number }>) => void;
  }) {
    const matches: SearchMatch[] = [0, 1, 2].map((i) => ({
      id: `m${i}`,
      sourceOffset: i * 10,
      snippet: "hit",
      snippetMatchStart: 0,
      snippetMatchEnd: 3,
    }));
    store.setState({ matches, currentIdx: 0 });
  }

  it("no-ops when there are no matches", async () => {
    const { useSearchStore } = await loadStores();
    useSearchStore.getState().next();
    useSearchStore.getState().prev();
    expect(useSearchStore.getState().currentIdx).toBe(-1);
  });

  it("wraps around forward and backward", async () => {
    const { useSearchStore } = await loadStores();
    seedMatches(useSearchStore);

    useSearchStore.getState().next();
    expect(useSearchStore.getState().currentIdx).toBe(1);
    useSearchStore.getState().next();
    expect(useSearchStore.getState().currentIdx).toBe(2);
    useSearchStore.getState().next();
    expect(useSearchStore.getState().currentIdx).toBe(0);

    useSearchStore.getState().prev();
    expect(useSearchStore.getState().currentIdx).toBe(2);
  });

  it("requests scroll to the paginated match's page", async () => {
    const { adapter } = makeAdapter({
      paginated: true,
      editable: false,
      totalPages: 20,
      overrideSearch: () => [
        {
          id: "m0",
          pageNum: 4,
          snippet: "hit",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
        {
          id: "m1",
          pageNum: 11,
          snippet: "hit",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
      ],
    });
    await registerDoc(adapter);

    const { useReaderStore, useSearchStore } = await loadStores();
    const scrollSpy = vi.spyOn(useReaderStore.getState(), "requestScrollToPage");
    // Re-attach the spy onto the store's action since `set` replaces it.
    useReaderStore.setState({ requestScrollToPage: scrollSpy });

    useSearchStore.setState({ query: "hit" });
    await useSearchStore.getState().search();
    expect(scrollSpy).toHaveBeenLastCalledWith(4);

    useSearchStore.getState().next();
    expect(scrollSpy).toHaveBeenLastCalledWith(11);
  });
});

describe("replaceCurrent", () => {
  it("no-ops when the adapter is read-only", async () => {
    const { adapter, setContentFn } = makeAdapter({
      editable: false,
      paginated: true,
      totalPages: 1,
      overrideSearch: () => [
        {
          id: "m0",
          pageNum: 1,
          snippet: "hit",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
      ],
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({
      matches: [
        {
          id: "m0",
          pageNum: 1,
          snippet: "hit",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
      ],
      currentIdx: 0,
      query: "hit",
      replacement: "X",
    });
    await useSearchStore.getState().replaceCurrent();
    expect(setContentFn).not.toHaveBeenCalled();
  });

  it("rewrites the current match and advances the cursor", async () => {
    const { adapter, setContentFn } = makeAdapter({
      initialContent: "foo bar foo",
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();

    useSearchStore.setState({ query: "foo" });
    await useSearchStore.getState().search();
    expect(useSearchStore.getState().matches).toHaveLength(2);
    expect(useSearchStore.getState().currentIdx).toBe(0);

    useSearchStore.setState({ replacement: "baz" });
    await useSearchStore.getState().replaceCurrent();

    expect(setContentFn).toHaveBeenCalledWith("baz bar foo");
    const after = useSearchStore.getState();
    expect(after.matches).toHaveLength(1);
    expect(after.matches[0].sourceOffset).toBe(8);
    expect(after.currentIdx).toBe(0);
  });
});

describe("replaceAll", () => {
  it("no-ops when the adapter is read-only", async () => {
    const { adapter, setContentFn } = makeAdapter({
      editable: false,
      paginated: true,
      totalPages: 1,
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({ query: "x", replacement: "y" });
    await useSearchStore.getState().replaceAll();
    expect(setContentFn).not.toHaveBeenCalled();
  });

  it("rewrites every match in one shot and clears state", async () => {
    const { adapter, setContentFn } = makeAdapter({
      initialContent: "foo foo foo",
    });
    await registerDoc(adapter);
    const { useSearchStore } = await loadStores();
    useSearchStore.setState({
      query: "foo",
      replacement: "bar",
      matches: [
        {
          id: "x",
          sourceOffset: 0,
          snippet: "foo",
          snippetMatchStart: 0,
          snippetMatchEnd: 3,
        },
      ],
      currentIdx: 0,
    });

    await useSearchStore.getState().replaceAll();
    expect(setContentFn).toHaveBeenCalledWith("bar bar bar");
    const s = useSearchStore.getState();
    expect(s.matches).toEqual([]);
    expect(s.currentIdx).toBe(-1);
  });
});
