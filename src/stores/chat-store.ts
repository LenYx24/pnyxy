import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import i18n from "@/lib/i18n";
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

/** Hand-off slot for reader/editor -> chat. Filled then /chat drains it on mount. */
export interface ChatDraft {
  text: string;
  source?: ChatSourceContext | null;
  target?: { roadmapId?: string | null; quizId?: string | null } | null;
  /** When set, arms a citation saved once the draft is sent. */
  selection?: import("@/types/annotation").TextSelection | null;
}

export interface ChatSourceContext {
  docId: string;
  docTitle: string;
  page: number | null;
}

/** Per-send overrides. */
export interface ChatSendOptions {
  systemPromptOverride?: string;
  /** Routes through OpenAI o3-mini; ignored by other providers. */
  reasoning?: boolean;
  /** Records the user message in ai_citations so the reader can underline the passage. */
  citation?: {
    documentId: string;
    selection: import("@/types/annotation").TextSelection;
  };
}

interface ChatState {
  conversations: ChatConversation[];
  folders: ChatFolder[];
  /** Messages for the open conversation, keyed by id. */
  messages: Map<string, ChatMessage>;
  activeConversationId: string | null;
  /** Current leaf; messages upstream of it are the visible thread. */
  activeLeafId: string | null;
  streamingMessageId: string | null;
  isLoading: boolean;
  pendingDraft: ChatDraft | null;
  /** Follow-up chips per assistant message. Ephemeral, cleared on openConversation. */
  messageSuggestions: Map<string, string[]>;

  fetchConversations: () => Promise<void>;
  createConversation: (
    title?: string,
    folderId?: string | null,
    source?: ChatSourceContext | null,
    /** Ties the conversation to an editable artifact for AI tool-use. */
    target?: { roadmapId?: string | null; quizId?: string | null } | null,
    /** Fork lineage: the conversation this one was branched from. */
    parentConversationId?: string | null,
  ) => Promise<string | null>;
  setPendingDraft: (draft: ChatDraft | null) => void;
  /** Read and clear in one step so the next mount doesn't replay it. */
  consumePendingDraft: () => ChatDraft | null;
  openConversation: (conversationId: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  /** Delete a message and its whole subtree; leaf rewinds to parent if inside it. */
  deleteMessage: (messageId: string) => Promise<void>;
  /** Fork the conversation from `fromMessageId` (inclusive) into a new one. */
  duplicateFromMessage: (fromMessageId: string) => Promise<string | null>;
  /** Move a conversation to a folder (null = root); sortOrder pins position. */
  moveConversationToFolder: (
    id: string,
    folderId: string | null,
    sortOrder?: number,
  ) => Promise<void>;
  /** Same-folder reorder. Optimistic, rolls back on error. */
  reorderConversation: (id: string, sortOrder: number) => Promise<void>;
  clearActive: () => void;

  // Folders
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<string | null>;
  /** Find-or-create the shared "Quick chats" folder loose chats default into. */
  ensureQuickChatsFolder: (
    parentId?: string | null,
  ) => Promise<string | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** Deletes folder + subfolders; conversations fall back to root via FK set null. */
  deleteFolder: (id: string) => Promise<void>;
  /** Reparent a folder (null = top-level). Refuses to make a folder its own descendant. */
  moveFolderToParent: (
    id: string,
    parentId: string | null,
    sortOrder?: number,
  ) => Promise<void>;
  /** Same-parent reorder. Optimistic, rolls back on error. */
  reorderFolder: (id: string, sortOrder: number) => Promise<void>;

  /** Switch the active leaf without sending, for branch picking. */
  setActiveLeaf: (messageId: string) => Promise<void>;

  /** Append a user message to the active leaf then stream the reply. */
  sendMessage: (
    text: string,
    preferredProvider?: AiProvider,
    attachments?: ChatMessageAttachment[],
    options?: ChatSendOptions,
  ) => Promise<void>;

  /** New user message under `parentMessageId` (null = root branch), then stream reply. */
  branchFrom: (
    parentMessageId: string | null,
    text: string,
    preferredProvider?: AiProvider,
    attachments?: ChatMessageAttachment[],
    options?: ChatSendOptions,
  ) => Promise<void>;

  /** Cancel the in-flight stream, keeping the partial reply. */
  stopStreaming: () => void;

  /** Routes the prompt through the Images API; reply carries the PNG as a base64 attachment. */
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
        // sort_order primary, updated_at tiebreaker
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

  async createConversation(
    title = "",
    folderId = null,
    source = null,
    target = null,
    parentConversationId = null,
  ) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to use chat.");
    // Loose "quick" chats get filed under a real, shared "Quick chats" folder
    // so they don't pile up at the library root. Explicit folders are honored.
    let effectiveFolderId = folderId;
    if (effectiveFolderId == null) {
      effectiveFolderId = await get().ensureQuickChatsFolder();
    }
    // min(siblings) - 1 lands at top without renumbering or colliding with a concurrent create
    const siblingSorts = get()
      .conversations.filter((c) => c.folder_id === effectiveFolderId)
      .map((c) => c.sort_order);
    const sortOrder =
      siblingSorts.length > 0 ? Math.min(...siblingSorts) - 1 : 0;
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({
        user_id: user.id,
        title,
        folder_id: effectiveFolderId,
        sort_order: sortOrder,
        source_doc_id: source?.docId ?? null,
        source_doc_title: source?.docTitle ?? null,
        source_page: source?.page ?? null,
        target_roadmap_id: target?.roadmapId ?? null,
        target_quiz_id: target?.quizId ?? null,
        parent_conversation_id: parentConversationId,
      })
      .select()
      .single();
    if (error || !data) {
      logError("chat:createConversation", error);
      throw error ?? new Error("Could not create conversation.");
    }
    // fully seeds the active-conversation state (empty thread), so callers don't
    // need a redundant openConversation round-trip after creating.
    set((s) => ({
      conversations: [data as ChatConversation, ...s.conversations],
      activeConversationId: data.id as string,
      messages: new Map(),
      activeLeafId: null,
      messageSuggestions: new Map(),
    }));
    return data.id as string;
  },

