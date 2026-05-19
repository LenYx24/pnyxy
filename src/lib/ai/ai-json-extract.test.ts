import { afterEach, describe, expect, it, vi } from "vitest";
import { aiJsonExtract } from "./ai-json-extract";

// Mock streamChatResponse so the pipeline can be tested deterministically
// without going through real provider routing / network.
vi.mock("@/lib/ai/ai-client", () => {
  return {
    streamChatResponse: vi.fn(),
  };
});

async function setStreamResponse(text: string): Promise<void> {
  // The vi.mock above replaces the entire module so the export is
  // actually a Mock at runtime; the cast tells TypeScript the same.
  // We go via `unknown` because the real `streamChatResponse` has
  // an AsyncGenerator return type that doesn't overlap with `Mock`.
  const mod = (await import("@/lib/ai/ai-client")) as unknown as {
    streamChatResponse: ReturnType<typeof vi.fn>;
  };
  mod.streamChatResponse.mockImplementation(async function* () {
    // Emit the response in two chunks so the buffer-concat path is
    // covered (the wrapper joins chunk.delta across the stream).
    const mid = Math.floor(text.length / 2);
    yield { delta: text.slice(0, mid) };
    yield { delta: text.slice(mid) };
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("aiJsonExtract", () => {
  it("returns an empty array when the passage is below minPassageLength", async () => {
    await setStreamResponse('{"items":[{"x":1}]}'); // would parse fine
    const result = await aiJsonExtract<number>({
      passage: "abc", // 3 chars — below the 40 default
      systemPrompt: "ignored",
      errorLabel: "test",
      pickArray: (p) => (p as { items: unknown[] }).items,
      coerce: () => 1,
    });
    // Empty array means the wrapper short-circuited BEFORE invoking
    // the stream — important because real callers won't pay tokens
    // for trivially-short input.
    expect(result).toEqual([]);
  });

  it("respects a custom minPassageLength", async () => {
    await setStreamResponse('{"items":[1]}');
    const short = await aiJsonExtract<number>({
      passage: "abc",
      systemPrompt: "x",
      minPassageLength: 2,
      errorLabel: "test",
      pickArray: (p) => (p as { items: unknown[] }).items,
      coerce: (v) => (typeof v === "number" ? v : null),
    });
    expect(short).toEqual([1]);
  });

  it("strips a ```json fence around the response", async () => {
    await setStreamResponse(
      '```json\n{"items":[{"v":42}]}\n```',
    );
    const result = await aiJsonExtract<number>({
      passage: "x".repeat(50),
      systemPrompt: "x",
      errorLabel: "test",
      pickArray: (p) => (p as { items: unknown[] }).items,
      coerce: (raw) => {
        const v = (raw as { v?: unknown }).v;
        return typeof v === "number" ? v : null;
      },
    });
    expect(result).toEqual([42]);
  });

  it("throws `<label>:parse-failed` on invalid JSON", async () => {
    await setStreamResponse("not json {{{");
    await expect(
      aiJsonExtract({
        passage: "x".repeat(50),
        systemPrompt: "x",
        errorLabel: "myext",
        pickArray: (p) => (p as { items: unknown[] }).items,
        coerce: () => null,
      }),
    ).rejects.toThrow("myext:parse-failed");
  });

  it("throws `<label>:bad-shape` when pickArray throws", async () => {
    await setStreamResponse('{"wrong":"shape"}');
    await expect(
      aiJsonExtract({
        passage: "x".repeat(50),
        systemPrompt: "x",
        errorLabel: "myext",
        pickArray: (p) => {
          // Caller signals "I can't find the array" by throwing —
          // the wrapper turns that into the standard label.
          if (!p || typeof p !== "object") throw new Error();
          const items = (p as { items?: unknown }).items;
          if (!items) throw new Error();
          return items;
        },
        coerce: () => null,
      }),
    ).rejects.toThrow("myext:bad-shape");
  });

  it("throws `<label>:bad-shape` when picked value isn't an array", async () => {
    await setStreamResponse('{"items": "not-an-array"}');
    await expect(
      aiJsonExtract({
        passage: "x".repeat(50),
        systemPrompt: "x",
        errorLabel: "shape-test",
        pickArray: (p) => (p as { items: unknown }).items,
        coerce: () => null,
      }),
    ).rejects.toThrow("shape-test:bad-shape");
  });

  it("filters out null returns from coerce", async () => {
    await setStreamResponse('{"items":[1, "two", 3, null, 4]}');
    const result = await aiJsonExtract<number>({
      passage: "x".repeat(50),
      systemPrompt: "x",
      errorLabel: "test",
      pickArray: (p) => (p as { items: unknown[] }).items,
      coerce: (v) => (typeof v === "number" ? v : null),
    });
    // The string and the explicit null are dropped; the three
    // numbers survive in their original order.
    expect(result).toEqual([1, 3, 4]);
  });

  it("caps output at maxItems", async () => {
    await setStreamResponse('{"items":[1,2,3,4,5,6,7,8,9,10]}');
    const result = await aiJsonExtract<number>({
      passage: "x".repeat(50),
      systemPrompt: "x",
      errorLabel: "test",
      maxItems: 3,
      pickArray: (p) => (p as { items: unknown[] }).items,
      coerce: (v) => (typeof v === "number" ? v : null),
    });
    // Cap stops the loop early — the wrapper doesn't even invoke
    // coerce on the trailing 7 elements.
    expect(result).toEqual([1, 2, 3]);
  });

  it("passes the index to coerce so order-aware callers can use it", async () => {
    await setStreamResponse('{"items":["a","b","c"]}');
    const result = await aiJsonExtract<{ i: number; v: string }>({
      passage: "x".repeat(50),
      systemPrompt: "x",
      errorLabel: "test",
      pickArray: (p) => (p as { items: unknown[] }).items,
      coerce: (v, i) => (typeof v === "string" ? { i, v } : null),
    });
    expect(result).toEqual([
      { i: 0, v: "a" },
      { i: 1, v: "b" },
      { i: 2, v: "c" },
    ]);
  });
});
