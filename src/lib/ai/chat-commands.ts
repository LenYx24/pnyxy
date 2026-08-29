// Slash commands typed at the start of a chat message ("/graph …"). They
// opt a single turn into an optional capability whose prompt contract is
// otherwise NOT in the system prompt, so the model never volunteers a
// widget the user didn't ask for. Parsed in chat-stream (every entry
// point) and surfaced by the composer's "/" hint row.

import type { FeatureKey } from "@/lib/features";

export interface ChatCommand {
  id: "graph";
  /** Typed forms, lower-case, without the slash. */
  aliases: string[];
  /** Feature flag that must be on for the command to exist. */
  feature?: FeatureKey;
}

export const CHAT_COMMANDS: ChatCommand[] = [
  { id: "graph", aliases: ["graph", "gráf", "graf"], feature: "graphWidget" },
];

export interface ParsedCommands {
  /** Message with the leading command tokens removed. */
  text: string;
  commands: Set<ChatCommand["id"]>;
}

/** Strips leading "/cmd" tokens (any number, any order) from the text. */
export function parseChatCommands(raw: string): ParsedCommands {
  const commands = new Set<ChatCommand["id"]>();
  let text = raw.trimStart();
  for (;;) {
    const m = text.match(/^\/(\S+)\s*/);
    if (!m) break;
    const token = m[1].toLowerCase();
    const cmd = CHAT_COMMANDS.find((c) => c.aliases.includes(token));
    if (!cmd) break;
    commands.add(cmd.id);
    text = text.slice(m[0].length);
  }
  return { text: text.trim(), commands };
}

/** Commands matching a partial "/gr" the user is typing (for the hint row). */
export function matchChatCommands(
  partial: string,
  enabled: (feature?: FeatureKey) => boolean,
): ChatCommand[] {
  const q = partial.replace(/^\//, "").toLowerCase();
  return CHAT_COMMANDS.filter(
    (c) => enabled(c.feature) && c.aliases.some((a) => a.startsWith(q)),
  );
}
