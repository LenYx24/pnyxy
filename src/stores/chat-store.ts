import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { ChatConversation, ChatMessage } from "@/types/chat";

// ── Streaming helpers ──────────────────────────────────────

/** Parse the Anthropic-style SSE we get from chat-proxy (same shape
 *  ai-client uses), yielding text deltas. */
async function* parseSseDeltas(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data);
          if (
            event?.type === "content_block_delta" &&
            typeof event?.delta?.text === "string"
          ) {
            yield event.delta.text as string;
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function proxyChat(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
): Promise<ReadableStream<Uint8Array> | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-proxy`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`chat-proxy ${res.status}: ${txt || res.statusText}`);
  }
  return res.body;
}

// ── Store ─────────────────────────────────────────────────

interface ChatState {
  conversations: ChatConversation[];
  /** All messages for the currently-opened conversation, keyed by id. */
  messages: Map<string, ChatMessage>;
  activeConversationId: string | null;
  /** The leaf the user is currently "at" — messages upstream of this
   *  are the visible thread. */
  activeLeafId: string | null;
  /** True while the assistant is streaming its reply into a message. */
  streamingMessageId: string | null;
  isLoading: boolean;

  fetchConversations: () => Promise<void>;
  createConversation: (title?: string) => Promise<string | null>;
  openConversation: (conversationId: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  clearActive: () => void;

  /** Switch the active leaf without sending anything — used when the
   *  user picks a different branch from the tree. */
  setActiveLeaf: (messageId: string) => Promise<void>;

  /** Append a new user message to the current active leaf, then stream
   *  the assistant's reply. Both are persisted. */
  sendMessage: (text: string) => Promise<void>;

  /** Create a new user message whose parent is `parentMessageId` (can
   *  be any message in the conversation — that's the "branch from
   *  here" UX). Then stream the assistant's reply. */
  branchFrom: (parentMessageId: string, text: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messages: new Map(),
  activeConversationId: null,
  activeLeafId: null,
  streamingMessageId: null,
  isLoading: false,

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

  async createConversation(title = "") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to use chat.");
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ user_id: user.id, title })
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

  async sendMessage(text) {
    const { activeConversationId, activeLeafId } = get();
    if (!activeConversationId) return;
    await sendOrBranch(activeConversationId, activeLeafId, text, set, get);
  },

  async branchFrom(parentMessageId, text) {
    const { activeConversationId } = get();
    if (!activeConversationId) return;
    await sendOrBranch(activeConversationId, parentMessageId, text, set, get);
  },
}));

// ── Shared send implementation ─────────────────────────────

async function sendOrBranch(
  conversationId: string,
  parentId: string | null,
  text: string,
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
  let acc = "";
  try {
    const stream = await proxyChat(promptMessages);
    if (!stream) throw new Error("No stream returned");
    for await (const delta of parseSseDeltas(stream)) {
      acc += delta;
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
