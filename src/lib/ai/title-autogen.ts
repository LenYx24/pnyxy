import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { streamChatResponse } from "@/lib/ai/ai-client";
import type { AiProvider } from "@/stores/settings-store";
import type { ChatSet } from "@/stores/chat/chat-types";

/** Ask the AI for a short title and apply it. Only on the first message of an untitled conv. */
export async function autoTitleConversation(
  conversationId: string,
  firstUserMessage: string,
  preferredProvider: AiProvider | undefined,
  set: ChatSet,
) {
  try {
    let title = "";
    for await (const chunk of streamChatResponse(
      [
        {
          role: "user",
          content:
            "Summarise the following message as a short conversation title, 3 to 6 words, no quotes, no trailing punctuation, plain text:\n\n" +
            firstUserMessage,
        },
      ],
      "",
      "",
      { preferredProvider, maxOutputTokens: 30, pnyxyModelOverride: "gemini-3.5-flash-lite" },
    )) {
      title += chunk.delta;
    }
    title = title
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/[.\s]+$/, "")
      .slice(0, 80);
    if (!title) return;

    const { error } = await supabase
      .from("chat_conversations")
      .update({ title })
      .eq("id", conversationId);
    if (error) {
      logError("chat:autoTitle", error);
      return;
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, title } : c,
      ),
    }));
  } catch (err) {
    logError("chat:autoTitle:exception", err);
  }
}

/** Ask the AI for 3 follow-up chips below an assistant message. Ephemeral, not persisted. */
export async function requestFollowupSuggestions(
  assistantMessageId: string,
  userText: string,
  assistantText: string,
  /** Set when the turn errored (see migration 00071); skip suggestions for it. */
  assistantError: string | null | undefined,
  preferredProvider: AiProvider | undefined,
  set: ChatSet,
) {
  // skip very short / errored replies
  if (assistantText.trim().length < 40) return;
  if (assistantError) return;
  // legacy fallback: old rows encoded the error as a "⚠" content prefix
  if (assistantText.startsWith("⚠")) return;

  try {
    let raw = "";
    for await (const chunk of streamChatResponse(
      [
        {
          role: "user",
          content:
            "Below is a snippet of a chat. Suggest 3 short follow-up questions the human might naturally ask next.\n\n" +
            `USER: ${userText.slice(0, 600)}\n\n` +
            `ASSISTANT: ${assistantText.slice(0, 1200)}\n\n` +
            "Output exactly 3 questions, one per line, each starting with \"- \". Each ≤ 80 chars. Output only the questions, no headers, no commentary, no numbering.",
        },
      ],
      "",
      "",
      { preferredProvider, maxOutputTokens: 200, pnyxyModelOverride: "gemini-3.5-flash-lite" },
    )) {
      raw += chunk.delta;
    }

    const suggestions = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((q) => q.length > 0 && q.length <= 120)
      .slice(0, 3);

    if (suggestions.length === 0) return;

    set((s) => {
      const next = new Map(s.messageSuggestions);
      next.set(assistantMessageId, suggestions);
      return { messageSuggestions: next };
    });
  } catch (err) {
    logError("chat:followupSuggestions:exception", err);
  }
}
