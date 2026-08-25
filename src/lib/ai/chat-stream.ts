/**
 * Send/stream/abort orchestration for a chat turn. Pure functions over the
 * store's `set`/`get`; the store file only forwards to them.
 */
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import i18n from "@/lib/i18n";
import { isAbortError, streamChatResponse } from "@/lib/ai/ai-client";
import { buildAiContextPack } from "@/lib/ai/ai-context";
import {
  autoTitleConversation,
  requestFollowupSuggestions,
} from "@/lib/ai/title-autogen";
import {
  runRoadmapAgenticLoop,
  runRoadmapGenerateLoop,
} from "@/lib/roadmap/roadmap-agent";
import { detectRoadmapIntent } from "@/lib/roadmap/roadmap-tools";
import { pathFromRoot, windowChatHistory } from "@/stores/chat/chat-tree";
import type {
  ChatGet,
  ChatSendOptions,
  ChatSet,
} from "@/stores/chat/chat-types";
import type { AiProvider } from "@/stores/settings-store";
import type { ChatMessage, ChatMessageAttachment } from "@/types/chat";

// In-flight stream's AbortController. Module-scoped (not store state) so Zustand
// doesn't serialize it and it survives state replacements; stopStreaming reads it
// imperatively.
let streamAbortController: AbortController | null = null;

/** Abort the in-flight stream; sendOrBranch then persists whatever streamed so far. */
export function abortActiveStream() {
  streamAbortController?.abort();
  streamAbortController = null;
}

