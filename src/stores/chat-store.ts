import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import {
  isAbortError,
  streamChatResponse,
  streamChatWithTools,
  type ContentBlock,
  type TextBlock,
  type ToolMessage,
  type ToolResultBlock,
  type ToolStopReason,
} from "@/lib/ai/ai-client";
import {
  ROADMAP_TOOLS,
  LabelMap,
  formatRoadmapSnapshot,
  buildRoadmapEditSystemPrompt,
  buildRoadmapGenerateSystemPrompt,
  detectRoadmapIntent,
  dispatchRoadmapTool,
} from "@/lib/roadmap/roadmap-tools";
import { useRoadmapStore } from "@/stores/roadmap-store";
import { useOrgStore } from "@/stores/org-store";
import {
  generateImage,
  ImageGenUnavailableError,
} from "@/lib/ai/image-generation";
import { buildAiContextPack } from "@/lib/ai/ai-context";
import type { AiProvider } from "@/stores/settings-store";
import type {
  ChatConversation,
  ChatFolder,
  ChatMessage,
  ChatMessageAttachment,
} from "@/types/chat";

// ── Store ─────────────────────────────────────────────────

/** Hand-off slot for the reader → chat flow and the editor → chat
 *  flow. Whichever upstream surface triggers a chat fills this and
 *  navigates the user to /chat; ChatPage drains it on mount and
 *  creates a fresh conversation with whichever fields are set. */
export interface ChatDraft {
  text: string;
  /** Reader-side context: shows a "from <Book>, p.42" pill and lets
   *  the assistant emit clickable [p.N] citations. */
  source?: ChatSourceContext | null;
  /** Editor-side context: ties the conversation to an artifact the
   *  AI is allowed to mutate via tool calls. */
  target?: { roadmapId?: string | null; quizId?: string | null } | null;
  /** Selection rects from the reader — when set, the panel arms a
   *  citation that will be saved once the user actually sends the
   *  draft. Lets us draw dotted underlines on the source passage so
   *  users can see which book quotes they've already asked about. */
  selection?: import("@/types/annotation").TextSelection | null;
}

export interface ChatSourceContext {
  docId: string;
  docTitle: string;
  page: number | null;
}

/** Options the composer can pass with a single send to override
 *  prompt-time behaviour for that turn. Used by the topic-first
 *  recommendation modes — `systemPromptOverride` swaps the entire
 *  system prompt for a mode-specific one (book-recs / video-recs).
 *  When unset, the regular per-conversation system prompt is built
 *  from doc context + persona as before. */
export interface ChatSendOptions {
  systemPromptOverride?: string;
  /** When true, the chat is routed through OpenAI's o3-mini for
   *  step-by-step reasoning. Forwarded as a StreamOptions flag to
   *  ai-client; only the OpenAI BYOK path honors it (other
   *  providers ignore the flag). Composer surfaces this as a
   *  "Reasoning" toggle next to the model picker. */
  reasoning?: boolean;
  /** Arm an AI citation for the source selection. When set, the
   *  user message that gets inserted by this send is recorded in
   *  the local ai_citations store so the reader can underline the
   *  passage. Caller (AiChatPanel) populates this from a drained
   *  ChatDraft.selection on the FIRST send after a "Send to chat"
   *  hand-off, then clears it. */
  citation?: {
    documentId: string;
    selection: import("@/types/annotation").TextSelection;
  };
}

interface ChatState {
  conversations: ChatConversation[];
  folders: ChatFolder[];
  /** All messages for the currently-opened conversation, keyed by id. */
  messages: Map<string, ChatMessage>;
  activeConversationId: string | null;
  /** The leaf the user is currently "at" — messages upstream of this
   *  are the visible thread. */
  activeLeafId: string | null;
  /** True while the assistant is streaming its reply into a message. */
  streamingMessageId: string | null;
  isLoading: boolean;
  /** Pending hand-off from the reader. ChatPage consumes & clears it. */
  pendingDraft: ChatDraft | null;
  /** Per-assistant-message follow-up suggestion chips. Populated by
   *  a separate, low-token model call after each successful turn;
   *  cleared per-conversation on openConversation. Ephemeral — not
   *  persisted to Supabase. */
  messageSuggestions: Map<string, string[]>;

