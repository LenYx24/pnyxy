/**
 * Tests for windowChatHistory, the prompt-history sliding window.
 * The load-bearing invariant is that the returned window always
 * starts with a user turn (Anthropic and the proxy's Anthropic
 * fallback reject a history that opens on an assistant message), so
 * these lock both the recency cut and that boundary fix-up.
 */
import { describe, expect, it } from "vitest";
import { windowChatHistory } from "@/stores/chat-store";

type Turn = { role: "user" | "assistant"; content: string };

/** Build an alternating user/assistant transcript of `n` messages,
 *  starting with a user turn (the shape pathFromRoot produces). */
function transcript(n: number): Turn[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));
}

describe("windowChatHistory", () => {
  it("returns short histories unchanged", () => {
    const msgs = transcript(6);
    expect(windowChatHistory(msgs)).toEqual(msgs);
  });

  it("keeps only the most recent turns once over the cap", () => {
    const msgs = transcript(41);
    const out = windowChatHistory(msgs);
    expect(out.length).toBeLessThanOrEqual(16);
    // The tail is preserved, the current user turn must survive the
    // cut regardless of where the front boundary lands.
    expect(out[out.length - 1]).toEqual(msgs[msgs.length - 1]);
  });

  it("always starts on a user turn after the cut", () => {
    // Odd length: the last-16 slice begins on an assistant turn, so
    // the fix-up drops that leading reply (window shrinks to 15).
    const msgs = transcript(41);
    const out = windowChatHistory(msgs);
    expect(out[0]?.role).toBe("user");
    expect(out.length).toBe(15);
  });

  it("keeps a full 16-message window when it already opens on a user turn", () => {
    // Even length: the last-16 slice starts on a user turn already,
    // so nothing is trimmed beyond the recency window.
    const msgs = transcript(40);
    const out = windowChatHistory(msgs);
    expect(out[0]?.role).toBe("user");
    expect(out.length).toBe(16);
  });
});
