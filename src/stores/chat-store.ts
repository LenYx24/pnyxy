import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import {
  streamChatResponse,
  streamChatWithTools,
  type ContentBlock,
  type TextBlock,
  type ToolMessage,
  type ToolResultBlock,
  type ToolStopReason,
} from "@/lib/ai-client";
import {
  ROADMAP_TOOLS,
  LabelMap,
  formatRoadmapSnapshot,
  buildRoadmapEditSystemPrompt,
  dispatchRoadmapTool,
} from "@/lib/roadmap-tools";
import { useRoadmapStore } from "@/stores/roadmap-store";
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
   *  for this single message — used by the composer's model picker.
   *  `attachments` are stored alongside the user message and sent as
   *  multimodal content to providers that support vision. */
  sendMessage: (
    text: string,
    preferredProvider?: AiProvider,
    attachments?: ChatMessageAttachment[],
  ) => Promise<void>;

  /** Create a new user message whose parent is `parentMessageId` (can
   *  be any message in the conversation — that's the "branch from
   *  here" UX). Then stream the assistant's reply. */
  branchFrom: (
    parentMessageId: string,
    text: string,
    preferredProvider?: AiProvider,
    attachments?: ChatMessageAttachment[],
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

  async createConversation(title = "", folderId = null, source = null, target = null) {
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

  async sendMessage(text, preferredProvider, attachments) {
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
    );
  },

  async branchFrom(parentMessageId, text, preferredProvider, attachments) {
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
  attachments: ChatMessageAttachment[] | undefined,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  get: () => ChatState,
) {
  const trimmed = text.trim();
  // A message is valid if it has either text OR at least one
  // attachment — sending just an image with "describe this" worth
  // of intent should work. Empty text + no attachments is a no-op.
  const hasAttachments = !!attachments && attachments.length > 0;
  if (!trimmed && !hasAttachments) return;

  // 1. Insert the user message.
  const { data: userRow, error: userErr } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: parentId,
      role: "user",
      content: trimmed,
      attachments: hasAttachments ? attachments : null,
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
  // Carry attachments through on each user turn so older messages
  // with images still send their images on a re-stream / branch.
  const path = pathFromRoot(get().messages, userMsg.id);
  const promptMessages = path
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      attachments: m.attachments ?? undefined,
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
  // Branch on conversation type:
  //   - target_roadmap_id set → agentic tool-use loop (AI edits roadmap live)
  //   - source_doc_id set     → text stream with doc-title context for [p.N] citations
  //   - otherwise             → plain text stream
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

  let acc = "";
  try {
    if (targetRoadmapId) {
      acc = await runRoadmapAgenticLoop(
        targetRoadmapId,
        promptMessages,
        preferredProvider,
        patchAssistant,
      );
    } else {
      for await (const chunk of streamChatResponse(
        promptMessages,
        sourceTitle,
        "",
        { preferredProvider },
      )) {
        acc += chunk.delta;
        patchAssistant(acc);
      }
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