  fetchConversations: () => Promise<void>;
  createConversation: (
    title?: string,
    folderId?: string | null,
    source?: ChatSourceContext | null,
    /** Tie the conversation to an editable artifact. When set, the
     *  AI gets tool-use access to mutate it live. */
    target?: { roadmapId?: string | null; quizId?: string | null } | null,
  ) => Promise<string | null>;
  /** Reader-side: stash a draft + source context, then navigate. */
  setPendingDraft: (draft: ChatDraft | null) => void;
  /** ChatPage-side: read & clear in one step (so the next mount
   *  doesn't replay the same draft). */
  consumePendingDraft: () => ChatDraft | null;
  openConversation: (conversationId: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  /** Delete a single message and every descendant of it from the
   *  conversation tree. Used by the message-bubble Delete action so
   *  users can trim context they don't want re-sent on the next
   *  turn. The active leaf is auto-rewound to the deleted node's
   *  parent if it was inside the removed subtree. */
  deleteMessage: (messageId: string) => Promise<void>;
  /** Fork the conversation from the given message (inclusive) into
   *  a brand new conversation. Copies the message path from root
   *  down to `fromMessageId`, opens the new conversation, and leaves
   *  the original untouched. Matches the "branching = duplicate"
   *  mental model some users expect. */
  duplicateFromMessage: (fromMessageId: string) => Promise<string | null>;
  /** Move a conversation into the given folder, or null to send it
   *  back to the root. When `sortOrder` is provided, the same row
   *  update also pins the conv's position — used by DnD reorder
   *  flows where the user drops on a specific neighbour. */
  moveConversationToFolder: (
    id: string,
    folderId: string | null,
    sortOrder?: number,
  ) => Promise<void>;
  /** Update only the sort_order — for same-folder drag reorder.
   *  Single-row update; the optimistic patch flips the local row
   *  before the round-trip and rolls back on error. */
  reorderConversation: (id: string, sortOrder: number) => Promise<void>;
  clearActive: () => void;

  // ── Folders ─────────────────────────────────────────────────
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<string | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** Deletes the folder and any nested subfolders (cascades), but
   *  conversations inside are sent back to the root via the
   *  `on delete set null` FK. */
  deleteFolder: (id: string) => Promise<void>;
  /** Reparent a folder. `parentId = null` → top-level. Refuses to
   *  set the folder as a descendant of itself (would orphan the
   *  subtree from the user's view via the cycle). Optional
   *  `sortOrder` pins the position inside the new parent so
   *  drop-on-sibling DnD lands the folder where the line shows. */
  moveFolderToParent: (
    id: string,
    parentId: string | null,
    sortOrder?: number,
  ) => Promise<void>;
  /** Same-parent reorder. Single-row update, optimistic + rollback. */
  reorderFolder: (id: string, sortOrder: number) => Promise<void>;

  /** Switch the active leaf without sending anything — used when the
   *  user picks a different branch from the tree. */
  setActiveLeaf: (messageId: string) => Promise<void>;

  /** Append a new user message to the current active leaf, then stream
   *  the assistant's reply. Both are persisted. The optional
   *  `preferredProvider` overrides the saved provider chain order
   *  for this single message — used by the composer's model picker.
   *  `attachments` are stored alongside the user message and sent as
   *  multimodal content to providers that support vision. */
  sendMessage: (
    text: string,
    preferredProvider?: AiProvider,
    attachments?: ChatMessageAttachment[],
    options?: ChatSendOptions,
  ) => Promise<void>;

  /** Create a new user message whose parent is `parentMessageId` (can
   *  be any message in the conversation — that's the "branch from
   *  here" UX) or `null` for a fresh root-level branch (used by
   *  Regenerate when the original user message had no parent).
   *  Then stream the assistant's reply. */
  branchFrom: (
    parentMessageId: string | null,
    text: string,
    preferredProvider?: AiProvider,
    attachments?: ChatMessageAttachment[],
    options?: ChatSendOptions,
  ) => Promise<void>;

  /** Cancel the in-flight streaming response, if any. The partial
   *  assistant message that was already streamed is preserved (just
   *  what the user saw on screen); no error toast — this is a
   *  user-initiated stop, not a failure. No-op when nothing is
   *  streaming. */
  stopStreaming: () => void;

  /** Image-generation submit. Mirrors `sendMessage` but routes the
   *  prompt through the Images API (OpenAI direct) instead of a
   *  chat completion. The assistant reply is a single message
   *  carrying the generated PNG as a base64 attachment. */
  sendImageMessage: (prompt: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  folders: [],
  messages: new Map(),
  activeConversationId: null,
  activeLeafId: null,
  streamingMessageId: null,
  isLoading: false,
  pendingDraft: null,
  messageSuggestions: new Map(),

  setPendingDraft(draft) {
    set({ pendingDraft: draft });
  },
  consumePendingDraft() {
    const draft = get().pendingDraft;
    if (draft) set({ pendingDraft: null });
    return draft;
  },

  async fetchConversations() {
    set({ isLoading: true });
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        set({ conversations: [] });
        return;
      }
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("*")
        .eq("user_id", user.id)
        // Manual sort_order is the primary axis; updated_at acts as
        // a tiebreaker so freshly-touched conversations with the
        // same (default) sort_order still surface near the top.
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      set({ conversations: (data ?? []) as ChatConversation[] });
    } catch (err) {
      logError("chat:fetchConversations", err);
    } finally {
      set({ isLoading: false });
    }
  },

  async createConversation(title = "", folderId = null, source = null, target = null) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to use chat.");
    // New convs land at the top of their target context. We use
    // `min(siblings.sort_order) - 1` so the new row's value is
    // strictly below every existing sibling — no renumbering, no
    // collisions with another tab's concurrent create.
    const siblingSorts = get()
      .conversations.filter((c) => c.folder_id === folderId)
      .map((c) => c.sort_order);
    const sortOrder =
      siblingSorts.length > 0 ? Math.min(...siblingSorts) - 1 : 0;
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({
        user_id: user.id,
        title,
        folder_id: folderId,
        sort_order: sortOrder,
        source_doc_id: source?.docId ?? null,
        source_doc_title: source?.docTitle ?? null,
        source_page: source?.page ?? null,
        target_roadmap_id: target?.roadmapId ?? null,
        target_quiz_id: target?.quizId ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      logError("chat:createConversation", error);
      throw error ?? new Error("Could not create conversation.");
    }
    set((s) => ({
      conversations: [data as ChatConversation, ...s.conversations],
      activeConversationId: data.id as string,
      messages: new Map(),
      activeLeafId: null,
    }));
    return data.id as string;
  },

