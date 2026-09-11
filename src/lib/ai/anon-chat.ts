/**
 * Anonymous (signed-out) chat: the whole chat UI works as usual, only the
 * server rate-limits how much a guest can talk to the AI (per-IP quota + a
 * global daily cap, migration 00079). Off unless VITE_ALLOW_ANON_CHAT="true",
 * mirroring the server's ALLOW_ANON_CHAT gate, so the two stay in step.
 *
 * Anon messages are kept in memory only: a guest has no auth session, so
 * chat_conversations / chat_messages (user-scoped, RLS) can't hold their
 * data. The transport already handles the anon case (no Bearer token ->
 * proxy anon path), so the send path just skips every DB write.
 */
export function isAnonChatEnabled(): boolean {
  return import.meta.env.VITE_ALLOW_ANON_CHAT === "true";
}
