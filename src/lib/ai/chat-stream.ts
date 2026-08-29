/**
 * Send/stream/abort orchestration for a chat turn. Pure functions over the
 * store's `set`/`get`; the store file only forwards to them.
 */
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { track } from "@/lib/telemetry";
import i18n from "@/lib/i18n";
import {
  AiProviderError,
  AiStreamCutError,
  isAbortError,
  streamChatResponse,
} from "@/lib/ai/ai-client";
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
import { runLibraryAgenticLoop } from "@/lib/ai/library-agent";
import { INLINE_GRAPH_SPEC } from "@/lib/ai/extract-graph";
import { parseChatCommands } from "@/lib/ai/chat-commands";
import { getFeatures } from "@/lib/use-features";
import { applyContextOverrides, useContextOverridesStore } from "@/stores/context-overrides-store";
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
/** Localized explanation for a non-normal stop reason from the model. */
function streamCutNotice(reason: string): string {
  if (reason === "max_tokens" || reason === "length") {
    return i18n.t("chat.streamCut.maxTokens");
  }
  if (
    reason === "content_filter" ||
    reason === "safety" ||
    reason === "recitation"
  ) {
    return i18n.t("chat.streamCut.filter");
  }
  return i18n.t("chat.streamCut.other", {
    reason,
  });
}

/** Short machine-ish tag for the `error` column when a cut happened with no
 *  partial text to keep (the notice itself becomes the visible content, so
 *  `error` only needs to carry a stable category for filtering/telemetry). */
function streamCutErrorTag(reason: string): string {
  if (reason === "max_tokens" || reason === "length") return "cut:max_tokens";
  if (
    reason === "content_filter" ||
    reason === "safety" ||
    reason === "recitation"
  ) {
    return "cut:content_filter";
  }
  return `cut:${reason}`;
}

/** Best-effort update of the `error` column. The migration adding it may not
 *  be applied yet on some environments, so a missing-column failure is
 *  swallowed rather than losing the content update that already succeeded. */
