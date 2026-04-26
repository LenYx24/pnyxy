import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { streamChatResponse } from "@/lib/ai-client";
import type { AiProvider } from "@/stores/settings-store";
import type {
  ChatConversation,
  ChatFolder,
  ChatMessage,
} from "@/types/chat";

// ── Store ─────────────────────────────────────────────────

/** Hand-off slot for the reader → chat flow. The reader fills this
 *  on "Send to AI chat", navigates the user to /chat, and ChatPage
 *  drains it on mount: creates a fresh conversation tagged with the
 *  source document, prefills the composer with the selected text,
 *  and shows a context pill. */
export interface ChatDraft {
  text: string;
  source: ChatSourceContext;
}

export interface ChatSourceContext {
  docId: string;
  docTitle: string;
  page: number | null;
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

  fetchConversations: () => Promise<void>;
  createConversation: (
    title?: string,
    folderId?: string | null,
    source?: ChatSourceContext | null,
  ) => Promise<string | null>;
  /** Reader-side: stash a draft + source context, then navigate. */
  setPendingDraft: (draft: ChatDraft | null) => void;
  /** ChatPage-side: read & clear in one step (so the next mount
   *  doesn't replay the same draft). */
  consumePendingDraft: () => ChatDraft | null;
  openConversation: (conversationId: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  /** Move a conversation into the given folder, or null to send it
   *  back to the root. */
  moveConversationToFolder: (id: string, folderId: string | null) => Promise<void>;
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
   *  subtree from the user's view via the cycle). */
  moveFolderToParent: (id: string, parentId: string | null) => Promise<void>;

  /** Switch the active leaf without sending anything — used when the
   *  user picks a different branch from the tree. */
  setActiveLeaf: (messageId: string) => Promise<void>;

  /** Append a new user message to the current active leaf, then stream
   *  the assistant's reply. Both are persisted. The optional
   *  `preferredProvider` overrides the saved provider chain order
   *  for this single message — used by the composer's model picker. */
  sendMessage: (text: string, preferredProvider?: AiProvider) => Promise<void>;

  /** Create a new user message whose parent is `parentMessageId` (can
   *  be any message in the conversation — that's the "branch from
   *  here" UX). Then stream the assistant's reply. */
  branchFrom: (
    parentMessageId: string,
    text: string,
    preferredProvider?: AiProvider,
  ) => Promise<void>;
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
        .order("updated_at", { ascending: false });
      if (error) throw error;
      set({ conversations: (data ?? []) as ChatConversation[] });
    } catch (err) {
      logError("chat:fetchConversations", err);
    } finally {
      set({ isLoading: false });
    }
  },

  async createConversation(title = "", folderId = null, source = null) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to use chat.");
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({
        user_id: user.id,
        title,
        folder_id: folderId,
        source_doc_id: source?.docId ?? null,
        source_doc_title: source?.docTitle ?? null,
        source_page: source?.page ?? null,
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

  async sendMessage(text, preferredProvider) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    await sendOrBranch(
      activeConversationId,
      activeLeafId,
      text,
      preferredProvider,
      set,
      get,
    );
  },

  async branchFrom(parentMessageId, text, preferredProvider) {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    await sendOrBranch(
      activeConversationId,
      parentMessageId,
      text,
      preferredProvider,
      set,
      get,
    );
  },

  async moveConversationToFolder(id, folderId) {
    const { error } = await supabase
      .from("chat_conversations")
      .update({ folder_id: folderId })
      .eq("id", id);
    if (error) {
      logError("chat:moveConversation", error);
      throw error;
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, folder_id: folderId } : c,
      ),
    }));
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
      .from("chat_folders")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) {
      // Migration 00029 not applied yet — PostgREST returns 42P01
      // ("relation does not exist") which surfaces as a 404 here.
      // Treat that as "feature not available yet" instead of an
      // error: the rest of the chat keeps working until the user
      // runs `supabase db push`.
      const code = (error as { code?: string }).code;
      const msg = error.message ?? "";
      if (code === "42P01" || /does not exist|chat_folders/i.test(msg)) {
        set({ folders: [] });
        return;
      }
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
    const { data, error } = await supabase
      .from("chat_folders")
      .insert({ user_id: user.id, name: trimmed, parent_id: parentId })
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
      .from("chat_folders")
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
      .from("chat_folders")
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

  async moveFolderToParent(id, parentId) {
    if (id === parentId) return;
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
    const { error } = await supabase
      .from("chat_folders")
      .update({ parent_id: parentId })
      .eq("id", id);
    if (error) {
      logError("chat:moveFolderToParent", error);
      return;
    }
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, parent_id: parentId } : f,
      ),
    }));
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

async function sendOrBranch(
  conversationId: string,
  parentId: string | null,
  text: string,
  preferredProvider: AiProvider | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // 1. Insert the user message.
  const { data: userRow, error: userErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: parentId,
      role: "user",
      content: trimmed,
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

  // First message in a fresh conversation — fire an async title
  // request. We don't await it because the user shouldn't have to
  // wait for a name to start chatting; the sidebar updates when
  // the title resolves.
  const conv = get().conversations.find((c) => c.id === conversationId);
  if (parentId === null && conv && !conv.title.trim()) {
    void autoTitleConversation(conversationId, trimmed, preferredProvider, set, get);
  }

  // 2. Build the prompt path from the root up to and including the new user msg.
  const path = pathFromRoot(get().messages, userMsg.id);
  const promptMessages = path
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

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
  // If the conversation was started from the reader (source set on
  // the row), feed the doc title + a citation-format hint into the
  // system prompt — the page-context is empty because we don't
  // have the live PDF here, but the model still gets enough to
  // ground answers and emit `[p.N]` citations the message renderer
  // turns into clickable links.
  const convForStream = get().conversations.find(
    (c) => c.id === conversationId,
  );
  const sourceTitle = convForStream?.source_doc_title ?? "";
  let acc = "";
  try {
    for await (const chunk of streamChatResponse(
      promptMessages,
      sourceTitle,
      "",
      { preferredProvider },
    )) {
      acc += chunk.delta;
      set((s) => {
        const next = new Map(s.messages);
        const existing = next.get(asstMsg.id);
        if (existing) next.set(asstMsg.id, { ...existing, content: acc });
        return { messages: next };
      });
    }
  } catch (err) {
    logError("chat:sendMessage:stream", err);
    acc =
      acc ||
      `⚠ ${err instanceof Error ? err.message : "Failed to stream response"}`;
  } finally {
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
