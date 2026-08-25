/**
 * Pure helpers over the message tree (a Map of ChatMessage keyed by id, linked
 * through parent_message_id) and the folder tree (parent_id). No store or
 * network access, so everything here is unit-testable.
 */
import type { ChatMessage } from "@/types/chat";

/** Walk from a leaf up to the root, returned in root->leaf order. */
export function pathFromRoot(
  messages: Map<string, ChatMessage>,
  leafId: string | null,
): ChatMessage[] {
  const path: ChatMessage[] = [];
  let cur = leafId ? messages.get(leafId) ?? null : null;
  while (cur) {
    path.push(cur);
    cur = cur.parent_message_id
      ? messages.get(cur.parent_message_id) ?? null
      : null;
  }
  return path.reverse();
}

/** Root ancestor of a message (the message itself when it has no parent), or null if unknown. */
export function rootOf(
  messages: Map<string, ChatMessage>,
  messageId: string | null,
): ChatMessage | null {
  const path = pathFromRoot(messages, messageId);
  return path[0] ?? null;
}

/** Every id in the subtree rooted at `messageId`, the root included (BFS order). */
export function subtreeIds(
  messages: Map<string, ChatMessage>,
  messageId: string,
): string[] {
  const seen = new Set<string>([messageId]);
  const queue: string[] = [messageId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const m of messages.values()) {
      if (m.parent_message_id === id && !seen.has(m.id)) {
        seen.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return [...seen];
}

/** Most recently created message, used as the fallback leaf when none is stored. */
export function newestMessage(
  messages: Map<string, ChatMessage>,
): ChatMessage | null {
  let newest: ChatMessage | null = null;
  for (const m of messages.values()) {
    if (!newest || m.created_at > newest.created_at) newest = m;
  }
  return newest;
}

/** Count direct children of a message, for the "N branches" badge. */
export function countBranches(
  messages: Map<string, ChatMessage>,
  messageId: string,
): number {
  let n = 0;
  for (const m of messages.values()) {
    if (m.parent_message_id === messageId) n++;
  }
  return n;
}

/** Return the direct children of a message, oldest first. */
export function childrenOf(
  messages: Map<string, ChatMessage>,
  messageId: string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages.values()) {
    if (m.parent_message_id === messageId) out.push(m);
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

// Cap prompt history to the most recent turns; the whole path is re-sent each turn so an
// unbounded history keeps re-billing early messages (doc context lives in the system prompt).
// Anthropic requires the first message to be a user turn, so drop a leading assistant reply.
const MAX_HISTORY_MESSAGES = 16;

export function windowChatHistory<T extends { role: "user" | "assistant" }>(
  msgs: T[],
): T[] {
  if (msgs.length <= MAX_HISTORY_MESSAGES) return msgs;
  let windowed = msgs.slice(-MAX_HISTORY_MESSAGES);
  if (windowed[0]?.role === "assistant") windowed = windowed.slice(1);
  return windowed;
}

/**
 * Fork lineage over conversations: root->conversation chain following
 * parent_conversation_id. Stops at the first unknown or cyclic link.
 */
export function conversationLineage<
  T extends { id: string; parent_conversation_id?: string | null },
>(conversations: T[], conversationId: string): T[] {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const chain: T[] = [];
  const seen = new Set<string>();
  let cur = byId.get(conversationId) ?? null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parent_conversation_id
      ? byId.get(cur.parent_conversation_id) ?? null
      : null;
  }
  return chain.reverse();
}

/**
 * True when `candidateId` is `folderId` itself or one of its descendants, walking
 * parent_id upward from the candidate. Guards moveFolderToParent against cycles.
 */
export function isFolderOrDescendant<
  T extends { id: string; parent_id: string | null },
>(folders: T[], folderId: string, candidateId: string | null): boolean {
  const seen = new Set<string>();
  let cursor: string | null = candidateId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === folderId) return true;
    seen.add(cursor);
    const next: T | undefined = folders.find((f) => f.id === cursor);
    cursor = next?.parent_id ?? null;
  }
  return false;
}
