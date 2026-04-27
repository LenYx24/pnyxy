export type ChatRole = "user" | "assistant" | "system";

export interface ChatConversation {
  id: string;
  user_id: string;
  title: string;
  /** Null = "loose at the root" of the conversation list. */
  folder_id: string | null;
  /** Set when the conversation was started from the reader's
   *  text-selection menu. Used to (a) show a context pill above
   *  the composer and (b) turn [p.N] citations from the assistant
   *  into clickable links back to /reader/<source_doc_id>?page=N. */
  source_doc_id: string | null;
  source_doc_title: string | null;
  source_page: number | null;
  /** Set when the conversation is tied to an editable artifact. The
   *  store injects the artifact's current state into the system
   *  prompt and enables the matching tool dispatcher so the AI can
   *  apply edits live. Mutually exclusive with target_quiz_id. */
  target_roadmap_id: string | null;
  target_quiz_id: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  role: ChatRole;
  content: string;
  /** Multimodal content attached to a user turn — images today,
   *  potentially PDFs / audio later. Stored alongside the message
   *  so refreshes don't lose them. The provider-side conversion
   *  (Anthropic image source vs OpenAI image_url) lives in
   *  ai-client.ts; persistence is provider-agnostic. */
  attachments?: ChatMessageAttachment[] | null;
  created_at: string;
}

/**
 * One attachment on a user message. v1 only handles images; the
 * `kind` discriminator leaves room for "pdf" / "audio" / "file"
 * variants without a schema migration since the storage column is
 * schemaless jsonb.
 */
export interface ChatMessageAttachment {
  kind: "image";
  /** MIME type, e.g. "image/png", "image/jpeg". */
  media_type: string;
  /** Raw base64 (no data: prefix). Anthropic wants it stripped;
   *  OpenAI wants the prefix prepended. ai-client handles both. */
  data: string;
  /** Original filename if known — surfaced as alt text and for the
   *  attachment card label. */
  name?: string;
}
