import { describe, expect, it } from "vitest";
import { extractInlineGraph, graphToFence } from "./extract-graph";

describe("extractInlineGraph", () => {
  it("parses a closed fence and strips it from the prose", () => {
    const res = extractInlineGraph(
      'Here:\n```graph\n{"title":"T","directed":false,"nodes":[{"id":"a","label":"A"},{"id":"b"}],"edges":[{"from":"a","to":"b","label":"2"},{"from":"a","to":"zzz"}]}\n```\nDone.',
    );
    expect(res.cleaned).toBe("Here:\n\nDone.");
    expect(res.graph?.title).toBe("T");
    expect(res.graph?.directed).toBe(false);
    expect(res.graph?.nodes).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "b" },
    ]);
    // edge to an unknown node is dropped
    expect(res.graph?.edges).toEqual([{ from: "a", to: "b", label: "2" }]);
  });
  it("reports an open fence as pending and hides it", () => {
    const res = extractInlineGraph('Intro\n```graph\n{"nodes":[');
    expect(res.pending).toBe(true);
    expect(res.cleaned).toBe("Intro");
  });
  it("drops malformed JSON but keeps the prose", () => {
    const res = extractInlineGraph("a\n```graph\n{oops}\n```\nb");
    expect(res.graph).toBeUndefined();
    expect(res.cleaned).toBe("a\n\nb");
  });
  it("round-trips through graphToFence", () => {
    const g = { title: null, directed: true, nodes: [{ id: "x", label: "X" }], edges: [] };
    expect(extractInlineGraph(graphToFence(g)).graph).toEqual(g);
  });
});
