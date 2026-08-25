import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import {
  generateImage,
  ImageGenUnavailableError,
} from "@/lib/ai/image-generation";
import type { ChatSet } from "@/stores/chat/chat-types";
import type { ChatMessage, ChatMessageAttachment } from "@/types/chat";

/**
 * Image-generation turn: inserts the user prompt, a placeholder assistant
 * message (streamingMessageId keeps the typing indicator up), then patches the
 * placeholder with the PNG attachment or an error line.
 */
export async function sendImageMessageTurn(
  conversationId: string,
  parentId: string | null,
  prompt: string,
  set: ChatSet,
) {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  // 1. insert the user message
  const { data: userRow, error: userErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: parentId,
      role: "user",
      content: trimmed,
      attachments: null,
    })
    .select()
    .single();
  if (userErr || !userRow) {
    logError("chat:sendImageMessage:userInsert", userErr);
    return;
  }
  const userMsg = userRow as ChatMessage;
  set((s) => {
    const next = new Map(s.messages);
    next.set(userMsg.id, userMsg);
    return { messages: next, activeLeafId: userMsg.id };
  });

  // 2. placeholder assistant message
  const { data: asstRow, error: asstErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: userMsg.id,
      role: "assistant",
      content: "Generating image…",
    })
    .select()
    .single();
  if (asstErr || !asstRow) {
    logError("chat:sendImageMessage:asstInsert", asstErr);
    return;
  }
  const asstMsg = asstRow as ChatMessage;
  set((s) => {
    const next = new Map(s.messages);
    next.set(asstMsg.id, asstMsg);
    return {
      messages: next,
      streamingMessageId: asstMsg.id,
      activeLeafId: asstMsg.id,
    };
  });

  // 3. hit the Images API
  let attachment: ChatMessageAttachment | null = null;
  let errorText: string | null = null;
  try {
    const img = await generateImage(trimmed);
    attachment = {
      kind: "image",
      media_type: img.media_type,
      data: img.data,
      name: "generated.png",
    };
  } catch (err) {
    if (err instanceof ImageGenUnavailableError) {
      errorText =
        "Image generation needs an OpenAI key, set one in Settings → AI.";
    } else if (err instanceof Error) {
      errorText = `Image generation failed: ${err.message}`;
    } else {
      errorText = "Image generation failed.";
    }
    logError("chat:sendImageMessage:generate", err);
  }

  // 4. patch the assistant message with the image or error, clear streamingMessageId
  const patch = attachment
    ? { content: "", attachments: [attachment] }
    : { content: errorText ?? "Image generation failed." };

  const { error: updateErr } = await supabase
    .from("chat_messages")
    .update(patch)
    .eq("id", asstMsg.id);
  if (updateErr) {
    logError("chat:sendImageMessage:asstUpdate", updateErr);
  }
  set((s) => {
    const next = new Map(s.messages);
    const current = next.get(asstMsg.id);
    if (current) {
      next.set(asstMsg.id, {
        ...current,
        ...patch,
        attachments: attachment ? [attachment] : null,
      } as ChatMessage);
    }
    return { messages: next, streamingMessageId: null };
  });
}