  async openConversation(conversationId) {
    set({
      activeConversationId: conversationId,
      messages: new Map(),
      activeLeafId: null,
      // suggestion keys are ids from the previous conversation
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

      // stored active_leaf_id if valid, else newest message
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

    // no ON DELETE CASCADE on the self-FK, so BFS the subtree and delete every id explicitly
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
      // rewind to target's parent if the active leaf was in the deleted subtree
      const leafGone =
        s.activeLeafId !== null && toDelete.has(s.activeLeafId);
      const nextLeaf = leafGone ? target.parent_message_id ?? null : s.activeLeafId;
      return { messages: next, activeLeafId: nextLeaf };
    });

    // persist the new leaf so a reload doesn't reset to the deleted tip
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

    // root->target path becomes the prefix of the new conversation
    const path = pathFromRoot(state.messages, fromMessageId);
    const source = state.conversations.find(
      (c) => c.id === state.activeConversationId,
    );
    if (!source) return null;

    // new conversation keeps the source's folder + doc context
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
      // Record the fork so the graph shows this as a child of `source`.
      source.id,
    );
    if (!newId) return null;

    // re-insert the path, rewiring each parent_message_id to the copied parent's fresh id
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
        // clean up the half-built duplicate
        await supabase.from("chat_conversations").delete().eq("id", newId);
        throw error;
      }
      idMap.set(m.id, data.id);
    }

    // land on the copy of the forked-from message
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
    // controller is module-scoped so it survives state replacements; abort() makes
    // sendOrBranch catch AbortError and persist whatever streamed so far
    streamAbortController?.abort();
    streamAbortController = null;
  },

  async sendImageMessage(prompt) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // 1. insert the user message
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

    // 2. placeholder assistant message; streamingMessageId keeps the typing indicator up
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
  },

  async moveConversationToFolder(id, folderId, sortOrder) {
    // skip the round-trip on a drop onto the current folder with no sort change
    const current = get().conversations.find((c) => c.id === id);
    if (!current) return;
    const folderUnchanged = current.folder_id === folderId;
    const sortUnchanged =
      sortOrder === undefined || current.sort_order === sortOrder;
    if (folderUnchanged && sortUnchanged) return;
    // optimistic patch, rolls back on error
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

  // Folders

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
      // sort_order asc, created_at tiebreaker
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
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
    // folders.org_id is NOT NULL, so the insert must carry the active org
    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      logError("chat:createFolder", "No active organization");
      return null;
    }
    // min(siblings) - 1 so new folders land at the top of their parent
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

  async ensureQuickChatsFolder(parentId = null) {
    const name = i18n.t("chat.sidebar.quickChats", {
      defaultValue: "Quick chats",
    });
    const matches = (f: ChatFolder) =>
      f.parent_id === parentId &&
      f.name.trim().toLowerCase() === name.trim().toLowerCase();
    const existing = get().folders.find(matches);
    if (existing) return existing.id;
    // folders may not be loaded yet (e.g. a reader-panel quick chat); refresh
    // and re-check so we don't create a duplicate.
    await get().fetchFolders();
    const rechecked = get().folders.find(matches);
    if (rechecked) return rechecked.id;
    const id = await get().createFolder(name, parentId);
    if (!id) return null;
    // one-time migration: sweep every currently-loose conversation into it so
    // the library root stops filling up with chats. Only for the shared
    // (root) Quick chats folder, per-folder ones start empty.
    if (parentId === null) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error } = await supabase
          .from("chat_conversations")
          .update({ folder_id: id })
          .eq("user_id", user.id)
          .is("folder_id", null);
        if (error) logError("chat:ensureQuickChatsFolder:sweep", error);
        else await get().fetchConversations();
      }
    }
    return id;
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
    // server cascaded subfolders + nulled conversations, refresh both
    await Promise.all([get().fetchFolders(), get().fetchConversations()]);
  },

  async moveFolderToParent(id, parentId, sortOrder) {
    if (id === parentId) return;
    // skip a drop onto the current parent with no sort change
    const current = get().folders.find((f) => f.id === id);
    if (!current) return;
    const parentUnchanged = current.parent_id === parentId;
    const sortUnchanged =
      sortOrder === undefined || current.sort_order === sortOrder;
    if (parentUnchanged && sortUnchanged) return;
    // cycle guard: bail if `id` is an ancestor of the new parent
    if (parentId !== null) {
      const folders = get().folders;
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === id) return;
        const next: ChatFolder | undefined = folders.find((f) => f.id === cursor);
        cursor = next?.parent_id ?? null;
      }
    }
    // optimistic patch, rolls back on error
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

