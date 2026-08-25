import { describe, expect, it } from "vitest";
import { resolveAiContext, resolveAiContextBody } from "./resolve";
import type { AiContextPreset } from "./types";

const mk = (id: string, body = `body ${id}`): AiContextPreset => ({
  id,
  name: `Preset ${id}`,
  body,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const state = {
  aiContexts: [mk("def"), mk("book"), mk("folder"), mk("org"), mk("ovr")],
  aiDefaultContextId: "def",
  aiContextBindings: {
    books: { b1: "book", bGone: "missing" },
    folders: { f1: "folder" },
    orgs: { o1: "org" },
  },
};

describe("resolveAiContext", () => {
  it("falls back to the default when nothing is bound", () => {
    expect(resolveAiContext(state)?.source).toBe("default");
    expect(resolveAiContext(state, { bookId: "x", folderId: "y", orgId: "z" })?.preset.id).toBe("def");
  });

  it("book beats folder beats org beats default", () => {
    expect(resolveAiContext(state, { bookId: "b1", folderId: "f1", orgId: "o1" })?.preset.id).toBe("book");
    expect(resolveAiContext(state, { folderId: "f1", orgId: "o1" })?.preset.id).toBe("folder");
    expect(resolveAiContext(state, { orgId: "o1" })?.preset.id).toBe("org");
  });

  it("override beats every binding", () => {
    const r = resolveAiContext(state, { bookId: "b1", overridePresetId: "ovr" });
    expect(r?.preset.id).toBe("ovr");
    expect(r?.source).toBe("override");
  });

  it("skips bindings that point at a deleted preset", () => {
    expect(resolveAiContext(state, { bookId: "bGone", folderId: "f1" })?.preset.id).toBe("folder");
  });

  it("returns null with no default and no bindings", () => {
    expect(resolveAiContext({ ...state, aiDefaultContextId: null })).toBeNull();
    expect(resolveAiContextBody({ ...state, aiDefaultContextId: null })).toBe("");
  });

  it("resolveAiContextBody trims and blanks out empty bodies", () => {
    const s = { ...state, aiContexts: [mk("def", "  hello  ")] };
    expect(resolveAiContextBody(s)).toBe("hello");
    expect(resolveAiContextBody({ ...s, aiContexts: [mk("def", "   ")] })).toBe("");
  });
});