  async openConversation(conversationId) {
    set({
      activeConversationId: conversationId,
      messages: new Map(),
      activeLeafId: null,
      // Drop suggestions: their keys are message ids from the
      // previous conversation, which won't be in `messages` anymore.
      // Holding onto them just bloats the Map indefinitely.
      messageSuggestions: new Map(),
      isLoading: true,
    });
    try {
      const [{ data: conv, error: convErr }, { data: msgs, error: msgsErr }] =
        await Promise.all([
          supabase
            .from("chat_conversations")
            .select("*")
            .eq("id", conversationId)
            .maybeSingle(),
          supabase
            .from("chat_messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true }),
        ]);
      if (convErr || !conv) throw convErr ?? new Error("Conversation not found.");
      if (msgsErr) throw msgsErr;

      const map = new Map<string, ChatMessage>();
      for (const m of msgs ?? []) map.set(m.id as string, m as ChatMessage);

      // Pick the stored active_leaf_id if valid, otherwise fall back
      // to the latest message (by created_at).
      let leafId: string | null = null;
      if (conv.active_leaf_id && map.has(conv.active_leaf_id as string)) {
        leafId = conv.active_leaf_id as string;
      } else {
        let newest: ChatMessage | null = null;
        for (const m of map.values()) {
          if (!newest || m.created_at > newest.created_at) newest = m;
        }
        leafId = newest?.id ?? null;
      }

      set({
        messages: map,
        activeLeafId: leafId,
      });
    } catch (err) {
      logError("chat:openConversation", err);
    } finally {
      set({ isLoading: false });
    }
  },

  async renameConversation(id, title) {
    const { error } = await supabase
      .from("chat_conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      logError("chat:renameConversation", error);
      throw error;
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title } : c,
      ),
    }));
  },

  async deleteConversation(id) {
    const { error } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("id", id);
    if (error) {
      logError("chat:deleteConversation", error);
      throw error;
    }
    set((s) => {
      const isActive = s.activeConversationId === id;
      return {
        conversations: s.conversations.filter((c) => c.id !== id),
        ...(isActive
          ? { activeConversationId: null, messages: new Map(), activeLeafId: null }
          : {}),
      };
    });
  },

  async deleteMessage(messageId) {
    const messages = get().messages;
    const target = messages.get(messageId);
    if (!target) return;

    // BFS through the local message map to collect every descendant
    // of the target (plus the target itself). The chat_messages
    // table doesn't have ON DELETE CASCADE on its self-FK, so we
    // delete the whole subtree explicitly in a single round-trip.
    const toDelete = new Set<string>([messageId]);
    const queue: string[] = [messageId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const m of messages.values()) {
        if (m.parent_message_id === id && !toDelete.has(m.id)) {
          toDelete.add(m.id);
          queue.push(m.id);
        }
      }
    }

    const ids = [...toDelete];
    const { error } = await supabase
      .from("chat_messages")
      .delete()
      .in("id", ids);
    if (error) {
      logError("chat:deleteMessage", error);
      throw error;
    }

    set((s) => {
      const next = new Map(s.messages);
      for (const id of ids) next.delete(id);
      // If the user was looking at a leaf inside the deleted
      // subtree, rewind to the deleted node's parent (or null when
      // they nuked the whole conversation root). Without this they
      // get stuck on a dangling activeLeafId.
      const leafGone =
        s.activeLeafId !== null && toDelete.has(s.activeLeafId);
      const nextLeaf = leafGone ? target.parent_message_id ?? null : s.activeLeafId;
      return { messages: next, activeLeafId: nextLeaf };
    });

    // Persist the new active leaf on the conversation row so a
    // reload doesn't reset us to the old (now-deleted) tip.
    const { activeConversationId, activeLeafId } = get();
    if (activeConversationId) {
      await supabase
        .from("chat_conversations")
        .update({ active_leaf_id: activeLeafId })
        .eq("id", activeConversationId);
    }
  },

  async duplicateFromMessage(fromMessageId) {
    const state = get();
    const target = state.messages.get(fromMessageId);
    if (!target) return null;

    // Walk from root down to and including the target message. This
    // becomes the prefix of the new conversation.
    const path = pathFromRoot(state.messages, fromMessageId);
    const source = state.conversations.find(
      (c) => c.id === state.activeConversationId,
    );
    if (!source) return null;

    // Create a new conversation, mirroring the source's
    // folder placement + doc context. Title prefixed so the user
    // can tell duplicates apart at a glance.
    const newTitle = source.title
      ? `${source.title} (copy)`
      : "(copy)";
    const newId = await get().createConversation(
      newTitle,
      source.folder_id,
      source.source_doc_id
        ? {
            docId: source.source_doc_id,
            docTitle: source.source_doc_title ?? "",
            page: source.source_page ?? null,
          }
        : null,
      source.target_roadmap_id || source.target_quiz_id
        ? {
            roadmapId: source.target_roadmap_id,
            quizId: source.target_quiz_id,
          }
        : null,
    );
    if (!newId) return null;

    // Insert the prefix path under the new conversation. Each
    // message keeps its content/role/attachments but gets a fresh
    // id from Supabase, with parent_message_id rewired to the new
    // copy of its parent.
    const idMap = new Map<string, string>();
    for (const m of path) {
      const newParentId = m.parent_message_id
        ? idMap.get(m.parent_message_id) ?? null
        : null;
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: newId,
          parent_message_id: newParentId,
          role: m.role,
          content: m.content,
          attachments: m.attachments ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        logError("chat:duplicateFromMessage:insert", error);
        // Best-effort: try to clean up the half-built duplicate so
        // the user doesn't have an empty stub conversation hanging
        // around. Failures here aren't critical — the conversation
        // still loads.
        await supabase.from("chat_conversations").delete().eq("id", newId);
        throw error;
      }
      idMap.set(m.id, data.id);
    }

    // Active leaf = the duplicated copy of the target message so
    // when the user opens the new conversation, it lands on the
    // same point they forked from.
    const newLeaf = idMap.get(fromMessageId) ?? null;
    if (newLeaf) {
      await supabase
        .from("chat_conversations")
        .update({ active_leaf_id: newLeaf })
        .eq("id", newId);
    }

    await get().openConversation(newId);
    return newId;
  },

  clearActive() {
    set({
      activeConversationId: null,
      messages: new Map(),
      activeLeafId: null,
    });
  },

  async setActiveLeaf(messageId) {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    set({ activeLeafId: messageId });
    await supabase
      .from("chat_conversations")
      .update({ active_leaf_id: messageId })
      .eq("id", activeConversationId);
  },

  async sendMessage(text, preferredProvider, attachments, options) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    await sendOrBranch(
      activeConversationId,
      activeLeafId,
      text,
      preferredProvider,
      attachments,
      set,
      get,
      options,
    );
  },

  async branchFrom(parentMessageId, text, preferredProvider, attachments, options) {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    await sendOrBranch(
      activeConversationId,
      parentMessageId,
      text,
      preferredProvider,
      attachments,
      set,
      get,
      options,
    );
  },

  stopStreaming() {
    // The controller lives at module scope (see below) so it survives
    // store-state replacements. abort() triggers AbortError inside
    // the streaming generator's underlying fetch / SDK call; sendOrBranch
    // catches it and persists whatever was already streamed.
    streamAbortController?.abort();
    streamAbortController = null;
  },

  async sendImageMessage(prompt) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // 1. Insert the user message — same shape as sendOrBranch so the
    //    thread history looks consistent (it's still a user turn, even
    //    though the response will be an image not text).
    const { data: userRow, error: userErr } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: activeConversationId,
        parent_message_id: activeLeafId,
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

    // 2. Insert placeholder assistant message — UX equivalent of the
    //    streaming spinner, but the body is "Generating image…" until
    //    we get the PNG bytes. Setting `streamingMessageId` keeps
    //    the typing indicator + stop button consistent.
    const { data: asstRow, error: asstErr } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: activeConversationId,
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

    // 3. Hit the Images API.
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
          "Image generation needs an OpenAI key — set one in Settings → AI.";
      } else if (err instanceof Error) {
        errorText = `Image generation failed: ${err.message}`;
      } else {
        errorText = "Image generation failed.";
      }
      logError("chat:sendImageMessage:generate", err);
    }

    // 4. Patch the assistant message with either the image (on
    //    success) or a one-line error (on failure). Either way we
    //    clear `streamingMessageId` so the composer comes back.
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
  },

  async moveConversationToFolder(id, folderId, sortOrder) {
    // No-op guard: dropping a conversation onto its current folder
    // with no sortOrder change is a frequent DnD overshoot — skip
    // the round-trip. We do still proceed when sortOrder differs,
    // since same-folder reorder reaches this method when DnD wants
    // both a folder change AND a position pin (cross-folder drop on
    // sibling conv).
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const folderUnchanged = current.folder_id === folderId;
    const sortUnchanged =
      sortOrder === undefined || current.sort_order === sortOrder;
    if (folderUnchanged && sortUnchanged) return;
    // Optimistic patch with rollback on error. Mirrors the
    // moveFolderToParent flow below.
    const previousFolderId = current.folder_id;
    const previousSortOrder = current.sort_order;
    const patch: Partial<ChatConversation> = { folder_id: folderId };
    if (sortOrder !== undefined) patch.sort_order = sortOrder;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    }));
    const update: Record<string, unknown> = { folder_id: folderId };
    if (sortOrder !== undefined) update.sort_order = sortOrder;
    const { error } = await supabase
      .from("chat_conversations")
      .update(update)
      .eq("id", id);
    if (error) {
      logError("chat:moveConversation", error);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id
            ? { ...c, folder_id: previousFolderId, sort_order: previousSortOrder }
            : c,
        ),
      }));
      throw error;
    }
  },

  async reorderConversation(id, sortOrder) {
    const current = get().conversations.find((c) => c.id === id);
    if (!current || current.sort_order === sortOrder) return;
    const previousSortOrder = current.sort_order;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, sort_order: sortOrder } : c,
      ),
    }));
    const { error } = await supabase
      .from("chat_conversations")
      .update({ sort_order: sortOrder })
      .eq("id", id);
    if (error) {
      logError("chat:reorderConversation", error);
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === id ? { ...c, sort_order: previousSortOrder } : c,
        ),
      }));
    }
  },

  // ── Folders ─────────────────────────────────────────────────

  async fetchFolders() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ folders: [] });
      return;
    }
    const { data, error } = await supabase
      .from("folders")
      .select("*")
      .eq("user_id", user.id)
      // sort_order asc with created_at as tiebreaker for two
      // folders that ended up at the same fractional value.
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      // The unified `folders` table has existed since the initial
      // schema, so a relation-missing error here would mean the
      // database is in an unexpectedly broken state — log it
      // instead of swallowing.
      logError("chat:fetchFolders", error);
      return;
    }
    set({ folders: (data ?? []) as ChatFolder[] });
  },

  async createFolder(name, parentId = null) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    // Chat folders live in the shared library `folders` table since
    // 00036, where `org_id` is NOT NULL (00027) — so the insert must
    // carry the active org or Postgres rejects it with a 400.
    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      logError("chat:createFolder", "No active organization");
      return null;
    }
    // Same min-1 pattern as createConversation — new folders land
    // at the top of their parent context. Scoped per (user, parent)
    // because sort_order only meaningfully compares siblings.
    const siblingSorts = get()
      .folders.filter((f) => f.parent_id === parentId)
      .map((f) => f.sort_order);
    const sortOrder =
      siblingSorts.length > 0 ? Math.min(...siblingSorts) - 1 : 0;
    const { data, error } = await supabase
      .from("folders")
      .insert({
        user_id: user.id,
        org_id: orgId,
        name: trimmed,
        parent_id: parentId,
        sort_order: sortOrder,
      })
      .select()
      .single();
    if (error || !data) {
      logError("chat:createFolder", error);
      return null;
    }
    await get().fetchFolders();
    return data.id as string;
  },

  async renameFolder(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabase
      .from("folders")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) {
      logError("chat:renameFolder", error);
      return;
    }
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
    }));
  },

  async deleteFolder(id) {
    const { error } = await supabase
      .from("folders")
      .delete()
      .eq("id", id);
    if (error) {
      logError("chat:deleteFolder", error);
      return;
    }
    // Server cascaded subfolders and set folder_id=null on
    // conversations — refresh both lists so the UI matches.
    await Promise.all([get().fetchFolders(), get().fetchConversations()]);
  },

  async moveFolderToParent(id, parentId, sortOrder) {
    if (id === parentId) return;
    // No-op guard for "drop onto current parent" — but only when the
    // sort_order also isn't shifting. Cross-parent moves always
    // proceed; same-parent calls without a sort change are skipped.
    const current = get().folders.find((f) => f.id === id);
    if (!current) return;
    const parentUnchanged = current.parent_id === parentId;
    const sortUnchanged =
      sortOrder === undefined || current.sort_order === sortOrder;
    if (parentUnchanged && sortUnchanged) return;
    // Cycle guard: walk up from the proposed new parent — if we hit
    // `id` somewhere in its ancestor chain, the move would orphan the
    // subtree from the user's view (a folder can't be its own
    // descendant). Bail silently in that case.
    if (parentId !== null) {
      const folders = get().folders;
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === id) return;
        const next: ChatFolder | undefined = folders.find((f) => f.id === cursor);
        cursor = next?.parent_id ?? null;
      }
    }
    // Optimistic patch with rollback on error, mirroring the
    // conversation-move flow so dragged folders settle into their new
    // home immediately instead of jumping after a round trip. Both
    // parent_id and sort_order can shift in the same write; we pin
    // sort_order only when the caller supplied one.
    const previousParentId = current.parent_id;
    const previousSortOrder = current.sort_order;
    const patch: Partial<ChatFolder> = { parent_id: parentId };
    if (sortOrder !== undefined) patch.sort_order = sortOrder;
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, ...patch } : f,
      ),
    }));
    const update: Record<string, unknown> = { parent_id: parentId };
    if (sortOrder !== undefined) update.sort_order = sortOrder;
    const { error } = await supabase
      .from("folders")
      .update(update)
      .eq("id", id);
    if (error) {
      logError("chat:moveFolderToParent", error);
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id === id
            ? { ...f, parent_id: previousParentId, sort_order: previousSortOrder }
            : f,
        ),
      }));
      return;
    }
  },

  async reorderFolder(id, sortOrder) {
    const current = get().folders.find((f) => f.id === id);
    if (!current || current.sort_order === sortOrder) return;
    const previousSortOrder = current.sort_order;
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, sort_order: sortOrder } : f,
      ),
    }));
    const { error } = await supabase
      .from("folders")
      .update({ sort_order: sortOrder })
      .eq("id", id);
    if (error) {
      logError("chat:reorderFolder", error);
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id === id ? { ...f, sort_order: previousSortOrder } : f,
        ),
      }));
    }
  },
}));

