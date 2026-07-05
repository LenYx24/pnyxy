import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { pathFromRoot } from "@/stores/chat-store";
import type { ChatConversation, ChatMessage } from "@/types/chat";

/**
 * Format a conversation's active-leaf path as portable Markdown the
 * user can paste into Obsidian / Notion / a thesis draft / wherever.
 * Pulls the visible thread only, branches not on the active leaf
 * are excluded by design (the user can branch-switch and re-export).
 *
 * Code blocks survive verbatim because we just inline `content`,
 * which is already the raw model output (markdown source). Image
 * attachments become "[Image: filename]" placeholders rather than
 * base64-bombing the file.
 */
export function conversationToMarkdown(
  conversation: ChatConversation,
  messages: Map<string, ChatMessage>,
  leafId: string | null,
): string {
  const path = pathFromRoot(messages, leafId);
  const lines: string[] = [];

  const title = conversation.title.trim() || "Untitled conversation";
  lines.push(`# ${title}`);
  lines.push("");

  const meta: string[] = [];
  if (conversation.source_doc_id && conversation.source_doc_title) {
    const page = conversation.source_page;
    meta.push(
      `*Source:* ${conversation.source_doc_title}${
        page ? ` · p.${page}` : ""
      }`,
    );
  }
  meta.push(`*Exported:* ${new Date().toISOString().slice(0, 10)}`);
  lines.push(meta.join("  \n"));
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of path) {
    const heading =
      msg.role === "user"
        ? "## You"
        : msg.role === "assistant"
          ? "## Assistant"
          : "## System";
    lines.push(heading);
    lines.push("");
    if (msg.content.trim().length > 0) {
      lines.push(msg.content.trim());
      lines.push("");
    }
    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        const label = att.name?.trim() || att.media_type || "attachment";
        lines.push(`*[Image: ${label}]*`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Fetch a conversation's messages and download its active-leaf thread
 * as Markdown. Used by the library filetree, where only the
 * conversation row is in hand (messages aren't loaded into the chat
 * store unless the conversation is open). Follows the stored
 * active_leaf_id, falling back to the newest message by created_at.
 */
export async function downloadConversationMarkdownById(
  conversation: ChatConversation,
): Promise<void> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (error) {
    logError("export-conversation:fetchMessages", error);
    return;
  }
  const map = new Map<string, ChatMessage>();
  for (const m of (data ?? []) as ChatMessage[]) map.set(m.id, m);

  let leafId = conversation.active_leaf_id;
  if (!leafId || !map.has(leafId)) {
    let newest: ChatMessage | null = null;
    for (const m of map.values()) {
      if (!newest || m.created_at > newest.created_at) newest = m;
    }
    leafId = newest?.id ?? null;
  }

  const md = conversationToMarkdown(conversation, map, leafId);
  downloadMarkdown(conversation.title.trim() || "Untitled conversation", md);
}

/**
 * Trigger a browser download of the markdown blob. Filename is
 * sanitised so weird conversation titles ("File system test / oops")
 * don't break Save dialogs on any major OS.
 */
export function downloadMarkdown(filename: string, body: string): void {
  const safe =
    filename
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "conversation";
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke a frame later, Safari occasionally races the download
  // start against the revocation if it's truly synchronous.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
