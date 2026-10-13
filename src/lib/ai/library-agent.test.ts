import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractAgentBlocks } from "./agent-blocks";

type Event =
  | { kind: "text_delta"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "stop"; reason: "tool_use" | "end_turn" };

const rounds: Event[][] = [];

vi.mock("@/lib/ai/ai-client", () => ({
  streamChatWithTools: async function* () {
    for (const e of rounds.shift() ?? []) yield e;
  },
}));

const dispatch = vi.fn();
vi.mock("@/lib/ai/library-tools", () => ({
  LIBRARY_TOOLS: [],
  buildLibraryAgentSystemPrompt: () => "system",
  dispatchLibraryTool: (...args: unknown[]) => dispatch(...args),
}));

vi.mock("@/lib/use-features", () => ({
  getFeatures: () => ({ whiteboard: true, notes: true }),
}));
vi.mock("@/stores/note-store", () => ({
  useNoteStore: { getState: () => ({ notes: [{}] }) },
}));
vi.mock("@/stores/resource-store", () => ({
  useResourceStore: { getState: () => ({ resources: [{}] }) },
}));
vi.mock("@/stores/library-store", () => ({
  useLibraryStore: {
    getState: () => ({ fetchFolders: async () => {}, fetchLibrary: async () => {} }),
  },
}));

const { runLibraryAgenticLoop } = await import("./library-agent");

describe("runLibraryAgenticLoop", () => {
  beforeEach(() => {
    rounds.length = 0;
    dispatch.mockReset();
  });

  it("composes the log, the prose and the cards", async () => {
    rounds.push(
      [
        { kind: "tool_call", id: "1", name: "create_folder", input: { path: "Games/WarEra" } },
        { kind: "tool_call", id: "2", name: "offer_whiteboard", input: { path: "Games/WarEra", title: "Chain" } },
        { kind: "stop", reason: "tool_use" },
      ],
      [
        { kind: "text_delta", text: "Ready, start with the board." },
        { kind: "stop", reason: "end_turn" },
      ],
    );
    dispatch
      .mockResolvedValueOnce({
        ok: true,
        summary: "",
        modelOutput: "ok",
        refs: [{ k: "folder", id: "f1", label: "Games / WarEra" }],
        undo: { op: "delete_folder", id: "f1" },
        touchedFolderId: "f1",
      })
      .mockResolvedValueOnce({
        ok: true,
        summary: "",
        modelOutput: "ok",
        offer: { kind: "whiteboard", title: "Chain", folderId: "f1" },
      });
    const patches: string[] = [];
    const out = await runLibraryAgenticLoop(
      [{ role: "user", content: "set it up" }],
      undefined,
      (c) => patches.push(c),
      new AbortController().signal,
      undefined,
      "conv-1",
    );

    const blocks = extractAgentBlocks(out);
    expect(blocks.steps.map((s) => [s.op, s.ok, s.run])).toEqual([
      ["create_folder", true, undefined],
      ["offer_whiteboard", true, undefined],
    ]);
    expect(blocks.steps[0].undo).toEqual({ op: "delete_folder", id: "f1" });
    expect(blocks.cleaned).toBe("Ready, start with the board.");
    expect(blocks.folderIds).toEqual(["f1"]);
    expect(blocks.offers).toHaveLength(1);
    // the running step was visible before its result came back
    expect(extractAgentBlocks(patches[0]).steps[0].run).toBe(true);
    // the conversation id reaches the tools so "this chat" can be filed
    expect(dispatch.mock.calls[0][2].conversationId).toBe("conv-1");
  });
});
