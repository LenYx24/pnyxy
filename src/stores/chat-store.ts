/**
 * Chat store: state, conversation CRUD and selectors. The heavier pieces live
 * in their own modules and are wired in here:
 *   - folder actions:            src/stores/chat/chat-folders.ts
 *   - pure tree/fork helpers:    src/stores/chat/chat-tree.ts
 *   - send/stream/abort:         src/lib/ai/chat-stream.ts
 *   - title + follow-up autogen: src/lib/ai/title-autogen.ts
 *   - image-generation turn:     src/lib/ai/chat-image-message.ts
 *   - roadmap tool loop:         src/lib/roadmap/roadmap-agent.ts
 * Everything public is re-exported from this file so import sites stay stable.
 */
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { getUserOrNull, requireUser } from "@/lib/supabase-auth";
import { abortActiveStream, sendOrBranch } from "@/lib/ai/chat-stream";
import { sendImageMessageTurn } from "@/lib/ai/chat-image-message";
import { track } from "@/lib/telemetry";
import { createChatFolderSlice } from "@/stores/chat/chat-folders";
import {
  newestMessage,
  pathFromRoot,
  subtreeIds,
} from "@/stores/chat/chat-tree";
import type { ChatState } from "@/stores/chat/chat-types";
import type { ChatConversation, ChatMessage } from "@/types/chat";

export type {
  ChatDraft,
  ChatSendOptions,
  ChatSourceContext,
  ChatState,
} from "@/stores/chat/chat-types";
export {
  childrenOf,
  countBranches,
  pathFromRoot,
  windowChatHistory,
} from "@/stores/chat/chat-tree";

