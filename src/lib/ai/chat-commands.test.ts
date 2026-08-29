import { describe, expect, it } from "vitest";
import { matchChatCommands, parseChatCommands } from "./chat-commands";

describe("parseChatCommands", () => {
  it("strips a leading /graph and its aliases", () => {
    expect(parseChatCommands("/graph draw K4")).toEqual({ text: "draw K4", commands: new Set(["graph"]) });
    expect(parseChatCommands("  /Gráf   rajzold le")).toEqual({ text: "rajzold le", commands: new Set(["graph"]) });
  });
  it("leaves unknown slashes and mid-text slashes alone", () => {
    expect(parseChatCommands("/foo bar").commands.size).toBe(0);
    expect(parseChatCommands("/foo bar").text).toBe("/foo bar");
    expect(parseChatCommands("see /graph later").commands.size).toBe(0);
  });
});

describe("matchChatCommands", () => {
  it("filters by prefix and feature flag", () => {
    expect(matchChatCommands("/gr", () => true).map((c) => c.id)).toEqual(["graph"]);
    expect(matchChatCommands("/x", () => true)).toEqual([]);
    expect(matchChatCommands("/gr", () => false)).toEqual([]);
  });
});
