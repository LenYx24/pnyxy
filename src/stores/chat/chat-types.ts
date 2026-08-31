import type { AiProvider } from "@/stores/settings-store";
import type { VideoContext } from "@/lib/ai/ai-client";
import type { TextSelection } from "@/types/annotation";
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
  selection?: TextSelection | null;
  /** Library folder the new conversation is created in (course hand-off);
   *  the sidebar drills into it so the course's resources are in view. */
  folderId?: string | null;
  /** Send `text` as the first message right away instead of prefilling
   *  the composer (course "Start learning": the context turn is the app's,
   *  the student's first real question comes after the model's reply). */
  autoSend?: boolean;
}

export interface ChatSourceContext {
  /** Reader document id; empty string when the source is a resource. */
  docId: string;
  docTitle: string;
  page: number | null;
  /** Library resource (YouTube video) the chat was opened from (00074). */
  resourceId?: string | null;
}

/** Where a chat turn is sent from, for telemetry only. Derived from the
 *  conversation's `source_doc_id` when absent (book vs plain chat); the
 *  whiteboard panel and the course "Start learning" seed pass it explicitly
 *  since those two aren't distinguishable from conversation fields alone. */
export type ChatSendScope = "chat" | "book" | "course" | "whiteboard" | "video" | "library";

/** Per-send overrides. */
export interface ChatSendOptions {
  systemPromptOverride?: string;
  /** Telemetry only, see `ChatSendScope`. */
  scope?: ChatSendScope;
  /** Routes through OpenAI o3-mini; ignored by other providers. */
  reasoning?: boolean;
  /** Pnyxy-route model pin for THIS turn ("retry with another model"). */
  pnyxyModelOverride?: string;
  /** Records the user message in ai_citations so the reader can underline the passage. */
  citation?: {
    documentId: string;
    selection: TextSelection;
  };
  /** Direct-video mode: the proxy hands this YouTube clip to Gemini. */
  videoContext?: VideoContext;
  /** Web search for this turn (composer toggle). */
  webSearch?: boolean;
  /** "Organize library" composer mode: route the turn through the
   *  library tool loop (create folders / move items / start chats, each
   *  behind the user's approval card). */
  libraryTools?: boolean;
  /** Extra situational line for the library tool loop's system prompt
   *  (e.g. which resource the user is looking at). */
  libraryToolsContext?: string;
}

export interface ChatState {
  conversations: ChatConversation[];
  folders: ChatFolder[];
  /** Messages for the open conversation, keyed by id. */
  messages: Map<string, ChatMessage>;
  activeConversationId: string | null;
  /** Current leaf; messages upstream of it are the visible thread. */
  activeLeafId: string | null;
  streamingMessageId: string | null;
  isLoading: boolean;
  /** Set when the last fetchConversations call failed; cleared on the next attempt. */
  conversationsError: string | null;
  /** Set when the last openConversation call failed; cleared on the next attempt. */
  threadError: string | null;
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
    isTemporary?: boolean,
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
  duplicateFromMessage: (
    fromMessageId: string,
    title?: string,
  ) => Promise<string | null>;
  /** Move a conversation to a folder (null = root); sortOrder pins position. */
  moveConversationToFolder: (
    id: string,
    folderId: string | null,
    sortOrder?: number,
  ) => Promise<void>;
  /** Same-folder reorder. Optimistic, rolls back on error. */
  reorderConversation: (id: string, sortOrder: number) => Promise<void>;
  /** Archive / restore a conversation (hidden from the main lists). */
  setConversationArchived: (id: string, archived: boolean) => Promise<void>;
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

  /** Tie an existing conversation to a library resource (the "save this
   *  link" card in a quick chat): the resource viewer's side-chat then
   *  resumes this thread. */
  linkConversationToResource: (
    conversationId: string,
    resourceId: string,
  ) => Promise<void>;

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

  /** Full in-memory wipe (conversations, folders, active thread). Called
   *  on sign-out so the next account on this browser starts clean. */
  reset: () => void;
}

/** Zustand `set`, as handed to the chat modules living outside the store file. */
export type ChatSet = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;
/** Zustand `get`. */
export type ChatGet = () => ChatState;