async function tryPersistError(messageId: string, error: string | null) {
  if (!error) return;
  const { error: updateErr } = await supabase
    .from("chat_messages")
    .update({ error })
    .eq("id", messageId);
  if (updateErr) {
    logError("chat:sendMessage:persistError", updateErr);
  }
}

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
  // "/graph …": per-turn opt-in to the graph widget (flag-gated). The
  // command is stripped from the stored message; a ```graph block in the
  // text (the widget's "ask about this graph") counts as asking too.
  const parsed = parseChatCommands(text);
  const trimmed = parsed.text;
  const wantsGraph =
    getFeatures().graphWidget &&
    (parsed.commands.has("graph") || /```graph/i.test(trimmed));

  // The context pack is built before inserting the user row so page-as-image
  // attachments are saved on the message; re-streams/branches then pull them from the DB.
  const convForBuild = get().conversations.find((c) => c.id === conversationId);
  const sourceDocId = convForBuild?.source_doc_id ?? null;
  // context inspector edits for this thread (layers switched off / replaced)
  const overridesStore = useContextOverridesStore.getState();
  overridesStore.adopt(conversationId);
  const overrides = overridesStore.get(conversationId);
  let contextPack: Awaited<ReturnType<typeof buildAiContextPack>>;
  try {
    contextPack = applyContextOverrides(
      await buildAiContextPack(sourceDocId, conversationId, {
        attachToc: overrides.disabled.includes("toc") ? false : undefined,
      }),
      overrides,
    );
  } catch (err) {
    logError("chat:sendMessage:contextPack", err);
    contextPack = { customContext: "", pageContext: "", imageAttachments: [] };
  }

  // Graph widget: the ```graph contract is only taught for turns that
  // asked for it, so the model never draws unprompted. Rides on
  // customContext so every provider's default prompt gets it.
  if (wantsGraph) {
    contextPack = {
      ...contextPack,
      customContext:
        `${contextPack.customContext}\n\n${INLINE_GRAPH_SPEC}\n\nThe user asked for a graph in this message: answer with one \`\`\`graph block (plus a short explanation).`.trim(),
    };
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

  // single send-entry telemetry point (see ChatSendScope): explicit scope
  // wins (whiteboard panel, course seed), else inferred from the doc link
  track("chat_send", {
    scope: options?.scope ?? (sourceDocId ? "book" : "chat"),
    model: options?.pnyxyModelOverride ?? preferredProvider ?? null,
  });

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
            typeof crypto !== "undefined" && "randomUUID" in crypto
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
        const { useAnnotationStore } =
          await import("@/stores/annotation-store");
        useAnnotationStore
          .getState()
          .reloadCitations(options.citation!.documentId);
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
  const historyTurns = path
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      attachments: m.attachments ?? undefined,
    }));
  // history switched off in the inspector: only the message just sent
  const promptMessages = overrides.disabled.includes("history")
    ? historyTurns.slice(-1)
    : windowChatHistory(historyTurns);

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
  const patchAssistantError = (error: string | null) =>
    set((s) => {
      const next = new Map(s.messages);
      const existing = next.get(asstMsg.id);
      if (existing) next.set(asstMsg.id, { ...existing, error });
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
          webSearch: options?.webSearch,
          // "retry with another model": one-turn Pnyxy model pin
          pnyxyModelOverride: options?.pnyxyModelOverride,
          // YouTube side-chat "Gemini watches the video" mode
          videoContext: options?.videoContext,
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
  // Machine-ish tag for the DB `error` column (see migration 00071). Null =
  // no error. The UI marks a bubble as an error whenever this is set, so it
  // replaces the old "⚠ " content prefix.
  let errorField: string | null = null;
  try {
    if (targetRoadmapId) {
      acc = await runRoadmapAgenticLoop(
        targetRoadmapId,
        promptMessages,
        preferredProvider,
        patchAssistant,
        signal,
      );
    } else if (options?.libraryTools) {
      // "Organize library" mode: tool loop with per-action approval cards.
      // Same degrade path as the roadmap skill when tools are unavailable.
      try {
        acc = await runLibraryAgenticLoop(
          promptMessages,
          preferredProvider,
          patchAssistant,
          signal,
          options?.libraryToolsContext,
        );
      } catch (libraryErr) {
        if (isAbortError(libraryErr)) throw libraryErr;
        logError("chat:libraryTools:fallback", libraryErr);
        acc = "";
        patchAssistant("");
        acc = await streamPlain();
      }
    } else if (detectRoadmapIntent(trimmed)) {
      // "generate a roadmap" skill, auto-detected from the message. Routes this turn
      // through the tool-use path (the only branch wired for tools) and links the result
      // inline. Auto-detect is a best guess: when the tool path is unavailable (e.g. the
      // server has no Anthropic key and the loop 501s), degrade to a normal chat answer
      // rather than leaving an error dead-end.
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
      // user pressed Stop: keep whatever already streamed, no error recorded
      acc = acc || partial;
    } else if (err instanceof AiStreamCutError) {
      // the model stopped early (output limit, safety/recitation filter, provider
      // cut). With partial text, keep it as content and put the explanation in
      // `error`; with no text at all, the notice itself becomes the (non-blank)
      // content and `error` gets a short machine tag instead.
      logError("chat:sendMessage:cut", err);
      const notice = streamCutNotice(err.reason);
      if (partial.trim()) {
        acc = partial.trimEnd();
        errorField = notice;
      } else {
        acc = notice;
        errorField = streamCutErrorTag(err.reason);
      }
      patchAssistant(acc);
      patchAssistantError(errorField);
    } else if (
      err instanceof AiProviderError &&
      err.serverCode === "sign_in_required"
    ) {
      // Anonymous chat is off server-side (ALLOW_ANON_CHAT unset/false):
      // the proxy 401s before anything streams. Show a friendly localized
      // message instead of the raw English proxy text.
      logError("chat:sendMessage:stream", err);
      const notice = i18n.t("chat.errors.signInRequired");
      acc = notice;
      errorField = notice;
      patchAssistant(acc);
      patchAssistantError(errorField);
    } else {
      logError("chat:sendMessage:stream", err);
      const reason =
        err instanceof Error ? err.message : "Failed to stream response";
      if (partial.trim()) {
        // partial text survives a mid-stream failure too; the reason explains it
        acc = partial.trimEnd();
        errorField = reason;
      } else {
        // no text at all: the reason itself becomes the visible content, and
        // `error` gets the same text when informative, else a generic tag
        acc = reason;
        errorField = reason || "stream_failed";
      }
      patchAssistant(acc);
      patchAssistantError(errorField);
    }
  } finally {
    if (streamAbortController?.signal === signal) {
      streamAbortController = null;
    }
    // Empty-response guard: a blank bubble is never persisted. If the model streamed
    // nothing (and the user did not abort), a friendly notice is swapped in instead.
    // An aborted partial or an already-recorded error is left untouched.
    if (!signal.aborted && acc.trim() === "") {
      acc = i18n.t("chat.emptyResponse");
      errorField = "empty_response";
      patchAssistant(acc);
      patchAssistantError(errorField);
    }
    track("chat_reply_done", { chars: acc.length, cut: errorField !== null });
    // 5. persist final content + mark as active leaf. Two separate updates:
    // the content one always runs, the error one is best-effort so an
    // environment where migration 00071 hasn't landed yet (missing column)
    // never loses the content update.
    await supabase
      .from("chat_messages")
      .update({ content: acc })
      .eq("id", asstMsg.id);
    await tryPersistError(asstMsg.id, errorField);
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
      if (existing) {
        next.set(asstMsg.id, { ...existing, content: acc, error: errorField });
      }
      return { messages: next, streamingMessageId: null };
    });
  }

  // fire-and-forget follow-up suggestions; the helper short-circuits on degenerate cases
  void requestFollowupSuggestions(
    asstMsg.id,
    trimmed,
    acc,
    errorField,
    preferredProvider,
    set,
  );
}
