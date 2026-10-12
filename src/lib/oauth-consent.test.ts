import { describe, expect, it } from "vitest";
import { classifyRedirect } from "./oauth-consent";

describe("classifyRedirect", () => {
  it("recognises known agents by https host", () => {
    expect(classifyRedirect("https://claude.ai/api/mcp/auth_callback")).toEqual(
      {
        kind: "known",
        agent: "Claude",
        host: "claude.ai",
      },
    );
    expect(
      classifyRedirect("https://chatgpt.com/connector_platform_oauth_redirect")
        .kind,
    ).toBe("known");
  });

  it("does not trust look-alike or plain-http hosts", () => {
    expect(classifyRedirect("https://claude.ai.evil.com/cb").kind).toBe(
      "unknown",
    );
    expect(classifyRedirect("https://evil-claude.ai/cb").kind).toBe("unknown");
    expect(classifyRedirect("http://claude.ai/cb").kind).toBe("unknown");
  });

  it("treats loopback callbacks as a local program", () => {
    expect(classifyRedirect("http://localhost:33418/callback").kind).toBe(
      "local",
    );
    expect(classifyRedirect("http://127.0.0.1:8976/cb")).toEqual({
      kind: "local",
      host: "127.0.0.1:8976",
    });
  });

  it("flags custom schemes and garbage as unknown", () => {
    expect(classifyRedirect("cursor://anysphere/oauth").kind).toBe("unknown");
    expect(classifyRedirect("not a url").kind).toBe("unknown");
  });
});
