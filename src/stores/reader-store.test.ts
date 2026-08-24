/**
 * Tests for the central reader store. We mock the annotation-storage
 * layer (so we don't need IndexedDB and can spy on persistence calls)
 * and feed in a fake `DocumentAdapter`. The real settings store +
 * tracker registry + host event bus run as-is so we exercise the
 * actual integration wiring.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DocumentAdapter, DocumentMeta, TocItem } from "@/types/document";
import type { loadDocumentMeta } from "@/lib/annotation-storage";

// Mocks

const loadDocumentMetaMock = vi.fn<typeof loadDocumentMeta>();
const saveDocumentMetaMock = vi.fn(async () => {});

vi.mock("@/lib/annotation-storage", () => ({
  loadDocumentMeta: loadDocumentMetaMock,
  saveDocumentMeta: saveDocumentMetaMock,
}));

// Avoid pulling supabase / auth into this test.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  },
}));

// The store tests exercise multi-document behaviour; the pilot default
// (single-document mode) is covered separately below.
const featuresMock = vi.hoisted(() => ({ multiDoc: true }));
vi.mock("@/lib/use-features", () => ({
  getFeatures: () => featuresMock,
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: { getState: () => ({ user: null, profile: null }) },
}));

// Helpers

function makeAdapter(
  overrides: { id?: string; title?: string; totalPages?: number } = {},
): DocumentAdapter {
  const meta: DocumentMeta = {
    id: overrides.id ?? "doc-1",
    title: overrides.title ?? "My Book",
    author: "Author",
    format: "pdf",
    totalPages: overrides.totalPages ?? 10,
    fileUrl: "blob:fake",
    capabilities: {
      paginated: true,
      editable: false,
      searchable: true,
    },
  };
  const toc: TocItem[] = [];
  return {
    load: vi.fn(async () => meta),
    extractToc: vi.fn(async () => toc),
    dispose: vi.fn(),
  };
}

const FAKE_FILE = new File([new Uint8Array([1, 2, 3])], "x.pdf", {
  type: "application/pdf",
});

async function loadStores() {
  const { useReaderStore } = await import("./reader-store");
  const { useSettingsStore } = await import("./settings-store");
  const { hostEventBus } = await import("@/lib/plugins/api/events");
  return { useReaderStore, useSettingsStore, hostEventBus };
}

beforeEach(() => {
  vi.resetModules();
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

describe("addDocument", () => {
  it("loads the adapter, extracts toc, sets the doc as active, and emits book:opened", async () => {
    const { useReaderStore, hostEventBus } = await loadStores();
    const events: unknown[] = [];
    const off = hostEventBus.on("book:opened", (p) => events.push(p));

    const adapter = makeAdapter({ id: "abc", title: "Hello", totalPages: 5 });
    const id = await useReaderStore.getState().addDocument(adapter, FAKE_FILE);

    expect(id).toBe("abc");
    expect(adapter.load).toHaveBeenCalledWith(FAKE_FILE);
    expect(adapter.extractToc).toHaveBeenCalled();

    const state = useReaderStore.getState();
    expect(state.activeDocumentId).toBe("abc");
    const doc = state.documents.get("abc");
    expect(doc?.totalPages).toBe(5);
    expect(doc?.currentPage).toBe(1);
    expect(doc?.zoomLevel).toBe(100);
    expect(doc?.scrollToPage).toBeNull();

    expect(events).toEqual([{ docId: "abc", title: "Hello" }]);
    off();
  });

  it("restores customTitle, zoomMode, lastPosition, and progressPage from storage", async () => {
    loadDocumentMetaMock.mockResolvedValue({
      documentId: "doc-1",
      customTitle: "My Title",
      zoomMode: "fit-page",
      lastPosition: 4,
      progressPage: 7,
    });
    const { useReaderStore } = await loadStores();

    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);

    const doc = useReaderStore.getState().documents.get("doc-1")!;
    expect(doc.customTitle).toBe("My Title");
    expect(doc.zoomMode).toBe("fit-page");
    expect(doc.lastPosition).toBe(4);
    expect(doc.progressPage).toBe(7);
    // Stored lastPosition > 1 ⇒ scrollToPage is set so we resume.
    expect(doc.scrollToPage).toBe(4);
    expect(doc.currentPage).toBe(4);
  });

  it("clamps a stored progressPage that exceeds totalPages", async () => {
    loadDocumentMetaMock.mockResolvedValue({
      documentId: "doc-1",
      progressPage: 999,
      lastPosition: 999,
    });
    const { useReaderStore } = await loadStores();

    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);

    const doc = useReaderStore.getState().documents.get("doc-1")!;
    expect(doc.progressPage).toBe(10);
    expect(doc.lastPosition).toBe(10);
  });

  it("falls back to defaults if loadDocumentMeta rejects", async () => {
    loadDocumentMetaMock.mockRejectedValue(new Error("idb broken"));
    const { useReaderStore } = await loadStores();

    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);

    const doc = useReaderStore.getState().documents.get("doc-1")!;
    expect(doc.customTitle).toBeNull();
    expect(doc.lastPosition).toBe(1);
    expect(doc.progressPage).toBe(0);
  });
});

describe("removeDocument", () => {
  it("disposes the adapter and removes the entry; emits book:closed", async () => {
    const { useReaderStore, hostEventBus } = await loadStores();
    const closed: unknown[] = [];
    const off = hostEventBus.on("book:closed", (p) => closed.push(p));

    const adapter = makeAdapter({ id: "doc-1" });
    await useReaderStore.getState().addDocument(adapter, FAKE_FILE);
    useReaderStore.getState().removeDocument("doc-1");

    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    expect(useReaderStore.getState().documents.has("doc-1")).toBe(false);
    expect(useReaderStore.getState().activeDocumentId).toBeNull();
    expect(closed).toEqual([{ docId: "doc-1" }]);
    off();
  });

  it("activates the most recently added remaining doc when closing the active one", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ id: "a" }), FAKE_FILE);
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ id: "b" }), FAKE_FILE);
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ id: "c" }), FAKE_FILE);
    expect(useReaderStore.getState().activeDocumentId).toBe("c");

    useReaderStore.getState().removeDocument("c");
    expect(useReaderStore.getState().activeDocumentId).toBe("b");
  });

  it("single-document mode: opening a book replaces and disposes the open one", async () => {
    featuresMock.multiDoc = false;
    try {
      const { useReaderStore } = await loadStores();
      const first = makeAdapter({ id: "a" });
      await useReaderStore.getState().addDocument(first, FAKE_FILE);
      await useReaderStore
        .getState()
        .addDocument(makeAdapter({ id: "b" }), FAKE_FILE);
      expect(first.dispose).toHaveBeenCalledTimes(1);
      expect(Array.from(useReaderStore.getState().documents.keys())).toEqual(["b"]);
      expect(useReaderStore.getState().activeDocumentId).toBe("b");
    } finally {
      featuresMock.multiDoc = true;
    }
  });

  it("keeps the active doc when removing a different one", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ id: "a" }), FAKE_FILE);
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ id: "b" }), FAKE_FILE);
    useReaderStore.getState().setActiveDocument("a");

    useReaderStore.getState().removeDocument("b");
    expect(useReaderStore.getState().activeDocumentId).toBe("a");
  });
});

describe("page navigation", () => {
  it("nextPage advances and stops at the last page", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 3 }), FAKE_FILE);
    const id = "doc-1";

    useReaderStore.getState().nextPage();
    expect(useReaderStore.getState().documents.get(id)?.currentPage).toBe(2);

    useReaderStore.getState().nextPage();
    useReaderStore.getState().nextPage(); // already at end
    expect(useReaderStore.getState().documents.get(id)?.currentPage).toBe(3);
  });

  it("prevPage decreases and stops at page 1", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);
    useReaderStore.getState().goToPage(3);
    expect(useReaderStore.getState().documents.get("doc-1")?.currentPage).toBe(
      3,
    );

    useReaderStore.getState().prevPage();
    useReaderStore.getState().prevPage();
    useReaderStore.getState().prevPage(); // already at 1
    expect(useReaderStore.getState().documents.get("doc-1")?.currentPage).toBe(
      1,
    );
  });

  it("goToPage clamps the requested page into [1, totalPages]", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);

    useReaderStore.getState().goToPage(99);
    expect(useReaderStore.getState().documents.get("doc-1")?.currentPage).toBe(
      5,
    );
    useReaderStore.getState().goToPage(-3);
    expect(useReaderStore.getState().documents.get("doc-1")?.currentPage).toBe(
      1,
    );
  });

  it("goToPage updates scrollToPage so the renderer scrolls", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);

    useReaderStore.getState().goToPage(3);
    expect(useReaderStore.getState().documents.get("doc-1")?.scrollToPage).toBe(
      3,
    );
    useReaderStore.getState().clearScrollRequest();
    expect(
      useReaderStore.getState().documents.get("doc-1")?.scrollToPage,
    ).toBeNull();
  });

  it("nextPage is a no-op when there is no active document", async () => {
    const { useReaderStore } = await loadStores();
    expect(() => useReaderStore.getState().nextPage()).not.toThrow();
  });
});

describe("zoom", () => {
  it("zoomIn increments by 15 and switches to custom mode", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore.getState().addDocument(makeAdapter(), FAKE_FILE);
    useReaderStore.getState().zoomIn();
    const doc = useReaderStore.getState().documents.get("doc-1")!;
    expect(doc.zoomLevel).toBe(115);
    expect(doc.zoomMode).toBe("custom");
  });

  it("zoomIn is capped at 1000", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore.getState().addDocument(makeAdapter(), FAKE_FILE);
    useReaderStore.getState().setZoomLevel(995);
    useReaderStore.getState().zoomIn();
    expect(useReaderStore.getState().documents.get("doc-1")?.zoomLevel).toBe(
      1000,
    );
  });

  it("zoomOut decrements by 15 and is floored at 25", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore.getState().addDocument(makeAdapter(), FAKE_FILE);
    useReaderStore.getState().setZoomLevel(40);
    useReaderStore.getState().zoomOut();
    expect(useReaderStore.getState().documents.get("doc-1")?.zoomLevel).toBe(
      25,
    );
    useReaderStore.getState().zoomOut(); // already at floor
    expect(useReaderStore.getState().documents.get("doc-1")?.zoomLevel).toBe(
      25,
    );
  });

  it("setZoomLevel clamps into [25, 1000] and switches to custom", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore.getState().addDocument(makeAdapter(), FAKE_FILE);

    useReaderStore.getState().setZoomLevel(99999);
    expect(useReaderStore.getState().documents.get("doc-1")?.zoomLevel).toBe(
      1000,
    );
    useReaderStore.getState().setZoomLevel(0);
    expect(useReaderStore.getState().documents.get("doc-1")?.zoomLevel).toBe(
      25,
    );
    expect(useReaderStore.getState().documents.get("doc-1")?.zoomMode).toBe(
      "custom",
    );
  });

  it("setZoomMode persists fit modes and skips persistence for 'custom'", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore.getState().addDocument(makeAdapter(), FAKE_FILE);
    saveDocumentMetaMock.mockClear();

    useReaderStore.getState().setZoomMode("fit-page");
    // Wait for the inner loadDocumentMeta().then(saveDocumentMeta(...)).
    await Promise.resolve();
    await Promise.resolve();
    expect(saveDocumentMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: "doc-1", zoomMode: "fit-page" }),
    );

    saveDocumentMetaMock.mockClear();
    useReaderStore.getState().setZoomMode("custom");
    await Promise.resolve();
    await Promise.resolve();
    expect(saveDocumentMetaMock).not.toHaveBeenCalled();
  });
});

describe("custom title", () => {
  it("setCustomTitle updates the doc and persists", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore.getState().addDocument(makeAdapter(), FAKE_FILE);
    saveDocumentMetaMock.mockClear();

    useReaderStore.getState().setCustomTitle("Renamed");
    expect(useReaderStore.getState().documents.get("doc-1")?.customTitle).toBe(
      "Renamed",
    );
    expect(saveDocumentMetaMock).toHaveBeenCalledWith({
      documentId: "doc-1",
      customTitle: "Renamed",
    });
  });

  it("getDisplayTitle prefers customTitle, falls back to meta.title, then 'Untitled'", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ title: "Original" }), FAKE_FILE);
    expect(useReaderStore.getState().getDisplayTitle()).toBe("Original");

    useReaderStore.getState().setCustomTitle("Custom");
    expect(useReaderStore.getState().getDisplayTitle()).toBe("Custom");

    useReaderStore.getState().removeDocument("doc-1");
    expect(useReaderStore.getState().getDisplayTitle()).toBe("Untitled");
  });
});

describe("tracker integration (toggle tracker, default settings)", () => {
  it("advances progressPage on forward navigation", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);

    useReaderStore.getState().goToPage(4);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      4,
    );
    useReaderStore.getState().goToPage(7);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      7,
    );
  });

  it("never moves progressPage backwards on prevPage", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);
    useReaderStore.getState().goToPage(8);
    useReaderStore.getState().prevPage();
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      8,
    );
    expect(useReaderStore.getState().documents.get("doc-1")?.currentPage).toBe(
      7,
    );
  });

  it("does not advance progressPage when the toggle tracker is disabled", async () => {
    const { useReaderStore, useSettingsStore } = await loadStores();
    useSettingsStore.setState({
      trackerSettings: {
        ...useSettingsStore.getState().trackerSettings,
        toggle: { enabled: false },
      },
    });
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);

    useReaderStore.getState().goToPage(5);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      0,
    );
    // lastPosition still tracks current page even when tracker is disabled.
    expect(useReaderStore.getState().documents.get("doc-1")?.lastPosition).toBe(
      5,
    );
  });

  it("manualSetProgress overrides the tracker rules", async () => {
    const { useReaderStore, useSettingsStore } = await loadStores();
    useSettingsStore.setState({
      trackerSettings: {
        ...useSettingsStore.getState().trackerSettings,
        toggle: { enabled: false },
      },
    });
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);

    useReaderStore.getState().manualSetProgress(6);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      6,
    );

    // Manual set can also pull progress backwards.
    useReaderStore.getState().manualSetProgress(2);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      2,
    );
  });

  it("manualSetProgress clamps to [0, totalPages]", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);

    useReaderStore.getState().manualSetProgress(99);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      5,
    );
    useReaderStore.getState().manualSetProgress(-3);
    expect(useReaderStore.getState().documents.get("doc-1")?.progressPage).toBe(
      0,
    );
  });
});

describe("plugin host event emission", () => {
  it("emits reader:page-change on goToPage with the right payload", async () => {
    const { useReaderStore, hostEventBus } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);

    const events: unknown[] = [];
    const off = hostEventBus.on("reader:page-change", (p) => events.push(p));
    useReaderStore.getState().goToPage(4);
    useReaderStore.getState().nextPage();

    expect(events).toEqual([
      { docId: "doc-1", page: 4, from: 1 },
      { docId: "doc-1", page: 5, from: 4 },
    ]);
    off();
  });
});

describe("debounced progress persistence", () => {
  it("schedulePersistProgress debounces and writes after 800ms", async () => {
    vi.useFakeTimers();
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 10 }), FAKE_FILE);
    saveDocumentMetaMock.mockClear();

    useReaderStore.getState().goToPage(2);
    useReaderStore.getState().goToPage(3);
    useReaderStore.getState().goToPage(4);

    // Before debounce flushes, no save.
    expect(saveDocumentMetaMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(900);
    // Resolve the loadDocumentMeta().then(...) chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(saveDocumentMetaMock).toHaveBeenCalledTimes(1);
    expect(saveDocumentMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        lastPosition: 4,
        progressPage: 4,
      }),
    );
  });
});

describe("requestScrollToPage", () => {
  it("sets scrollToPage when the page is in range", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);
    useReaderStore.getState().requestScrollToPage(3);
    expect(useReaderStore.getState().documents.get("doc-1")?.scrollToPage).toBe(
      3,
    );
  });

  it("ignores out-of-range pages", async () => {
    const { useReaderStore } = await loadStores();
    await useReaderStore
      .getState()
      .addDocument(makeAdapter({ totalPages: 5 }), FAKE_FILE);
    useReaderStore.getState().requestScrollToPage(0);
    useReaderStore.getState().requestScrollToPage(99);
    expect(
      useReaderStore.getState().documents.get("doc-1")?.scrollToPage,
    ).toBeNull();
  });
});
