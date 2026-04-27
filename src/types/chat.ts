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
  created_at: string;
}
