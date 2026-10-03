import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt, INLINE_QUIZ_SPEC } from "./chat-prompts";

describe("buildChatSystemPrompt", () => {
  it("gives the reader the tutor voice and the deep-link citation format", () => {
    const p = buildChatSystemPrompt({
      documentTitle: "BSz1 jegyzet",
      pageContext: "[p.22] 1.5.7. Tétel (Euler-Fermat)",
    });
    expect(p).toContain("You are Pnyxy's AI tutor");
    expect(p).toContain('"BSz1 jegyzet"');
    expect(p).toContain("[p.N]");
    expect(p).toContain(INLINE_QUIZ_SPEC);
  });

  it("puts the per-turn context after the stable part", () => {
    const p = buildChatSystemPrompt({
      documentTitle: "Doc",
      pageContext: "PAGE TEXT",
      persona: "PERSONA",
      extraBlocks: ["EXTRA"],
    });
    expect(p.indexOf("EXTRA")).toBeLessThan(p.indexOf("PERSONA"));
    expect(p.indexOf("PERSONA")).toBeLessThan(p.indexOf("PAGE TEXT"));
    expect(p.trimEnd().endsWith("---")).toBe(true);
  });

  it("frames image-only document turns without an empty excerpt block", () => {
    const p = buildChatSystemPrompt({
      documentTitle: "Scan",
      pageContext: "",
      hasImages: true,
    });
    expect(p).toContain("attached as images");
    expect(p).not.toContain("No excerpts are attached");
  });

  it("keeps standalone chat free of document rules", () => {
    const p = buildChatSystemPrompt({ documentTitle: "", pageContext: "" });
    expect(p).toContain("AI chat assistant");
    expect(p).not.toContain("When you reference the document");
  });
});
