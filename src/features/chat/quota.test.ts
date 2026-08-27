import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_TOKENS,
  isRowExhausted,
  nextUtcMidnight,
  predictBilledModel,
  questionsLeft,
  selectQuotaRow,
  usageRatio,
  type PnyxyQuotaRow,
} from "./quota";

function row(
  model: string,
  partial: Partial<Omit<PnyxyQuotaRow, "model">> = {},
): PnyxyQuotaRow {
  return {
    model,
    tokens_used: 0,
    request_count: 0,
    tokens_limit: 300_000,
    request_limit: 1500,
    ...partial,
  };
}

describe("predictBilledModel", () => {
  it("pins win over the auto route", () => {
    expect(predictBilledModel("gpt-4o-mini")).toBe("gpt-4o-mini");
  });
  it("the quality-first auto route bills 3.7 Flash by default", () => {
    expect(predictBilledModel(null)).toBe("gemini-3.7-flash");
  });
});

describe("questionsLeft", () => {
  it("is 0 for a missing row (no NaN)", () => {
    expect(questionsLeft(null)).toBe(0);
    expect(questionsLeft(undefined)).toBe(0);
  });
  it("uses the request cap when tokens are plentiful", () => {
    // 20 tiny turns (100 tokens each): 298k tokens buy ~2980 more, so
    // the 1480 remaining requests are the tighter bound
    const r = row("m", { request_count: 20, tokens_used: 20 * 100 });
    expect(questionsLeft(r)).toBe(1480);
  });
  it("binds on tokens when the token bucket runs out first", () => {
    // 10 turns cost 25k each: 250k of 300k used, 50k left = 2 more turns,
    // even though 1490 requests remain
    const r = row("m", { request_count: 10, tokens_used: 250_000 });
    expect(questionsLeft(r)).toBe(2);
  });
  it("is 0 once tokens are exhausted regardless of requests", () => {
    const r = row("m", { request_count: 3, tokens_used: 300_000 });
    expect(questionsLeft(r)).toBe(0);
  });
  it("falls back to the default turn size before the first turn", () => {
    const r = row("m", { tokens_limit: 10_000, request_limit: 100 });
    expect(questionsLeft(r)).toBe(Math.floor(10_000 / DEFAULT_TURN_TOKENS));
  });
  it("never goes negative", () => {
    const r = row("m", { request_count: 2000, tokens_used: 1 });
    expect(questionsLeft(r)).toBe(0);
  });
  it("ignores a zero token limit instead of dividing by it", () => {
    const r = row("m", { tokens_limit: 0, request_count: 5, request_limit: 10 });
    expect(questionsLeft(r)).toBe(5);
  });
});

describe("usageRatio", () => {
  it("is 0 for missing rows and zero limits", () => {
    expect(usageRatio(null)).toBe(0);
    expect(usageRatio(row("m", { tokens_limit: 0, request_limit: 0, tokens_used: 5 }))).toBe(0);
  });
  it("takes the higher of tokens vs requests and clamps at 1", () => {
    expect(usageRatio(row("m", { tokens_used: 150_000, request_count: 15 }))).toBe(0.5);
    expect(usageRatio(row("m", { tokens_used: 10, request_count: 1500 }))).toBe(1);
    expect(usageRatio(row("m", { tokens_used: 900_000 }))).toBe(1);
  });
});

describe("isRowExhausted", () => {
  it("is true when either bucket hits its cap", () => {
    expect(isRowExhausted(row("m"))).toBe(false);
    expect(isRowExhausted(row("m", { tokens_used: 300_000 }))).toBe(true);
    expect(isRowExhausted(row("m", { request_count: 1500 }))).toBe(true);
  });
});

describe("selectQuotaRow", () => {
  const rows = [
    row("gemini-3.5-flash-lite"),
    row("gemini-3.6-flash", { tokens_limit: 200_000, request_limit: 1000 }),
    row("gemini-3.7-flash", { tokens_limit: 100_000, request_limit: 500 }),
    row("gpt-4o-mini", { tokens_limit: 50_000, request_limit: 200 }),
    row("claude-haiku-4-5", { tokens_limit: 50_000, request_limit: 200 }),
  ];

  it("shows the predicted model's row on the auto route", () => {
    const s = selectQuotaRow(rows, { pinnedModel: null });
    expect(s.model).toBe("gemini-3.7-flash");
    expect(s.row?.model).toBe("gemini-3.7-flash");
    expect(s.fellThrough).toBe(false);
  });

  it("shows the pinned model's row and never falls through", () => {
    const exhausted = rows.map((r) =>
      r.model === "gpt-4o-mini" ? { ...r, request_count: 200 } : r,
    );
    const s = selectQuotaRow(exhausted, { pinnedModel: "gpt-4o-mini" });
    expect(s.model).toBe("gpt-4o-mini");
    expect(s.fellThrough).toBe(false);
    expect(questionsLeft(s.row)).toBe(0);
  });

  it("follows the proxy chain when the predicted bucket is exhausted", () => {
    const exhausted = rows.map((r) =>
      r.model === "gemini-3.7-flash" ? { ...r, request_count: 1_000_000 } : r,
    );
    const s = selectQuotaRow(exhausted, { pinnedModel: null });
    expect(s.model).toBe("gemini-3.6-flash");
    expect(s.fellThrough).toBe(true);
  });

  it("falls through from 3.7 to the next tier down the chain", () => {
    const exhausted = rows.map((r) =>
      r.model === "gemini-3.7-flash" ? { ...r, request_count: 500 } : r,
    );
    const s = selectQuotaRow(exhausted, { pinnedModel: null });
    expect(s.model).toBe("gemini-3.6-flash");
    expect(s.fellThrough).toBe(true);
  });

  it("returns a null row (not a crash) when the RPC returned nothing", () => {
    const s = selectQuotaRow([], { pinnedModel: null });
    expect(s.row).toBeNull();
    expect(questionsLeft(s.row)).toBe(0);
  });
});

describe("nextUtcMidnight", () => {
  it("returns the next 00:00 UTC, not local midnight", () => {
    const at = new Date(Date.UTC(2026, 7, 25, 21, 30));
    const reset = nextUtcMidnight(at);
    expect(reset.toISOString()).toBe("2026-08-26T00:00:00.000Z");
  });
  it("rolls the month over", () => {
    const at = new Date(Date.UTC(2026, 7, 31, 1, 0));
    expect(nextUtcMidnight(at).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
