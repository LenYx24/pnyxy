/**
 * Tests for the pure message-tree and folder-tree helpers the chat store
 * builds on: root->leaf paths, subtree collection for cascading deletes,
 * fork lineage over conversations and the folder cycle guard.
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/types/chat";
import {
  childrenOf,
  conversationLineage,
  countBranches,
  isFolderOrDescendant,
  newestMessage,
  pathFromRoot,
  rootOf,
  subtreeIds,
} from "@/stores/chat/chat-tree";

function msg(
  id: string,
  parent: string | null,
  createdAt = `2026-01-01T00:00:0${id.length}Z`,
): ChatMessage {
  return {
    id,
    conversation_id: "conv",
    parent_message_id: parent,
    role: id.startsWith("u") ? "user" : "assistant",
    content: id,
    attachments: null,
    created_at: createdAt,
  } as ChatMessage;
}

/**
 * u1 -> a1 -> u2 -> a2
 *          \-> u2b -> a2b
 */
function tree(): Map<string, ChatMessage> {
  const list = [
    msg("u1", null, "2026-01-01T00:00:01Z"),
    msg("a1", "u1", "2026-01-01T00:00:02Z"),
    msg("u2", "a1", "2026-01-01T00:00:03Z"),
    msg("a2", "u2", "2026-01-01T00:00:04Z"),
    msg("u2b", "a1", "2026-01-01T00:00:05Z"),
    msg("a2b", "u2b", "2026-01-01T00:00:06Z"),
  ];
  return new Map(list.map((m) => [m.id, m]));
}

describe("pathFromRoot", () => {
  it("returns the root->leaf chain", () => {
    expect(pathFromRoot(tree(), "a2b").map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2b",
      "a2b",
    ]);
  });

  it("is empty for a null or unknown leaf", () => {
    expect(pathFromRoot(tree(), null)).toEqual([]);
    expect(pathFromRoot(tree(), "nope")).toEqual([]);
  });

  it("stops at a dangling parent reference", () => {
    const m = tree();
    m.delete("a1");
    expect(pathFromRoot(m, "a2").map((x) => x.id)).toEqual(["u2", "a2"]);
  });
});

describe("rootOf", () => {
  it("finds the root from any node", () => {
    expect(rootOf(tree(), "a2")?.id).toBe("u1");
    expect(rootOf(tree(), "u1")?.id).toBe("u1");
    expect(rootOf(tree(), null)).toBeNull();
  });
});

describe("subtreeIds", () => {
  it("includes the node and every descendant", () => {
    expect(subtreeIds(tree(), "a1").sort()).toEqual(
      ["a1", "a2", "a2b", "u2", "u2b"].sort(),
    );
  });

  it("returns just the leaf for a leaf", () => {
    expect(subtreeIds(tree(), "a2")).toEqual(["a2"]);
  });
});

describe("branch helpers", () => {
  it("counts and lists direct children oldest first", () => {
    expect(countBranches(tree(), "a1")).toBe(2);
    expect(countBranches(tree(), "a2")).toBe(0);
    expect(childrenOf(tree(), "a1").map((m) => m.id)).toEqual(["u2", "u2b"]);
  });

  it("picks the newest message by created_at", () => {
    expect(newestMessage(tree())?.id).toBe("a2b");
    expect(newestMessage(new Map())).toBeNull();
  });
});

describe("conversationLineage", () => {
  const convs = [
    { id: "root", parent_conversation_id: null },
    { id: "fork1", parent_conversation_id: "root" },
    { id: "fork2", parent_conversation_id: "fork1" },
    { id: "orphan", parent_conversation_id: "missing" },
  ];

  it("walks fork lineage root first", () => {
    expect(conversationLineage(convs, "fork2").map((c) => c.id)).toEqual([
      "root",
      "fork1",
      "fork2",
    ]);
  });

  it("stops at an unknown parent", () => {
    expect(conversationLineage(convs, "orphan").map((c) => c.id)).toEqual([
      "orphan",
    ]);
  });

  it("survives a cycle", () => {
    const cyclic = [
      { id: "a", parent_conversation_id: "b" },
      { id: "b", parent_conversation_id: "a" },
    ];
    expect(conversationLineage(cyclic, "a").map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("isFolderOrDescendant", () => {
  const folders = [
    { id: "top", parent_id: null },
    { id: "mid", parent_id: "top" },
    { id: "leaf", parent_id: "mid" },
    { id: "other", parent_id: null },
  ];

  it("detects self and descendants", () => {
    expect(isFolderOrDescendant(folders, "top", "top")).toBe(true);
    expect(isFolderOrDescendant(folders, "top", "leaf")).toBe(true);
    expect(isFolderOrDescendant(folders, "mid", "leaf")).toBe(true);
  });

  it("rejects ancestors, siblings and null", () => {
    expect(isFolderOrDescendant(folders, "leaf", "top")).toBe(false);
    expect(isFolderOrDescendant(folders, "top", "other")).toBe(false);
    expect(isFolderOrDescendant(folders, "top", null)).toBe(false);
  });
});