export async function sendOrBranch(
  conversationId: string,
  parentId: string | null,
  text: string,
  preferredProvider: AiProvider | undefined,
  attachments: ChatMessageAttachment[] | undefined,
  set: ChatSet,
  get: ChatGet,
  options?: ChatSendOptions,
) {
  const trimmed = text.trim();

  // The context pack is built before inserting the user row so page-as-image
  // attachments are saved on the message; re-streams/branches then pull them from the DB.
  const convForBuild = get().conversations.find(
    (c) => c.id === conversationId,
  );
  const sourceDocId = convForBuild?.source_doc_id ?? null;
  let contextPack: Awaited<ReturnType<typeof buildAiContextPack>>;
  try {
    contextPack = await buildAiContextPack(sourceDocId);
  } catch (err) {
    logError("chat:sendMessage:contextPack", err);
    contextPack = { customContext: "", pageContext: "", imageAttachments: [] };
  }

  // page images first so the model sees source pages before the user's uploads
  const composerAttachments = attachments ?? [];
  const mergedAttachments = [
    ...contextPack.imageAttachments,
    ...composerAttachments,
  ];

  // valid if there's text or at least one attachment
  const hasAttachments = mergedAttachments.length > 0;
  if (!trimmed && !hasAttachments) return;

  // 1. insert the user message
  const { data: userRow, error: userErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: parentId,
      role: "user",
      content: trimmed,
      attachments: hasAttachments ? mergedAttachments : null,
    })
    .select()
    .single();
  if (userErr || !userRow) {
    logError("chat:sendMessage:userInsert", userErr);
    throw userErr ?? new Error("Could not send message.");
  }
  const userMsg = userRow as ChatMessage;
  set((s) => {
    const next = new Map(s.messages);
    next.set(userMsg.id, userMsg);
    return { messages: next, activeLeafId: userMsg.id };
  });

  // if armed with a source selection, record a citation linking the message to the PDF passage
  if (options?.citation) {
    const citationConv = get().conversations.find(
      (c) => c.id === conversationId,
    );
    void (async () => {
      try {
        const { saveAiCitation } = await import("@/lib/annotation-storage");
        await saveAiCitation({
          id:
            (typeof crypto !== "undefined" && "randomUUID" in crypto)
              ? crypto.randomUUID()
              : `cit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          documentId: options.citation!.documentId,
          selection: options.citation!.selection,
          conversationId,
          messageId: userMsg.id,
          messageSnippet: trimmed.slice(0, 80),
          conversationTitle: citationConv?.title ?? "",
          createdAt: Date.now(),
        });
        // lazy import: annotation-store imports chat-store, so a static import would cycle
        const { useAnnotationStore } = await import(
          "@/stores/annotation-store"
        );
        useAnnotationStore.getState().reloadCitations(
          options.citation!.documentId,
        );
      } catch (err) {
        logError("chat:sendMessage:citationSave", err);
      }
    })();
  }

  // on the first message, fire the title request without awaiting
  const conv = get().conversations.find((c) => c.id === conversationId);
  if (parentId === null && conv && !conv.title.trim()) {
    void autoTitleConversation(conversationId, trimmed, preferredProvider, set);
  }

  // 2. build the prompt path root->new user msg, carrying attachments so old image turns resend
  const path = pathFromRoot(get().messages, userMsg.id);
  const promptMessages = windowChatHistory(
    path
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        attachments: m.attachments ?? undefined,
      })),
  );

  // 3. insert an empty assistant message to stream into
  const { data: asstRow, error: asstErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: userMsg.id,
      role: "assistant",
      content: "",
    })
    .select()
    .single();
  if (asstErr || !asstRow) {
    logError("chat:sendMessage:asstInsert", asstErr);
    throw asstErr ?? new Error("Could not create assistant placeholder.");
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

  // 4. stream the response, branching on conversation type:
  //   - target_roadmap_id -> agentic tool-use loop (AI edits roadmap live)
  //   - source_doc_id      -> text stream with doc-title + page-selection context
  //   - otherwise          -> plain text stream
  const convForStream = get().conversations.find(
    (c) => c.id === conversationId,
  );
  const targetRoadmapId = convForStream?.target_roadmap_id ?? null;
  const sourceTitle = convForStream?.source_doc_title ?? "";
  const patchAssistant = (content: string) =>
    set((s) => {
      const next = new Map(s.messages);
      const existing = next.get(asstMsg.id);
      if (existing) next.set(asstMsg.id, { ...existing, content });
      return { messages: next };
    });

  // fresh controller per turn; abort any in-flight one first. Also cleared in finally below.
  if (streamAbortController) {
    streamAbortController.abort();
  }
  streamAbortController = new AbortController();
  const signal = streamAbortController.signal;

  // Plain text stream. Providers often deliver deltas in big bursts, so a
  // separate rAF pump reveals the accumulated text a little each frame for a
  // smooth type-out. Step scales with backlog so large bursts drain fast; the
  // pump is awaited before the final string is returned.
  // Partial text survives an abort: the for-await throws AbortError before
  // streamPlain can return, so the outer catch reads it from here.
  let partial = "";
  const streamPlain = async (): Promise<string> => {
    let local = "";
    let revealed = 0;
    let streamDone = false;
    const pump = (async () => {
      while (!signal.aborted) {
        if (revealed < local.length) {
          const remaining = local.length - revealed;
          revealed = Math.min(
            local.length,
            revealed + Math.max(2, Math.ceil(remaining / 6)),
          );
          patchAssistant(local.slice(0, revealed));
        } else if (streamDone) {
          return;
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
    })();

    try {
      for await (const chunk of streamChatResponse(
        promptMessages,
        sourceTitle,
        contextPack.pageContext,
        {
          preferredProvider,
          signal,
          customContext: contextPack.customContext,
          // per-turn override from the composer's mode picker; skips the doc-context prompt
          systemPromptOverride: options?.systemPromptOverride,
          // OpenAI branch swaps to o3-mini; other branches ignore it
          reasoning: options?.reasoning,
        },
      )) {
        local += chunk.delta;
        partial = local;
      }
    } finally {
      // stop the pump and let it flush the rest of `local` before returning
      streamDone = true;
      await pump;
    }
    return local;
  };

  let acc = "";
  try {
    if (targetRoadmapId) {
      acc = await runRoadmapAgenticLoop(
        targetRoadmapId,
        promptMessages,
        preferredProvider,
        patchAssistant,
        signal,
      );
    } else if (detectRoadmapIntent(trimmed)) {
      // "generate a roadmap" skill, auto-detected from the message. Routes this turn
      // through the tool-use path (the only branch wired for tools) and links the result
      // inline. Auto-detect is a best guess: when the tool path is unavailable (e.g. the
      // server has no Anthropic key and the loop 501s), degrade to a normal chat answer
      // rather than leaving a ⚠ dead-end.
      try {
        acc = await runRoadmapGenerateLoop(
          promptMessages,
          preferredProvider,
          patchAssistant,
          signal,
        );
      } catch (roadmapErr) {
        if (isAbortError(roadmapErr)) throw roadmapErr;
        logError("chat:roadmapAutoDetect:fallback", roadmapErr);
        // wipe any partial roadmap/tool output and answer as a plain chat
        acc = "";
        patchAssistant("");
        acc = await streamPlain();
      }
    } else {
      acc = await streamPlain();
    }
  } catch (err) {
    if (isAbortError(err)) {
      // user pressed Stop: keep whatever already streamed
      acc = acc || partial;
    } else {
      logError("chat:sendMessage:stream", err);
      acc =
        acc ||
        `⚠ ${err instanceof Error ? err.message : "Failed to stream response"}`;
    }
  } finally {
    if (streamAbortController?.signal === signal) {
      streamAbortController = null;
    }
    // Empty-response guard: a blank bubble is never persisted. If the model streamed
    // nothing (and the user did not abort), a friendly notice is swapped in instead.
    // An aborted partial or a real ⚠ error message is left untouched.
    if (!signal.aborted && acc.trim() === "") {
      acc = `⚠ ${i18n.t("chat.emptyResponse", {
        defaultValue:
          "The model returned an empty response, please try again.",
      })}`;
      patchAssistant(acc);
    }
    // 5. persist final content + mark as active leaf
    await supabase
      .from("chat_messages")
      .update({ content: acc })
      .eq("id", asstMsg.id);
    await supabase
      .from("chat_conversations")
      .update({
        active_leaf_id: asstMsg.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    set((s) => {
      const next = new Map(s.messages);
      const existing = next.get(asstMsg.id);
      if (existing) next.set(asstMsg.id, { ...existing, content: acc });
      return { messages: next, streamingMessageId: null };
    });
  }

  // fire-and-forget follow-up suggestions; the helper short-circuits on degenerate cases
  void requestFollowupSuggestions(
    asstMsg.id,
    trimmed,
    acc,
    preferredProvider,
    set,
  );
}