/** Monotonic id of the latest openConversation call (see its finally). */
let openSeq = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  folders: [],
  messages: new Map(),
  activeConversationId: null,
  activeLeafId: null,
  streamingMessageId: null,
  isLoading: false,
  conversationsError: null,
  threadError: null,
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
    set({ isLoading: true, conversationsError: null });
    try {
      const user = await getUserOrNull();
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
      // best-effort purge of expired incognito chats (24h after creation)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const expired = ((data ?? []) as ChatConversation[]).filter(
        (c) => c.is_temporary && c.created_at < cutoff,
      );
      if (expired.length > 0) {
        void supabase
          .from("chat_conversations")
          .delete()
          .in(
            "id",
            expired.map((c) => c.id),
          )
          .then(({ error: delErr }) => {
            if (delErr) logError("chat:purgeTemporary", delErr);
            else
              set((s) => ({
                conversations: s.conversations.filter(
                  (c) => !expired.some((e) => e.id === c.id),
                ),
              }));
          });
      }
    } catch (err) {
      logError("chat:fetchConversations", err);
      set({ conversationsError: "fetchFailed" });
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
    isTemporary = false,
  ) {
    const user = await requireUser("Sign in to use chat.");
    // Loose "quick" chats are filed under the real, shared "Quick chats" folder
    // so they do not pile up at the library root. Explicit folders are honored.
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
        source_doc_id: source?.docId || null,
        source_doc_title: source?.docTitle ?? null,
        source_page: source?.page ?? null,
        // only sent when set, so plain chats keep working while
        // migration 00074 is not applied yet
        ...(source?.resourceId
          ? { source_resource_id: source.resourceId }
          : {}),
        target_roadmap_id: target?.roadmapId ?? null,
        target_quiz_id: target?.quizId ?? null,
        parent_conversation_id: parentConversationId,
        // only sent when set, so plain chats keep working while
        // migration 00068 is not applied yet
        ...(isTemporary ? { is_temporary: true } : {}),
      })
      .select()
      .single();
    if (error || !data) {
      logError("chat:createConversation", error);
      throw error ?? new Error("Could not create conversation.");
    }
    // Fully seeds the active-conversation state (empty thread), so callers do
    // not need a redundant openConversation round-trip after creating.
    set((s) => ({
      conversations: [data as ChatConversation, ...s.conversations],
      activeConversationId: data.id as string,
      messages: new Map(),
      activeLeafId: null,
      messageSuggestions: new Map(),
      // a fresh conversation has nothing to load; also cancels the flag an
      // in-flight openConversation (auto-open racing the "+" button) set
      isLoading: false,
    }));
    return data.id as string;
  },

  async openConversation(conversationId) {
    const seq = ++openSeq;
    set({
      activeConversationId: conversationId,
      messages: new Map(),
      activeLeafId: null,
      // suggestion keys are ids from the previous conversation
      messageSuggestions: new Map(),
      isLoading: true,
      threadError: null,
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
      const leafId =
        conv.active_leaf_id && map.has(conv.active_leaf_id as string)
          ? (conv.active_leaf_id as string)
          : newestMessage(map)?.id ?? null;

      // The user may have switched (or created a new) conversation while
      // the fetch was in flight; never write stale messages over it.
      if (get().activeConversationId !== conversationId) return;
      // Same conversation, but the user may have already sent a message
      // while this fetch was in flight (fresh conversation + fast typing:
      // the URL-sync open races the optimistic send). Merge instead of
      // replacing, local-only messages are newer than the snapshot.
      const local = get().messages;
      const merged = map;
      for (const [id, m] of local) {
        if (!merged.has(id)) merged.set(id, m);
      }
      const localLeaf = get().activeLeafId;
      set({
        messages: merged,
        activeLeafId:
          localLeaf && merged.has(localLeaf) ? localLeaf : leafId,
      });
    } catch (err) {
      logError("chat:openConversation", err);
      if (seq === openSeq) set({ threadError: "openFailed" });
    } finally {
      // Only the newest open owns the flag. The old "still the active
      // conversation" check left isLoading stuck at true when a new chat
      // was created mid-fetch (the "+" CTA racing the auto-open), which
      // pinned the thread's settling spinner until a reload.
      if (seq === openSeq) set({ isLoading: false });
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

    // no ON DELETE CASCADE on the self-FK, so every id in the subtree is deleted explicitly
    const ids = subtreeIds(messages, messageId);
    const toDelete = new Set(ids);
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

    // persist the new leaf so a reload does not reset to the deleted tip
    const { activeConversationId, activeLeafId } = get();
    if (activeConversationId) {
      await supabase
        .from("chat_conversations")
        .update({ active_leaf_id: activeLeafId })
        .eq("id", activeConversationId);
    }
  },

  async duplicateFromMessage(fromMessageId, title) {
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
    const newTitle =
      title ?? (source.title ? `${source.title} (copy)` : "(copy)");
    const newId = await get().createConversation(
      newTitle,
      source.folder_id,
      source.source_doc_id || source.source_resource_id
        ? {
            docId: source.source_doc_id ?? "",
            docTitle: source.source_doc_title ?? "",
            page: source.source_page ?? null,
            resourceId: source.source_resource_id ?? null,
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
      // carry the error field over too, best-effort: migration 00071 may not
      // be applied everywhere yet, so a missing-column failure here must not
      // fail the whole duplicate (the copy already has its content).
      if (m.error) {
        const { error: errFieldErr } = await supabase
          .from("chat_messages")
          .update({ error: m.error })
          .eq("id", data.id);
        if (errFieldErr) logError("chat:duplicateFromMessage:errorField", errFieldErr);
      }
    }

    track("fork_create");
    // land on the copy of the forked-from message; the same id marks the
    // fork point for the thread's divider. Fall back without the fork
    // column when migration 00061 hasn't been applied yet.
    const newLeaf = idMap.get(fromMessageId) ?? null;
    if (newLeaf) {
      const { error: markErr } = await supabase
        .from("chat_conversations")
        .update({ active_leaf_id: newLeaf, forked_from_message_id: newLeaf })
        .eq("id", newId);
      if (markErr) {
        await supabase
          .from("chat_conversations")
          .update({ active_leaf_id: newLeaf })
          .eq("id", newId);
      } else {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === newId ? { ...c, forked_from_message_id: newLeaf } : c,
          ),
        }));
      }
    }

    await get().openConversation(newId);
    return newId;
  },

  async setConversationArchived(id, archived) {
    const archived_at = archived ? new Date().toISOString() : null;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, archived_at } : c,
      ),
      // an archived conversation leaves the screen too
      ...(archived && s.activeConversationId === id
        ? { activeConversationId: null, messages: new Map(), activeLeafId: null }
        : {}),
    }));
    const { error } = await supabase
      .from("chat_conversations")
      .update({ archived_at })
      .eq("id", id);
    if (error) logError("chat:setConversationArchived", error);
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

  async linkConversationToResource(conversationId, resourceId) {
    const { error } = await supabase
      .from("chat_conversations")
      .update({ source_resource_id: resourceId })
      .eq("id", conversationId);
    if (error) {
      logError("chat:linkConversationToResource", error);
      throw error;
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, source_resource_id: resourceId } : c,
      ),
    }));
  },

  async sendMessage(text, preferredProvider, attachments, options) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    // chat_send telemetry fires once, inside sendOrBranch (the single send entry)
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
    abortActiveStream();
  },

  async sendImageMessage(prompt) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    await sendImageMessageTurn(activeConversationId, activeLeafId, prompt, set);
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

  reset() {
    set({
      conversations: [],
      folders: [],
      messages: new Map(),
      activeConversationId: null,
      activeLeafId: null,
      streamingMessageId: null,
      isLoading: false,
      pendingDraft: null,
      messageSuggestions: new Map(),
    });
  },

  ...createChatFolderSlice(set, get),
}));