// In-flight stream's AbortController. Module-scoped (not store state) so Zustand
// doesn't serialize it; stopStreaming reads it imperatively.
let streamAbortController: AbortController | null = null;

/** Ask the AI for a short title and apply it. Only on the first message of an untitled conv. */
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
            "Summarise the following message as a short conversation title, 3 to 6 words, no quotes, no trailing punctuation, plain text:\n\n" +
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
    void get; // keep param referenced for the linter

  } catch (err) {
    logError("chat:autoTitle:exception", err);
  }
}

/** Ask the AI for 3 follow-up chips below an assistant message. Ephemeral, not persisted. */
async function requestFollowupSuggestions(
  assistantMessageId: string,
  userText: string,
  assistantText: string,
  preferredProvider: AiProvider | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
) {
  // skip very short / errored replies ("⚠" marks a failure)
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

  // Build the context pack before inserting the user row so page-as-image attachments
  // get saved on the message; re-streams/branches then pull them from the DB.
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
        // lazy import to avoid a chat-store <-> annotation-store cycle
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
    void autoTitleConversation(conversationId, trimmed, preferredProvider, set, get);
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
  // pump is awaited before we return the final string. Returns the full text.
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
      // through the tool-use path (only branch wired for tools) and links the result inline.
      // Auto-detect is a best-guess: if the tool path is unavailable (e.g. the
      // server has no Anthropic key and the loop 501s), degrade gracefully to a
      // normal chat answer rather than leaving a ⚠ dead-end.
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
      // user pressed Stop, keep whatever already streamed
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
    // Empty-response guard: if the model streamed nothing (and the user didn't
    // abort), swap in a friendly notice so we never persist a blank bubble.
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

/** Walk from a leaf up to the root, returned in root->leaf order. */
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

// Cap prompt history to the most recent turns; the whole path is re-sent each turn so an
// unbounded history keeps re-billing early messages (doc context lives in the system prompt).
// Anthropic requires the first message to be a user turn, so drop a leading assistant reply.
const MAX_HISTORY_MESSAGES = 16;

export function windowChatHistory<T extends { role: "user" | "assistant" }>(
  msgs: T[],
): T[] {
  if (msgs.length <= MAX_HISTORY_MESSAGES) return msgs;
  let windowed = msgs.slice(-MAX_HISTORY_MESSAGES);
  if (windowed[0]?.role === "assistant") windowed = windowed.slice(1);
  return windowed;
}

/** Count direct children of a message, for the "N branches" badge. */
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

// Runs streamChatWithTools, dispatching each tool_call live against useRoadmapStore. On a
// "tool_use" stop it appends the tool_use blocks + results and calls again, until end_turn
// or the safety cap. Visible content interleaves model text with one bullet per tool call.
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
  // rebuilt from live state so the model sees stable n1..nN labels; add_node extends it in-place
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
 * "generate a roadmap" skill: create an empty roadmap, populate it via the tool loop, and
 * append an inline link. If nothing gets added, the empty shell is rolled back.
 */
async function runRoadmapGenerateLoop(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const store = useRoadmapStore.getState();
  // empty title; the model sets a real one via update_roadmap_meta
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
    // nothing was built, drop the empty shell and return prose
    store.deleteRoadmap(roadmap.id);
    return body;
  }
  // relative-link clicks in the message body are routed through the SPA router
  return `${body}\n\n**[Open the generated roadmap →](/roadmaps/${roadmap.id}/edit)**`;
}

/** Shared tool loop for editing and generating; callers pass the seed roadmap, labels, prompt. */
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
        // markdown blockquote so the tool-call line renders offset from the model's prose
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
      // model returned nothing parseable; the API rejects empty assistant messages
      break;
    }
    toolMessages.push({ role: "assistant", content: turnBlocks });

    if (stopReason !== "tool_use" || pendingResults.length === 0) break;

    toolMessages.push({ role: "user", content: pendingResults });
    // separator so the next round's text starts on its own line
    if (!acc.endsWith("\n")) acc += "\n";
  }

  return acc.trim() || "(no response)";
}
