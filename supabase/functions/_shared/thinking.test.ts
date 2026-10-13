import { describe, expect, it } from "vitest";
import { wantsDeepThinking } from "./thinking.ts";

describe("wantsDeepThinking", () => {
  it("keeps small talk and simple facts quick", () => {
    expect(wantsDeepThinking("Szia, mi a helyzet?")).toBe(false);
    expect(wantsDeepThinking("Who wrote Hamlet?")).toBe(false);
  });

  it("thinks deeper on maths, optimisation and code", () => {
    expect(wantsDeepThinking("Számold ki az optimális gyártást")).toBe(true);
    expect(wantsDeepThinking("Prove that sqrt(2) is irrational")).toBe(true);
    expect(wantsDeepThinking("mennyi 12 * 34?")).toBe(true);
    expect(wantsDeepThinking("```py\nprint(1)\n```")).toBe(true);
  });

  it("thinks deeper on long multi-part requests", () => {
    expect(wantsDeepThinking("a".repeat(700))).toBe(true);
  });
});
