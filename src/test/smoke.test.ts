import { describe, it, expect } from "vitest";

describe("test infra smoke", () => {
  it("can run a vitest test", () => {
    expect(1 + 1).toBe(2);
  });

  it("provides a happy-dom window", () => {
    expect(typeof document).toBe("object");
    expect(typeof localStorage).toBe("object");
  });
});
