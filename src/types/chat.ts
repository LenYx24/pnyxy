export type ChatRole = "user" | "assistant" | "system";

export interface ChatConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  active_leaf_id: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  role: ChatRole;
  content: string;
  created_at: string;
}
