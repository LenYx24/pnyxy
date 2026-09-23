/**
 * Full-text search over message content, for the sidebar's "search inside
 * conversations" toggle. The title filter stays local and instant; this one
 * is a round-trip, so it is opt-in, debounced by the caller and degrades to
 * "unavailable" (rather than an error) on a database that hasn't had
 * migration 00090 applied yet.
 */
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";

export interface ContentSearchHit {
  conversationId: string;
  /** Matching messages in that conversation. */
  matchCount: number;
  /** Server-highlighted excerpt; `<<` / `>>` mark the matched words. */
  snippet: string;
  lastMatchAt: string;
}

export type ContentSearchResult =
  | { status: "ok"; hits: ContentSearchHit[] }
  /** The RPC isn't in this database yet; the UI hides the toggle. */
  | { status: "unavailable" }
  | { status: "error" };

interface SearchRow {
  out_conversation_id: string;
  out_match_count: number;
  out_snippet: string | null;
  out_last_match_at: string;
}

/** Postgrest's "no such function" code, plus the HTTP 404 it rides in on. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    (error.message ?? "").includes("search_chat_messages")
  );
}

export async function searchConversationContent(
  query: string,
  limit = 40,
): Promise<ContentSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { status: "ok", hits: [] };
  const { data, error } = await supabase.rpc("search_chat_messages", {
    p_query: trimmed,
    p_limit: limit,
  });
  if (error) {
    if (isMissingFunction(error)) return { status: "unavailable" };
    logError("chat:searchConversationContent", error);
    return { status: "error" };
  }
  const hits = ((data ?? []) as SearchRow[]).map((row) => ({
    conversationId: row.out_conversation_id,
    matchCount: Number(row.out_match_count) || 0,
    snippet: row.out_snippet ?? "",
    lastMatchAt: row.out_last_match_at,
  }));
  return { status: "ok", hits };
}
