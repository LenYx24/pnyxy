import { describe, it, expect } from "vitest";
import { detectRoadmapIntent } from "./roadmap-tools";

// The detector gates an expensive escalation: a positive routes the
// chat turn through the Anthropic tool-use path instead of the cheap
// auto-route. So we care about BOTH directions — it must fire on real
// "build me a roadmap" asks (HU + EN) and must NOT fire on ordinary
// chat that merely mentions a roadmap or asks to generate something
// else.
describe("detectRoadmapIntent", () => {
  it("fires on explicit generate-a-roadmap requests (HU)", () => {
    expect(detectRoadmapIntent("Generálj egy roadmapet a React tanulásához")).toBe(true);
    expect(detectRoadmapIntent("készíts nekem egy tanulási tervet a matekhoz")).toBe(true);
    expect(detectRoadmapIntent("csinálj egy útitervet a gitár tanuláshoz")).toBe(true);
  });

  it("fires on explicit generate-a-roadmap requests (EN)", () => {
    expect(detectRoadmapIntent("create a roadmap for learning Rust")).toBe(true);
    expect(detectRoadmapIntent("Can you build a learning path for data science?")).toBe(true);
    expect(detectRoadmapIntent("generate a study plan for the GRE")).toBe(true);
  });

  it("stays off when only the noun is present (no build verb)", () => {
    expect(detectRoadmapIntent("what's next on my roadmap?")).toBe(false);
    expect(detectRoadmapIntent("hol tartok a tanulási tervemben?")).toBe(false);
  });

  it("stays off when the build verb targets something else", () => {
    expect(detectRoadmapIntent("generate a quiz about photosynthesis")).toBe(false);
    expect(detectRoadmapIntent("készíts egy összefoglalót erről a fejezetről")).toBe(false);
    expect(detectRoadmapIntent("write me a poem about the sea")).toBe(false);
  });

  it("handles empty / whitespace input", () => {
    expect(detectRoadmapIntent("")).toBe(false);
    expect(detectRoadmapIntent("   ")).toBe(false);
  });
});