// ── Shared send implementation ─────────────────────────────

/**
 * Ask the AI for a 3-5 word title summarising a user message,
 * apply it to the conversation row, and refresh the list. Best-
 * effort — failures are silent and the conversation stays
 * "Untitled" so the rest of the chat keeps working.
 *
 * Fired from `sendOrBranch` only when the conversation has no
 * title yet AND this is the first message in the tree (no
 * parent). That way long-running threads don't keep retitling
 * themselves on every send.
 */
/** The currently in-flight assistant stream's AbortController, or
 *  null when nothing is streaming. Module-scoped (not store state)
 *  because AbortController isn't a value React or Zustand should
 *  serialize / diff — `stopStreaming` reads it imperatively, and
 *  `streamingMessageId` in the store is what consumers actually
 *  watch to decide whether the Stop button should be shown. */
let streamAbortController: AbortController | null = null;

async function autoTitleConversation(
  conversationId: string,
  firstUserMessage: string,
  preferredProvider: AiProvider | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
) {
  try {
    let title = "";
    for await (const chunk of streamChatResponse(
      [
        {
          role: "user",
          content:
            "Summarise the following message as a short conversation title — 3 to 6 words, no quotes, no trailing punctuation, plain text:\n\n" +
            firstUserMessage,
        },
      ],
      "",
      "",
      { preferredProvider, maxOutputTokens: 30 },
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
    // Surface a no-op getter call to satisfy the linter that we
    // intentionally read state — keeps the closure stable even if
    // we extend this later to consult more conversation state.
    void get;
  } catch (err) {
    logError("chat:autoTitle:exception", err);
  }
}

/**
 * Ask the AI for 3 follow-up questions to display as chips below an
 * assistant message. Best-effort: any failure is swallowed silently,
 * the user just doesn't see chips. Costs an extra (small) model call
 * per turn — the prompt is tight, the output is capped at 200 tokens.
 *
 * The list is stored in `messageSuggestions` keyed by assistant
 * message id; it's ephemeral, not persisted. Cleared when the user
 * opens a different conversation (the entries become inaccessible
 * because the message ids aren't loaded anymore — keeping them
 * around just bloats the Map).
 */
async function requestFollowupSuggestions(
  assistantMessageId: string,
  userText: string,
  assistantText: string,
  preferredProvider: AiProvider | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
) {
  // Skip if the response was very short / errored — short replies
  // usually don't have meaningful follow-ups, and the leading "⚠"
  // marker is what `sendOrBranch` writes on failure.
  if (assistantText.trim().length < 40) return;
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
      { preferredProvider, maxOutputTokens: 200 },
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

async function sendOrBranch(
  conversationId: string,
  parentId: string | null,
  text: string,
  preferredProvider: AiProvider | undefined,
  attachments: ChatMessageAttachment[] | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
  options?: ChatSendOptions,
) {
  const trimmed = text.trim();

  // Build the per-turn context pack BEFORE inserting the user row so
  // any page-as-image attachments produced by buildAiContextPack
  // (auto-fallback on image PDFs, or the user's explicit toggle) get
  // saved on the message itself — re-streams and branches then pull
  // them right back from the DB without re-rendering. Pre-locate the
  // conversation so we know the source doc id to build for.
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

  // Merge composer attachments + page-render attachments. Page
  // images go first so the model sees the source pages before the
  // user's own uploaded artwork — and so a single screenshot the
  // user picked stays visually adjacent to their question.
  const composerAttachments = attachments ?? [];
  const mergedAttachments = [
    ...contextPack.imageAttachments,
    ...composerAttachments,
  ];

  // A message is valid if it has either text OR at least one
  // attachment — sending just an image with "describe this" worth
  // of intent should work. Empty text + no attachments is a no-op.
  const hasAttachments = mergedAttachments.length > 0;
  if (!trimmed && !hasAttachments) return;

  // 1. Insert the user message.
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

  // Citation hook — when this send was armed with a source selection
  // (see options.citation; AiChatPanel sets this on the first send
  // after a "Send to chat" hand-off), record an AI citation linking
  // the inserted user message back to the originating PDF passage.
  // Best-effort: failures don't block the actual chat turn.
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
        // Pull the new citation into the annotation store so the
        // reader's CitationLayer re-renders without waiting for a
        // doc reopen. Lazy import — annotation-store would loop
        // through chat-store otherwise.
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

  // First message in a fresh conversation — fire an async title
  // request. We don't await it because the user shouldn't have to
  // wait for a name to start chatting; the sidebar updates when
  // the title resolves.
  const conv = get().conversations.find((c) => c.id === conversationId);
  if (parentId === null && conv && !conv.title.trim()) {
    void autoTitleConversation(conversationId, trimmed, preferredProvider, set, get);
  }

  // 2. Build the prompt path from the root up to and including the new user msg.
  // Carry attachments through on each user turn so older messages
  // with images still send their images on a re-stream / branch.
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

  // 3. Insert an empty assistant message we'll stream into.
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

  // 4. Stream the response, accumulating and patching the message.
  // Branch on conversation type:
  //   - target_roadmap_id set → agentic tool-use loop (AI edits roadmap live)
  //   - source_doc_id set     → text stream with doc-title context + the
  //                             user's TOC / page selections built into
  //                             the system prompt
  //   - otherwise             → plain text stream (still picks up the
  //                             custom default context if set)
  // `contextPack` was built at the top of this function (before user
  // msg insert) so image attachments could be saved on the row. The
  // pageContext text + customContext we use here are the same values.
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

  // Fresh controller per turn — `stopStreaming()` aborts whatever's
  // currently in flight, then clears the slot so a follow-up
  // sendMessage starts clean. Cleared in the `finally` below too in
  // case the stream completed normally.
  if (streamAbortController) {
    streamAbortController.abort();
  }
  streamAbortController = new AbortController();
  const signal = streamAbortController.signal;

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
      // Plain-chat "generate a roadmap" skill — auto-detected from the
      // message text. Routes this turn through the Anthropic tool-use
      // path (the only branch wired for tools), builds a fresh roadmap,
      // and links it inline. Normal chat turns never hit this and stay
      // on the cheap auto-route.
      acc = await runRoadmapGenerateLoop(
        promptMessages,
        preferredProvider,
        patchAssistant,
        signal,
      );
    } else {
      // Smooth the on-screen reveal. Providers (and the SSE proxy)
      // often hand us deltas in big bursts — whole sentences or
      // paragraphs — which makes the text pop in chunks. We keep
      // appending raw deltas to `acc` as they land, but a separate
      // rAF "pump" advances what's actually shown a little each frame
      // so it types out smoothly regardless of network chunkiness.
      // The step scales with the backlog, so a large burst drains
      // quickly and the pump always catches up; we await it in the
      // finally so the full text is shown before we persist.
      let revealed = 0;
      let streamDone = false;
      const pump = (async () => {
        while (!signal.aborted) {
          if (revealed < acc.length) {
            const remaining = acc.length - revealed;
            revealed = Math.min(
              acc.length,
              revealed + Math.max(2, Math.ceil(remaining / 6)),
            );
            patchAssistant(acc.slice(0, revealed));
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
            // Per-turn override from the composer's mode picker
            // (e.g. book / video recommendation modes). Skips the
            // standard doc-context system prompt entirely for that
            // turn — `customContext` is still threaded through for
            // any vision / non-streaming code path that ignores the
            // override.
            systemPromptOverride: options?.systemPromptOverride,
            // Reasoning-mode flip: ai-client's OpenAI branch reads
            // this and swaps model to o3-mini. Other branches ignore
            // it so it's safe to forward unconditionally.
            reasoning: options?.reasoning,
          },
        )) {
          acc += chunk.delta;
        }
      } finally {
        // Stop the pump and let it flush the rest of `acc` before we
        // fall through to persistence (the outer finally writes the
        // full text anyway, so an aborted pump never truncates).
        streamDone = true;
        await pump;
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      // User pressed Stop — keep whatever we already streamed; no
      // error message, no log.
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
    // 5. Persist the final content + mark as active leaf.
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

  // Fire-and-forget follow-up suggestion request — runs after the
  // main turn settles, doesn't block the UI, doesn't await. The
  // helper short-circuits on errors / aborted-streams / very-short
  // responses so we don't spend tokens on degenerate cases.
  void requestFollowupSuggestions(
    asstMsg.id,
    trimmed,
    acc,
    preferredProvider,
    set,
  );
}

// ── Pure tree helpers ──────────────────────────────────────

/** Walk from a leaf up to the root and return the chain in root→leaf order. */
export function pathFromRoot(
  messages: Map<string, ChatMessage>,
  leafId: string | null,
): ChatMessage[] {
  const path: ChatMessage[] = [];
  let cur = leafId ? messages.get(leafId) ?? null : null;
  while (cur) {
    path.push(cur);
    cur = cur.parent_message_id
      ? messages.get(cur.parent_message_id) ?? null
      : null;
  }
  return path.reverse();
}

/** Cap the prompt history to the most recent turns. The full
 *  root→leaf path grows without bound as a conversation goes on, and
 *  we re-send the whole thing — text plus any image attachments on
 *  old user turns — on every send, so a long chat keeps re-billing
 *  the same early messages each turn. A reading-assistant chat almost
 *  never needs more than the last several exchanges to stay coherent
 *  (the document context lives in the system prompt, not the
 *  history), so we keep the tail and drop the rest.
 *
 *  Anthropic — and the proxy's Anthropic fallback — require the first
 *  message to be a user turn, so when the cut lands mid-turn on an
 *  assistant reply we drop that leading reply too. */
const MAX_HISTORY_MESSAGES = 16;

export function windowChatHistory<T extends { role: "user" | "assistant" }>(
  msgs: T[],
): T[] {
  if (msgs.length <= MAX_HISTORY_MESSAGES) return msgs;
  let windowed = msgs.slice(-MAX_HISTORY_MESSAGES);
  if (windowed[0]?.role === "assistant") windowed = windowed.slice(1);
  return windowed;
}

/** Given a message id, count the number of direct children it has —
 *  used to render a "N branches" badge. */
export function countBranches(
  messages: Map<string, ChatMessage>,
  messageId: string,
): number {
  let n = 0;
  for (const m of messages.values()) {
    if (m.parent_message_id === messageId) n++;
  }
  return n;
}

/** Return the direct children of a message. */
export function childrenOf(
  messages: Map<string, ChatMessage>,
  messageId: string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages.values()) {
    if (m.parent_message_id === messageId) out.push(m);
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

// ── Roadmap agentic loop ───────────────────────────────────
//
// Runs streamChatWithTools, dispatching each tool_call live against
// useRoadmapStore. After the model finishes a turn with stop_reason
// "tool_use", appends the executed tool_use blocks + their results
// and calls again. Loops until end_turn or the safety cap is hit.
//
// The visible chat content interleaves model text with one bullet
// line per tool call ("✓ Added node n5: ..."), built up in the same
// string the streaming UI is patching, so the user sees edits land
// in real time.

const MAX_AGENTIC_ROUNDS = 8;

async function runRoadmapAgenticLoop(
  roadmapId: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const roadmap = useRoadmapStore.getState().roadmaps.get(roadmapId);
  if (!roadmap) {
    return `⚠ Roadmap not found.`;
  }
  // The label map is rebuilt fresh from the live state so the model
  // sees stable n1..nN labels even if earlier turns added/removed
  // nodes; add_node calls in the current turn extend it in-place.
  const labels = new LabelMap(roadmap.nodes);
  const snapshot = formatRoadmapSnapshot(roadmap, labels);
  const systemPrompt = buildRoadmapEditSystemPrompt(snapshot);
  return runRoadmapToolLoop(
    roadmapId,
    labels,
    systemPrompt,
    history,
    preferredProvider,
    patchAssistant,
    signal,
  );
}

/**
 * Plain-chat "generate a roadmap" skill. Spins up a fresh, empty
 * roadmap, lets the model populate it from scratch via the same tool
 * loop, then appends an inline link to open it. If the model ends up
 * adding nothing (vague request it chose to answer in prose, or an
 * abort before any node landed), the throwaway empty roadmap is rolled
 * back so it doesn't litter the user's roadmap list.
 */
async function runRoadmapGenerateLoop(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const store = useRoadmapStore.getState();
  // Empty title — the model sets a real one via update_roadmap_meta.
  const roadmap = store.createRoadmap("");
  const labels = new LabelMap(roadmap.nodes);
  const systemPrompt = buildRoadmapGenerateSystemPrompt();

  const body = await runRoadmapToolLoop(
    roadmap.id,
    labels,
    systemPrompt,
    history,
    preferredProvider,
    patchAssistant,
    signal,
  );

  const built = useRoadmapStore.getState().roadmaps.get(roadmap.id);
  if (!built || built.nodes.length === 0) {
    // Nothing was built — drop the empty shell and just return prose.
    store.deleteRoadmap(roadmap.id);
    return body;
  }
  // Append an inline link; relative-link clicks are intercepted in the
  // message body and routed through the SPA router.
  return `${body}\n\n**[Open the generated roadmap →](/roadmaps/${roadmap.id}/edit)**`;
}

/**
 * Shared agentic tool loop for both editing an existing roadmap and
 * generating a fresh one — the only differences are the seed roadmap,
 * its label map, and the system prompt, all passed in by the callers.
 */
async function runRoadmapToolLoop(
  roadmapId: string,
  labels: LabelMap,
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const toolMessages: ToolMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let acc = "";
  for (let round = 0; round < MAX_AGENTIC_ROUNDS; round++) {
    const turnBlocks: ContentBlock[] = [];
    const pendingResults: ToolResultBlock[] = [];
    let textBuf = "";
    let stopReason: ToolStopReason = "other";

    const flushText = () => {
      if (textBuf) {
        turnBlocks.push({ type: "text", text: textBuf } as TextBlock);
        textBuf = "";
      }
    };

    for await (const event of streamChatWithTools(toolMessages, {
      systemPrompt,
      tools: ROADMAP_TOOLS,
      maxOutputTokens: 4000,
      preferredProvider,
      signal,
    })) {
      if (event.kind === "text_delta") {
        textBuf += event.text;
        acc += event.text;
        patchAssistant(acc);
      } else if (event.kind === "tool_call") {
        flushText();
        const result = dispatchRoadmapTool(
          event.name,
          event.input,
          roadmapId,
          labels,
        );
        // Insert as a markdown blockquote so the tool-call line
        // renders visually offset from the model's prose. Adjacent
        // blockquote lines collapse into a single quoted block.
        acc += (acc.endsWith("\n\n") || acc === "" ? "" : "\n\n") +
          `> ${result.summary}\n`;
        patchAssistant(acc);
        turnBlocks.push({
          type: "tool_use",
          id: event.id,
          name: event.name,
          input: event.input,
        });
        pendingResults.push({
          type: "tool_result",
          tool_use_id: event.id,
          content: result.modelOutput,
          is_error: !result.ok,
        });
      } else if (event.kind === "stop") {
        flushText();
        stopReason = event.reason;
      }
    }

    if (turnBlocks.length === 0) {
      // Defensive: model returned nothing parseable. Avoid pushing an
      // empty assistant message — the API rejects those.
      break;
    }
    toolMessages.push({ role: "assistant", content: turnBlocks });

    if (stopReason !== "tool_use" || pendingResults.length === 0) break;

    toolMessages.push({ role: "user", content: pendingResults });
    // Visual separator between rounds so the next text block starts
    // on its own line rather than glued to the last bullet.
    if (!acc.endsWith("\n")) acc += "\n";
  }

  return acc.trim() || "(no response)";
}
