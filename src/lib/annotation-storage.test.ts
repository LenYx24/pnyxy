/**
 * Annotation-storage tests. Drives the real `idb` library against
 * `fake-indexeddb` (installed in src/test/setup.ts), so we exercise
 * the actual upgrade/index paths the app uses.
 *
 * Each test resets the IndexedDB factory to start with a fresh DB —
 * otherwise data accumulates across tests and breaks the assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { Comment, Highlight } from "@/types/annotation";

// Module-under-test is imported dynamically so each test gets a fresh
// `dbPromise` cache after we reset the IDB factory.
async function loadModule() {
  return await import("./annotation-storage");
}

beforeEach(() => {
  // New, isolated database per test.
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DOC_A = "doc-a";
const DOC_B = "doc-b";

function makeHighlight(
  id: string,
  documentId: string,
  overrides: Partial<Highlight> = {},
): Highlight {
  return {
    id,
    documentId,
    color: "yellow",
    selection: { text: "x", rects: [] },
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeComment(
  id: string,
  documentId: string,
  overrides: Partial<Comment> = {},
): Comment {
  return {
    id,
    documentId,
    selection: { text: "x", rects: [] },
    messages: [],
    resolved: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("getDB", () => {
  it("opens the database and creates the expected object stores", async () => {
    const { getDB } = await loadModule();
    const db = await getDB();
    expect(db.name).toBe("pnyxy-annotations");
    expect(db.version).toBe(6);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [
        "bookmarks",
        "comments",
        "documentMeta",
        "highlights",
        "notes",
        "vocab",
        "whiteboards",
      ].sort(),
    );
  });

  it("returns the same promise on repeat calls (singleton)", async () => {
    const mod = await loadModule();
    const a = mod.getDB();
    const b = mod.getDB();
    expect(a).toBe(b);
    await a;
  });
});

describe("highlights", () => {
  it("returns an empty array when no highlights exist for a doc", async () => {
    const { loadHighlights } = await loadModule();
    expect(await loadHighlights(DOC_A)).toEqual([]);
  });

  it("saves a highlight and returns it on load by document id", async () => {
    const { saveHighlight, loadHighlights } = await loadModule();
    const h = makeHighlight("h1", DOC_A);
    await saveHighlight(h);
    const out = await loadHighlights(DOC_A);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("h1");
  });

  it("scopes highlights by documentId via the index", async () => {
    const { saveHighlight, loadHighlights } = await loadModule();
    await saveHighlight(makeHighlight("h1", DOC_A));
    await saveHighlight(makeHighlight("h2", DOC_A));
    await saveHighlight(makeHighlight("h3", DOC_B));

    const a = await loadHighlights(DOC_A);
    const b = await loadHighlights(DOC_B);
    expect(a.map((h) => h.id).sort()).toEqual(["h1", "h2"]);
    expect(b.map((h) => h.id)).toEqual(["h3"]);
  });

  it("saveHighlight overwrites a highlight with the same id", async () => {
    const { saveHighlight, loadHighlights } = await loadModule();
    await saveHighlight(makeHighlight("h1", DOC_A, { color: "yellow" }));
    await saveHighlight(makeHighlight("h1", DOC_A, { color: "green" }));
    const out = await loadHighlights(DOC_A);
    expect(out).toHaveLength(1);
    expect(out[0]?.color).toBe("green");
  });

  it("deleteHighlight removes only the targeted highlight", async () => {
    const { saveHighlight, deleteHighlight, loadHighlights } =
      await loadModule();
    await saveHighlight(makeHighlight("h1", DOC_A));
    await saveHighlight(makeHighlight("h2", DOC_A));
    await deleteHighlight("h1");
    const out = await loadHighlights(DOC_A);
    expect(out.map((h) => h.id)).toEqual(["h2"]);
  });

  it("deleteHighlight is a no-op for a non-existent id", async () => {
    const { saveHighlight, deleteHighlight, loadHighlights } =
      await loadModule();
    await saveHighlight(makeHighlight("h1", DOC_A));
    await expect(deleteHighlight("nope")).resolves.toBeUndefined();
    expect((await loadHighlights(DOC_A)).map((h) => h.id)).toEqual(["h1"]);
  });
});

describe("comments", () => {
  it("returns an empty array when no comments exist for a doc", async () => {
    const { loadComments } = await loadModule();
    expect(await loadComments(DOC_A)).toEqual([]);
  });

  it("saves and loads comments by document id", async () => {
    const { saveComment, loadComments } = await loadModule();
    await saveComment(makeComment("c1", DOC_A));
    await saveComment(makeComment("c2", DOC_B));
    expect((await loadComments(DOC_A)).map((c) => c.id)).toEqual(["c1"]);
    expect((await loadComments(DOC_B)).map((c) => c.id)).toEqual(["c2"]);
  });

  it("deleteComment removes only the targeted comment", async () => {
    const { saveComment, deleteComment, loadComments } = await loadModule();
    await saveComment(makeComment("c1", DOC_A));
    await saveComment(makeComment("c2", DOC_A));
    await deleteComment("c2");
    expect((await loadComments(DOC_A)).map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("documentMeta", () => {
  it("returns undefined when no meta exists", async () => {
    const { loadDocumentMeta } = await loadModule();
    expect(await loadDocumentMeta("missing")).toBeUndefined();
  });

  it("saves and loads a meta record by documentId", async () => {
    const { saveDocumentMeta, loadDocumentMeta } = await loadModule();
    await saveDocumentMeta({
      documentId: DOC_A,
      customTitle: "My Title",
      progressPage: 12,
      lastPosition: 42,
      tocWidth: 280,
      zoomMode: "fit-page",
    });
    const meta = await loadDocumentMeta(DOC_A);
    expect(meta).toMatchObject({
      documentId: DOC_A,
      customTitle: "My Title",
      progressPage: 12,
      lastPosition: 42,
      tocWidth: 280,
      zoomMode: "fit-page",
    });
  });

  it("saveDocumentMeta replaces the previous record (keyPath: documentId)", async () => {
    const { saveDocumentMeta, loadDocumentMeta } = await loadModule();
    await saveDocumentMeta({ documentId: DOC_A, customTitle: "A" });
    await saveDocumentMeta({ documentId: DOC_A, customTitle: "B" });
    const out = await loadDocumentMeta(DOC_A);
    expect(out?.customTitle).toBe("B");
  });
});

describe("tocWidth helpers", () => {
  it("loadTocWidth returns undefined when no meta exists", async () => {
    const { loadTocWidth } = await loadModule();
    expect(await loadTocWidth(DOC_A)).toBeUndefined();
  });

  it("saveTocWidth persists the width and merges with existing meta", async () => {
    const { saveTocWidth, loadTocWidth, saveDocumentMeta, loadDocumentMeta } =
      await loadModule();

    await saveDocumentMeta({
      documentId: DOC_A,
      customTitle: "Keep me",
      progressPage: 7,
    });
    await saveTocWidth(DOC_A, 320);

    expect(await loadTocWidth(DOC_A)).toBe(320);
    const meta = await loadDocumentMeta(DOC_A);
    expect(meta?.customTitle).toBe("Keep me");
    expect(meta?.progressPage).toBe(7);
  });

  it("saveTocWidth creates a new meta record when none exists", async () => {
    const { saveTocWidth, loadDocumentMeta } = await loadModule();
    await saveTocWidth(DOC_B, 200);
    const meta = await loadDocumentMeta(DOC_B);
    expect(meta).toEqual({ documentId: DOC_B, tocWidth: 200 });
  });
});

describe("notes", () => {
  it("loadAllNotes returns [] when nothing has been saved", async () => {
    const { loadAllNotes } = await loadModule();
    expect(await loadAllNotes()).toEqual([]);
  });

  it("saves, loads, and deletes notes by id", async () => {
    const { saveNote, loadNote, loadAllNotes, deleteNote } = await loadModule();
    const now = Date.now();
    await saveNote({
      id: "n1",
      title: "First",
      content: "hello",
      createdAt: now,
      updatedAt: now,
    });
    await saveNote({
      id: "n2",
      title: "Second",
      content: "world",
      createdAt: now,
      updatedAt: now,
    });

    expect((await loadAllNotes()).map((n) => n.id).sort()).toEqual([
      "n1",
      "n2",
    ]);
    expect((await loadNote("n1"))?.title).toBe("First");

    await deleteNote("n1");
    expect(await loadNote("n1")).toBeUndefined();
    expect((await loadAllNotes()).map((n) => n.id)).toEqual(["n2"]);
  });

  it("saveNote overwrites a note with the same id", async () => {
    const { saveNote, loadNote } = await loadModule();
    await saveNote({
      id: "n1",
      title: "v1",
      content: "a",
      createdAt: 0,
      updatedAt: 0,
    });
    await saveNote({
      id: "n1",
      title: "v2",
      content: "b",
      createdAt: 0,
      updatedAt: 1,
    });
    const note = await loadNote("n1");
    expect(note?.title).toBe("v2");
    expect(note?.content).toBe("b");
    expect(note?.updatedAt).toBe(1);
  });
});

describe("bookmarks", () => {
  it("returns an empty array when no bookmarks exist for a doc", async () => {
    const { loadBookmarks } = await loadModule();
    expect(await loadBookmarks(DOC_A)).toEqual([]);
  });

  it("scopes bookmarks by documentId via the index", async () => {
    const { saveBookmark, loadBookmarks } = await loadModule();
    const now = Date.now();
    await saveBookmark({
      id: "b1",
      documentId: DOC_A,
      page: 3,
      label: "Intro",
      color: "#facc15",
      createdAt: now,
    });
    await saveBookmark({
      id: "b2",
      documentId: DOC_A,
      page: 42,
      label: "",
      color: "#4ade80",
      createdAt: now + 1,
    });
    await saveBookmark({
      id: "b3",
      documentId: DOC_B,
      page: 7,
      label: "",
      color: "#60a5fa",
      createdAt: now + 2,
    });

    const a = await loadBookmarks(DOC_A);
    const b = await loadBookmarks(DOC_B);
    expect(a.map((bm) => bm.id).sort()).toEqual(["b1", "b2"]);
    expect(b.map((bm) => bm.id)).toEqual(["b3"]);
  });

  it("saveBookmark overwrites a bookmark with the same id", async () => {
    const { saveBookmark, loadBookmarks } = await loadModule();
    await saveBookmark({
      id: "b1",
      documentId: DOC_A,
      page: 3,
      label: "old",
      color: "#facc15",
      createdAt: 0,
    });
    await saveBookmark({
      id: "b1",
      documentId: DOC_A,
      page: 3,
      label: "new",
      color: "#f472b6",
      createdAt: 0,
    });
    const out = await loadBookmarks(DOC_A);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("new");
    expect(out[0]?.color).toBe("#f472b6");
  });

  it("deleteBookmark removes only the targeted bookmark", async () => {
    const { saveBookmark, deleteBookmark, loadBookmarks } = await loadModule();
    await saveBookmark({
      id: "b1",
      documentId: DOC_A,
      page: 1,
      label: "",
      color: "#facc15",
      createdAt: 0,
    });
    await saveBookmark({
      id: "b2",
      documentId: DOC_A,
      page: 2,
      label: "",
      color: "#4ade80",
      createdAt: 0,
    });
    await deleteBookmark("b1");
    const out = await loadBookmarks(DOC_A);
    expect(out.map((bm) => bm.id)).toEqual(["b2"]);
  });
});
