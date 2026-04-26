export type ChatRole = "user" | "assistant" | "system";

export interface ChatConversation {
  id: string;
  user_id: string;
  title: string;
  /** Null = "loose at the root" of the conversation list. */
  folder_id: string | null;
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
