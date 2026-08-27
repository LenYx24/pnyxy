export type ChatRole = "user" | "assistant" | "system";

export interface ChatConversation {
  id: string;
  user_id: string;
  title: string;
  /** Null = root of the conversation list. */
  folder_id: string | null;
  /** Set when started from the reader's selection menu. Drives the context
   *  pill and makes [p.N] citations link to /reader/<source_doc_id>?page=N. */
  source_doc_id: string | null;
  source_doc_title: string | null;
  source_page: number | null;
  /** Tie to an editable artifact so the AI can apply live edits. Mutually
   *  exclusive with target_quiz_id. */
  target_roadmap_id: string | null;
  target_quiz_id: string | null;
  /** Sidebar position, lower = earlier. Reorder writes a fractional value
   *  between neighbours; new convos get min(siblings) - 1 to land on top. */
  sort_order: number;
  /** Set when this conversation was forked from another (the Graph view's
   *  parent→child lineage). Null = a root conversation. */
  parent_conversation_id: string | null;
  /** Incognito: hidden from history, purged ~24h later (00068). */
  is_temporary?: boolean;
  /** Hidden from the main lists; restorable from the Archive (00068). */
  archived_at?: string | null;
  /** In a forked conversation: the LOCAL copy of the message the fork was
   *  made at; the thread draws the "fork point" divider under it.
   *  Optional: absent until migration 00061 is applied. */
  forked_from_message_id?: string | null;
  created_at: string;
  updated_at: string;
  active_leaf_id: string | null;
}

export interface ChatFolder {
  id: string;
  user_id: string;
  /** Null = top-level folder (sibling of root-level conversations). */
  parent_id: string | null;
  name: string;
  /** Same fractional-insert convention as conversation sort_order. */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  role: ChatRole;
  content: string;
  /** Images attached to a user turn, persisted so refreshes keep them.
   *  Provider-specific conversion happens in ai-client.ts. */
  attachments?: ChatMessageAttachment[] | null;
  /** Set on a failed/cut assistant turn instead of encoding the error into
   *  `content` with a "⚠" prefix. A short machine-ish reason
   *  ("stream_failed", "empty_response", "cut:max_tokens", "cut:content_filter")
   *  or, for the partial-stream cut case, the human-readable notice itself.
   *  Optional: absent until migration 00071 is applied. */
  error?: string | null;
  created_at: string;
}

/** One attachment on a user message. `kind` is a discriminator; only
 *  images exist so far (column is jsonb, so adding variants needs no migration). */
export interface ChatMessageAttachment {
  kind: "image";
  /** MIME type, e.g. "image/png". */
  media_type: string;
  /** Raw base64, no data: prefix. ai-client adds/strips per provider. */
  data: string;
  /** Original filename, used as alt text and card label. */
  name?: string;
}
