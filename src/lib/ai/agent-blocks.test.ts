import { describe, expect, it } from "vitest";
import {
  extractAgentBlocks,
  isHandoff,
  isHandoffPrefix,
  markStepUndone,
  replaceOffer,
  serializeFolder,
  serializeOffer,
  serializeStep,
} from "./agent-blocks";

const content = [
  serializeStep({ op: "create_folder", ok: true, refs: [{ k: "folder", id: "f1", label: "Games / WarEra" }], undo: { op: "delete_folder", id: "f1" } }),
  serializeStep({ op: "move_item", ok: true }),
  "Set up. Start with the note.",
  serializeFolder("f1"),
  serializeOffer({ kind: "whiteboard", title: "Chain", folderId: "f1" }),
].join("\n\n");

describe("agent blocks", () => {
  it("pulls steps, folders and offers out of the prose", () => {
    const r = extractAgentBlocks(content);
    expect(r.cleaned).toBe("Set up. Start with the note.");
    expect(r.steps.map((s) => s.op)).toEqual(["create_folder", "move_item"]);
    expect(r.folderIds).toEqual(["f1"]);
    expect(r.offers[0].title).toBe("Chain");
  });

  it("leaves ordinary messages untouched", () => {
    const r = extractAgentBlocks("Hello\n\n```js\nx\n```");
    expect(r.hasAgentBlocks).toBe(false);
    expect(r.cleaned).toBe("Hello\n\n```js\nx\n```");
  });

  it("writes a created id and an undone flag back in place", () => {
    const withId = replaceOffer(content, 0, { kind: "whiteboard", title: "Chain", folderId: "f1", createdId: "w1" });
    expect(extractAgentBlocks(withId).offers[0].createdId).toBe("w1");
    const undone = markStepUndone(content, 0);
    const steps = extractAgentBlocks(undone).steps;
    expect(steps[0].undone).toBe(true);
    expect(steps[1].undone).toBeUndefined();
  });

  it("recognises the hand-off block while it streams", () => {
    expect(isHandoffPrefix("``")).toBe(true);
    expect(isHandoffPrefix("```pnyxy-ag")).toBe(true);
    expect(isHandoffPrefix("```python")).toBe(false);
    expect(isHandoffPrefix("Szia")).toBe(false);
    expect(isHandoff("```pnyxy-agent\n{}\n```")).toBe(true);
  });
});
