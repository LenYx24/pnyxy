import { describe, expect, it } from "vitest";
import { extractInlineSim } from "./extract-sim";

describe("extractInlineSim", () => {
  it("lifts the document out of the prose", () => {
    const r = extractInlineSim(
      "Here you go:\n```pnyxy-sim\n<!doctype html><title>B-tree</title><canvas></canvas><script>1</script>\n```\nTry inserting keys.",
    );
    expect(r.sim?.title).toBe("B-tree");
    expect(r.sim?.html).toContain("<canvas>");
    expect(r.cleaned).toBe("Here you go:\n\nTry inserting keys.");
  });

  it("hides a fence that is still streaming", () => {
    const r = extractInlineSim("Building it\n```pnyxy-sim\n<!doctype html><scr");
    expect(r.pending).toBe(true);
    expect(r.cleaned).toBe("Building it");
  });

  it("ignores a block with nothing runnable in it", () => {
    const r = extractInlineSim("```pnyxy-sim\njust text\n```");
    expect(r.sim).toBeUndefined();
  });
});
