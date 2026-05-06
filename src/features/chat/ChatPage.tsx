import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  MessagesSquare,
  Plus,
  Send,
  Loader2,
  GitBranch,
  Trash2,
  Pencil,
  X,
  Check,
  ChevronRight,
  ChevronDown,
  Mic,
  MicOff,
  FolderPlus,
  Folder as FolderIcon,
  FolderInput,
  BookOpen,
  Sparkles,
  History,
  Map as MapIcon,
  Bot,
  Paperclip,
  Image as ImageIcon,
  Copy,
} from "lucide-react";
import { ConfirmModal, FloatingMenu, PromptModal } from "@/components/ui";
import { useConfirm } from "@/hooks/use-confirm";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { restrictToWindowEdges } from "@/lib/dnd-modifiers";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import {
  useChatStore,
  pathFromRoot,
  countBranches,
  childrenOf,
} from "@/stores/chat-store";
import { useRoadmap, useRoadmapStore } from "@/stores/roadmap-store";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { getConfiguredProviders } from "@/lib/ai-client";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import {
  fetchRecentReading,
  formatReadingContextPrompt,
} from "@/lib/reading-context";
import { SaveAsFlashcardsModal } from "./SaveAsFlashcardsModal";
import type { ChatMessage, ChatMessageAttachment } from "@/types/chat";

// Composer attachment limits — enforced client-side, mirrored
// roughly by Anthropic's per-request payload cap. Image-only for
// v1; PDF / text upload would need server-side extraction or
// provider-native file uploads, both deferred.
//
// Two limits: Default mode (free Pnyxy quota) caps to 1 image so
// per-message cost stays predictable on the budget side. Direct
// keys (Anthropic / OpenAI) — the user's own billing — go up to 4.
const MAX_ATTACHMENTS_DIRECT = 4;
const MAX_ATTACHMENTS_DEFAULT = 1;
const MAX_ATTACHMENT_MB = 5;
const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Read a File as a base64 string (no data: prefix). FileReader is
 * the safe path — building base64 from `Uint8Array` + btoa breaks
 * for files larger than the JS argument-count limit.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      // result is "data:image/png;base64,..." — strip the prefix.
      const idx = result.indexOf(",");
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * UI labels for each routing destination. The model name is the
 * primary line; the subtitle says how it's billed (Pnyxy free
 * quota vs the user's own API key) so it's clear what's happening
 * underneath. Models are hard-coded here today and synced manually
 * with the upstream calls in ai-client.ts / ai-chat-proxy/index.ts.
 */
const PROVIDER_INFO: Record<AiProvider, { model: string; routing: string }> = {
  pnyxy: { model: "Claude Haiku 4.5", routing: "Pnyxy free quota" },
  anthropic: { model: "Claude Sonnet 4.5", routing: "Your Anthropic key" },
  openai: { model: "GPT-4o mini", routing: "Your OpenAI key" },
};

// Render assistant markdown to sanitized HTML. Same pattern as
// `forum/CommentThread.tsx` — `marked` parses, DOMPurify strips
// anything dangerous before it lands in `dangerouslySetInnerHTML`.
// Tables / code blocks / headings / lists / inline code all come
// from `marked`'s GFM defaults; the prose styling below makes them
// look right inside a chat bubble.
function renderMarkdown(md: string, sourceDocId: string | null): string {
  // Citation pre-pass: when the conversation knows which document
  // it's about, rewrite the model's `[p.42]` tokens into proper
  // markdown links to /reader/<docId>?page=42 *before* marked sees
  // them. marked then turns them into anchors; DOMPurify keeps the
  // anchor element + the (relative) href but strips anything
  // dangerous. Conversations without a source doc skip this and
  // render the citations as plain text.
  const withCitations = sourceDocId
    ? md.replace(
        /\[(p\.?\s?(\d+))\]/g,
        (_match, label, page) =>
          `[${label}](/reader/${sourceDocId}?page=${page})`,
      )
    : md;
  return DOMPurify.sanitize(marked.parse(withCitations, { async: false }) as string);
}

export function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeConversationId);
  const activeLeafId = useChatStore((s) => s.activeLeafId);
  const messages = useChatStore((s) => s.messages);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const isLoading = useChatStore((s) => s.isLoading);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const openConversation = useChatStore((s) => s.openConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const { confirm, ConfirmModalElement } = useConfirm();
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: t("chat.deleteConfirmTitle"),
        body: t("chat.deleteConfirmBody"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (ok) void deleteConversation(id);
    },
    [confirm, deleteConversation, t],
  );
  const renameConversation = useChatStore((s) => s.renameConversation);
  const moveConversationToFolder = useChatStore((s) => s.moveConversationToFolder);
  const clearActive = useChatStore((s) => s.clearActive);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const branchFrom = useChatStore((s) => s.branchFrom);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);
  const folders = useChatStore((s) => s.folders);
  const fetchFolders = useChatStore((s) => s.fetchFolders);
  const createFolder = useChatStore((s) => s.createFolder);
  const renameFolder = useChatStore((s) => s.renameFolder);
  const deleteFolder = useChatStore((s) => s.deleteFolder);
  const moveFolderToParent = useChatStore((s) => s.moveFolderToParent);

  // Drag-and-drop sensors. Pointer for mouse, Touch with a delay so
  // a regular tap on a conversation still opens it instead of
  // dragging on the first finger move, Keyboard for accessibility.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    // Move targets are encoded into droppable ids:
    //   nest:<folderId>  → drop INTO this folder
    //   root             → drop at the top level
    const intoFolderId = overId === "root"
      ? null
      : overId.startsWith("nest:")
        ? overId.slice("nest:".length)
        : undefined;
    if (intoFolderId === undefined) return;

    if (activeId.startsWith("conv:")) {
      const id = activeId.slice("conv:".length);
      void moveConversationToFolder(id, intoFolderId);
    } else if (activeId.startsWith("folder:")) {
      const id = activeId.slice("folder:".length);
      // Don't try to drop a folder into itself — moveFolderToParent
      // also catches descendant cycles.
      if (id === intoFolderId) return;
      void moveFolderToParent(id, intoFolderId);
    }
  };

  const [input, setInput] = useState("");
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-conversation model picker. `null` means "Default" — the
  // app uses its full configured fallback chain (Pnyxy first, then
  // direct keys). Any other value is a strict pick — only that
  // provider is tried, errors surface instead of silent fallback.
  // Declared up here because the attachment cap below depends on it.
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    () => getConfiguredProviders(),
    // configuration changes when settings change — re-evaluate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(
    () => null,
  );
  // If the user disables the picked provider, snap back to "Default"
  // rather than hold a stale value that would either error or be
  // silently ignored by the strict-mode resolver.
  useEffect(() => {
    if (selectedProvider && !configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(null);
    }
  }, [configuredProviders, selectedProvider]);

  // Pending image attachments — shown as cards above the textarea
  // until the user sends, at which point they're persisted with the
  // user message and forwarded as multimodal content to vision-
  // capable providers.
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatMessageAttachment[]
  >([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Effective per-message cap depends on routing. Default mode goes
  // through the Pnyxy free quota and is capped to 1 image so the
  // cost-per-message stays predictable; direct keys are user-paid
  // and go up to 4.
  const effectiveAttachmentCap =
    selectedProvider === null ? MAX_ATTACHMENTS_DEFAULT : MAX_ATTACHMENTS_DIRECT;

  const handleAddFiles = useCallback(async (files: FileList | File[]) => {
    setAttachmentError(null);
    const incoming: ChatMessageAttachment[] = [];
    for (const file of Array.from(files)) {
      if (incoming.length + pendingAttachments.length >= effectiveAttachmentCap) {
        setAttachmentError(
          t("chat.composer.attachments.tooMany", {
            max: effectiveAttachmentCap,
          }),
        );
        break;
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        setAttachmentError(t("chat.composer.attachments.unsupported"));
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(
          t("chat.composer.attachments.tooLarge", { mb: MAX_ATTACHMENT_MB }),
        );
        continue;
      }
      try {
        const data = await fileToBase64(file);
        incoming.push({
          kind: "image",
          media_type: file.type,
          data,
          name: file.name,
        });
      } catch {
        setAttachmentError(t("chat.composer.attachments.readError"));
      }
    }
    if (incoming.length > 0) {
      setPendingAttachments((prev) => [...prev, ...incoming]);
    }
  }, [pendingAttachments.length, effectiveAttachmentCap, t]);

  const removeAttachment = (idx: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
    setAttachmentError(null);
  };

  // Paste handler — pull image items from the clipboard payload and
  // route them through the same validation/encoding path as the
  // file picker. Does NOT preventDefault when there are no images,
  // so plain text pastes still flow into the textarea normally.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void handleAddFiles(files);
    }
  };

  // One folder-action modal at a time, dispatched by `kind`. Keeps
  // a single render branch in JSX instead of three near-identical
  // copies, and means there's never two folder dialogs open at once.
  type FolderAction =
    | { kind: "create" }
    | { kind: "rename"; id: string; name: string }
    | { kind: "delete"; id: string; name: string };
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);

  // Textarea auto-resize. After every input change we reset height
  // to 0 (so `scrollHeight` reports the natural intrinsic height,
  // not the previous larger value) then snap to scrollHeight, capped
  // at ~12rem. Both grow on multi-line paste and shrink when the
  // user deletes lines. useLayoutEffect runs before paint so the
  // user never sees the height jitter.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const max = 12 * 16; // 12rem
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [input]);

  // selectedProvider + the attachment cap moved up to the top of
  // the component body — the file picker logic depends on them.

  // Speech-to-text — appends finalized chunks to the textarea, leaves
  // partial / interim results dropped (could surface as a ghost line
  // later if it reads as choppy).
  const speech = useSpeechRecognition({
    onResult: (text) => {
      setInput((prev) =>
        prev
          ? prev + (prev.endsWith(" ") ? "" : " ") + text.trim()
          : text.trim(),
      );
    },
  });

  useEffect(() => {
    if (user) {
      fetchConversations();
      fetchFolders();
    }
  }, [user, fetchConversations, fetchFolders]);

  // Reader → chat hand-off. When the user clicks "Send to AI chat"
  // from the reader's annotation menu, the reader stashes a draft
  // (selected text + source doc context) and navigates here. Drain
  // the draft once on mount: create a fresh conversation tagged
  // with the source, prefill the composer, and let them edit / send.
  useEffect(() => {
    if (!user) return;
    const draft = useChatStore.getState().consumePendingDraft();
    if (!draft) return;
    void (async () => {
      const id = await createConversation(
        "",
        null,
        draft.source ?? null,
        draft.target ?? null,
      );
      if (!id) return;
      await openConversation(id);
      setInput(draft.text);
    })();
    // Drain only once per mount / sign-in event. Subsequent reader
    // sends will re-fire the navigation and a fresh consume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Auto-open the most recent conversation when /chat is opened
  // fresh. Saves the user a click in the common case of "coming back
  // to continue where I left off". Skip if:
  //  - signed out (nothing to open)
  //  - already viewing a conversation (e.g. via deep link or branch)
  //  - a reader-handoff draft is in flight (its handler creates a
  //    fresh conversation that we'd just blow away)
  // Conversations are sorted newest-first by `fetchConversations`,
  // so `conversations[0]` is the most recent.
  useEffect(() => {
    if (!user) return;
    if (activeId) return;
    if (conversations.length === 0) return;
    if (useChatStore.getState().pendingDraft !== null) return;
    void openConversation(conversations[0].id);
  }, [user, activeId, conversations, openConversation]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // Roadmap-edit mode: when the conversation is tied to a roadmap,
  // load the roadmap store (it's IndexedDB-backed and may not be in
  // memory if the user landed on /chat directly) and resolve the
  // current title for the pill.
  const targetRoadmapId = activeConversation?.target_roadmap_id ?? null;
  const targetRoadmap = useRoadmap(targetRoadmapId ?? undefined);
  const roadmapsLoaded = useRoadmapStore((s) => s.loaded);
  const loadRoadmaps = useRoadmapStore((s) => s.load);
  useEffect(() => {
    if (targetRoadmapId && !roadmapsLoaded) void loadRoadmaps();
  }, [targetRoadmapId, roadmapsLoaded, loadRoadmaps]);

  // Flashcard extractor — opens with the chosen assistant message's
  // content. Held at this level (not inside MessageBubble) so the
  // modal lives outside the message bubble's portal logic and can
  // freely overlay the entire app.
  const [flashcardSource, setFlashcardSource] = useState<{
    text: string;
    title: string;
  } | null>(null);

  // Reading-context injector. Loads the user's recent reading from
  // book_resume_state, formats it as a plain-text bullet list, and
  // appends to the composer textarea. The user sees what the AI
  // sees — no hidden context.
  const readingContextBtnRef = useRef<HTMLButtonElement>(null);
  const [readingMenuOpen, setReadingMenuOpen] = useState(false);
  const insertReadingContext = async (mode: "week" | "all") => {
    setReadingMenuOpen(false);
    const books = await fetchRecentReading(
      mode === "week" ? { days: 7, limit: 10 } : { limit: 10 },
    );
    const intro =
      mode === "week"
        ? t("chat.readingContext.weekIntro")
        : t("chat.readingContext.recentIntro");
    const prompt = formatReadingContextPrompt(books, intro);
    setInput((prev) => (prev ? `${prev}\n\n${prompt}` : prompt));
    // Bring focus back to the textarea so the user can keep typing
    // their actual question right after the inserted context.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  // Auto-scroll to the latest message as stream tokens arrive.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeLeafId, messages, streamingMessageId]);

  const threadPath = useMemo(
    () => pathFromRoot(messages, activeLeafId),
    [messages, activeLeafId],
  );

  const handleNew = async () => {
    const id = await createConversation();
    if (id) await openConversation(id);
  };

  // Default mode now supports up to 1 image per message (proxy
  // forwards multimodal content, ~1600 tokens per image counted
  // against the free quota). Anything beyond that needs a direct
  // key — block the send instead of letting the user discover the
  // limit mid-stream. The cap only matters when the picked
  // provider is null; explicit picks have their own larger cap
  // already enforced in handleAddFiles.
  const attachmentsBlocked =
    selectedProvider === null &&
    pendingAttachments.length > MAX_ATTACHMENTS_DEFAULT;

  const handleSend = async () => {
    const text = input.trim();
    const attachments =
      pendingAttachments.length > 0 ? pendingAttachments : undefined;
    // Allow sending with attachments only (e.g. "describe this" worth
    // of intent in the image alone). Empty text + no attachments = no-op.
    if (!text && !attachments) return;
    if (attachmentsBlocked) {
      setAttachmentError(t("chat.composer.attachments.needVisionModel"));
      return;
    }
    setInput("");
    setPendingAttachments([]);
    setAttachmentError(null);
    // Stop dictation when the user submits — otherwise the next
    // utterance lands on the now-empty textarea and looks like a
    // ghost transcript.
    if (speech.listening) speech.stop();
    // null = Default → pass undefined (full fallback chain).
    // Any other value = strict pick (only that provider).
    const provider = selectedProvider ?? undefined;
    if (branchFromId) {
      const parentId = branchFromId;
      setBranchFromId(null);
      await branchFrom(parentId, text, provider, attachments);
    } else {
      if (!activeId) {
        const id = await createConversation();
        if (!id) return;
        await openConversation(id);
      }
      await sendMessage(text, provider, attachments);
    }
  };

  const handleSaveTitle = async (id: string) => {
    await renameConversation(id, editTitle.trim() || t("chat.untitled"));
    setEditingId(null);
  };

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="text-center">
          <MessagesSquare size={36} className="mx-auto mb-3 text-text-muted/50" />
          <p className="text-sm text-text-primary font-medium">
            {t("chat.signInRequired")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("chat.signInHint")}
          </p>
        </div>
      </div>
    );
  }

  const branchParent = branchFromId ? messages.get(branchFromId) : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full p-0 sm:h-screen">
      {/* Sidebar: folder tree + conversations. Pinned flush to the
          left + top edge per the Gemini-style layout — no card
          rounding, no outer page padding. The right border doubles
          as the divider against the main pane. */}
      <aside className="hidden w-64 shrink-0 flex-col gap-3 border-r border-glass-border bg-glass-bg/40 p-3 sm:flex">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-glass-border bg-glass-bg/30 px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-purple/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <Plus size={14} />
            {t("chat.newConversation")}
          </button>
          <button
            onClick={() => setFolderAction({ kind: "create" })}
            title={t("chat.folders.create")}
            aria-label={t("chat.folders.create")}
            className="rounded-md border border-dashed border-glass-border bg-glass-bg/30 p-2 text-text-muted transition-colors hover:border-accent-purple/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <FolderPlus size={14} />
          </button>
        </div>

        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToWindowEdges]}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 space-y-0.5 overflow-y-auto">
            {conversations.length === 0 && folders.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                {t("chat.sidebar.empty")}
              </p>
            ) : (
              <>
                <RootDropZone label={t("chat.folders.dropToRoot")} />
                <ChatTree
                  folders={folders}
                  conversations={conversations}
                  activeId={activeId}
                  editingId={editingId}
                  editTitle={editTitle}
                  onOpen={openConversation}
                  onStartEdit={(id, title) => {
                    setEditingId(id);
                    setEditTitle(title);
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveTitle={handleSaveTitle}
                  onEditTitleChange={setEditTitle}
                  onDelete={handleDeleteConversation}
                  onMove={moveConversationToFolder}
                  onRequestRenameFolder={(id, currentName) =>
                    setFolderAction({ kind: "rename", id, name: currentName })
                  }
                  onRequestDeleteFolder={(id, currentName) =>
                    setFolderAction({ kind: "delete", id, name: currentName })
                  }
                  t={t}
                />
              </>
            )}
          </div>
        </DndContext>
      </aside>

      {/* Main pane */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: new convo button at top */}
        <div className="flex items-center gap-2 border-b border-glass-border bg-bg-primary/40 px-3 py-2 sm:hidden">
          {activeId && (
            <button
              onClick={clearActive}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              aria-label={t("chat.backToList")}
            >
              <ChevronRight size={16} className="rotate-180" />
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {activeId
              ? conversations.find((c) => c.id === activeId)?.title ||
                t("chat.untitled")
              : t("chat.title")}
          </span>
          <button
            onClick={handleNew}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.newConversation")}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Mobile: conversation list when nothing open */}
        {!activeId && (
          <div className="flex-1 overflow-y-auto p-3 sm:hidden">
            {conversations.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <MessagesSquare size={36} className="mx-auto mb-3 text-text-muted/50" />
                  <p className="text-sm font-medium text-text-primary">
                    {t("chat.emptyTitle")}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {t("chat.emptyBody")}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => openConversation(c.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2 text-left text-sm transition-colors hover:bg-glass-hover"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {c.title || t("chat.untitled")}
                      </span>
                      <ChevronRight size={14} className="text-text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Desktop empty state */}
        {!activeId && (
          <div className="hidden flex-1 items-center justify-center sm:flex">
            <div className="text-center">
              <MessagesSquare
                size={40}
                className="mx-auto mb-3 text-text-muted/50"
              />
              <p className="text-sm font-medium text-text-primary">
                {t("chat.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t("chat.emptyBody")}
              </p>
              <button
                onClick={handleNew}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-purple px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-purple/80 cursor-pointer"
              >
                <Plus size={14} />
                {t("chat.newConversation")}
              </button>
            </div>
          </div>
        )}

        {/* Active conversation — thread inside a Gemini-style "paved
            middle path": the message column is capped at max-w-3xl
            and centered, regardless of how wide the main pane is. */}
        {activeId && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              {isLoading && threadPath.length === 0 && (
                <div
                  className="flex items-center justify-center py-16"
                  aria-label={t("chat.loading")}
                >
                  <Loader2
                    size={28}
                    className="animate-spin text-accent-purple/80"
                  />
                </div>
              )}

              {threadPath.length === 0 && !isLoading && (
                <p className="text-center text-xs text-text-muted">
                  {t("chat.newConversationHint")}
                </p>
              )}

              {threadPath.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  messages={messages}
                  activeLeafId={activeLeafId}
                  streamingMessageId={streamingMessageId}
                  sourceDocId={activeConversation?.source_doc_id ?? null}
                  onBranchHere={() => setBranchFromId(msg.id)}
                  onPickBranch={setActiveLeaf}
                  onSaveAsFlashcards={() =>
                    setFlashcardSource({
                      text: msg.content,
                      title:
                        activeConversation?.title ||
                        t("chat.flashcards.defaultTitle"),
                    })
                  }
                />
              ))}
              <div ref={threadEndRef} />
              </div>
            </div>

            {/* Composer — wrapped as a "panel island" so it sits as
                its own surface against the thread above. Bottom
                padding (pb-6) gives the input some breathing room
                above the page edge. */}
            <div className="bg-bg-primary/30 px-3 pb-6 pt-3">
              {/* Roadmap edit-mode pill — present when this
                  conversation is tied to a roadmap. The AI has tool
                  access; tool calls render as quoted lines inline. */}
              {targetRoadmapId && (
                <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-md border border-accent-purple/30 bg-accent-purple/10 px-2 py-1.5 text-xs text-accent-purple">
                  <MapIcon size={12} />
                  <span className="min-w-0 flex-1 truncate">
                    {t("chat.editingRoadmap", {
                      title:
                        targetRoadmap?.title ||
                        t("roadmaps.untitled"),
                    })}
                  </span>
                  <a
                    href={`/roadmaps/${targetRoadmapId}/edit`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/roadmaps/${targetRoadmapId}/edit`);
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] underline-offset-2 hover:bg-accent-purple/20 hover:underline cursor-pointer"
                  >
                    {t("chat.openInEditor")}
                  </a>
                </div>
              )}
              {/* Source-document context pill — present when this
                  conversation was started from the reader. Click it
                  to jump back to the page the user was on when they
                  sent the selection. */}
              {activeConversation?.source_doc_id && (
                <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-md border border-accent-blue/30 bg-accent-blue/10 px-2 py-1.5 text-xs text-accent-blue">
                  <BookOpen size={12} />
                  <span className="min-w-0 flex-1 truncate">
                    {t("chat.sourceContext", {
                      title: activeConversation.source_doc_title ?? "—",
                      page: activeConversation.source_page ?? "—",
                    })}
                  </span>
                  <a
                    href={`/reader/${activeConversation.source_doc_id}${
                      activeConversation.source_page
                        ? `?page=${activeConversation.source_page}`
                        : ""
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(
                        `/reader/${activeConversation.source_doc_id}${
                          activeConversation.source_page
                            ? `?page=${activeConversation.source_page}`
                            : ""
                        }`,
                      );
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] underline-offset-2 hover:bg-accent-blue/20 hover:underline cursor-pointer"
                  >
                    {t("chat.openInReader")}
                  </a>
                </div>
              )}
              {branchParent && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-accent-purple/30 bg-accent-purple/10 px-2 py-1.5 text-xs text-accent-purple">
                  <span className="flex items-center gap-1.5">
                    <GitBranch size={12} />
                    {t("chat.branchingFrom", {
                      snippet:
                        branchParent.content.slice(0, 48) +
                        (branchParent.content.length > 48 ? "…" : ""),
                    })}
                  </span>
                  <button
                    onClick={() => setBranchFromId(null)}
                    className="rounded p-0.5 hover:bg-accent-purple/20 cursor-pointer"
                    aria-label={t("common.cancel")}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {/* Composer panel-island. The textarea, mic, send, and
                  the model/context controls all live inside a single
                  rounded card so the input feels like the focal
                  point of the screen rather than an afterthought
                  glued to the bottom edge. */}
              <div className="mx-auto w-full max-w-3xl">
                <div
                  className={cn(
                    "rounded-2xl border bg-bg-secondary/70 p-3 shadow-md backdrop-blur-md transition-colors",
                    speech.listening
                      ? "border-accent-purple ring-2 ring-accent-purple/30"
                      : "border-glass-border focus-within:border-accent-purple/60",
                  )}
                >
                  {/* Pending attachment cards — Gemini-style row of
                      thumbnails with an X to remove. Sits above the
                      textarea so the user can see what they're about
                      to send while still typing the prompt. */}
                  {pendingAttachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {pendingAttachments.map((att, idx) => (
                        <AttachmentCard
                          key={idx}
                          attachment={att}
                          onRemove={() => removeAttachment(idx)}
                        />
                      ))}
                    </div>
                  )}
                  {attachmentError && (
                    <p
                      role="alert"
                      className="mb-2 text-[11px] text-red-400"
                    >
                      {attachmentError}
                    </p>
                  )}
                  {/* Persistent hint when the user has staged images
                      but is on Default — separate from the transient
                      `attachmentError` so it doesn't disappear after
                      the next state change. */}
                  {attachmentsBlocked && !attachmentError && (
                    <p className="mb-2 text-[11px] text-amber-400">
                      {t("chat.composer.attachments.needVisionModel")}
                    </p>
                  )}
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={
                      speech.listening
                        ? t("chat.composer.listeningPlaceholder")
                        : t("chat.composerPlaceholder")
                    }
                    rows={2}
                    // Hide the scrollbar entirely — the auto-resize
                    // grows the textarea up to 12rem so a real
                    // overflow only happens past that, where a tiny
                    // hidden bar is preferable to a chunky default
                    // browser scrollbar floating in the input.
                    className="block min-h-[3rem] w-full resize-none bg-transparent px-1 text-sm text-text-primary placeholder:text-text-muted outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    disabled={streamingMessageId !== null}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void handleAddFiles(e.target.files);
                      // Reset value so the same file picked twice in a
                      // row still fires onChange the second time.
                      e.target.value = "";
                    }}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <ModelPicker
                      value={selectedProvider}
                      options={configuredProviders}
                      onChange={setSelectedProvider}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={
                        streamingMessageId !== null ||
                        pendingAttachments.length >= effectiveAttachmentCap
                      }
                      title={t("chat.composer.attachments.add")}
                      aria-label={t("chat.composer.attachments.add")}
                      className="inline-flex items-center gap-1 rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Paperclip size={11} />
                    </button>
                    <button
                      ref={readingContextBtnRef}
                      onClick={() => setReadingMenuOpen((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                      title={t("chat.readingContext.title")}
                    >
                      <History size={11} />
                      <span className="hidden sm:inline">
                        {t("chat.readingContext.button")}
                      </span>
                    </button>
                    <FloatingMenu
                      open={readingMenuOpen}
                      anchorRef={readingContextBtnRef}
                      onClose={() => setReadingMenuOpen(false)}
                      className="w-56"
                    >
                      <button
                        onClick={() => insertReadingContext("week")}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                      >
                        <span className="font-medium">
                          {t("chat.readingContext.weekTitle")}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {t("chat.readingContext.weekHint")}
                        </span>
                      </button>
                      <button
                        onClick={() => insertReadingContext("all")}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                      >
                        <span className="font-medium">
                          {t("chat.readingContext.recentTitle")}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {t("chat.readingContext.recentHint")}
                        </span>
                      </button>
                    </FloatingMenu>
                    {speech.error && (
                      <span className="ml-auto text-[11px] text-red-400">
                        {speech.error === "not-allowed"
                          ? t("chat.composer.micDenied")
                          : t("chat.composer.micError")}
                      </span>
                    )}
                    <div className={cn("flex items-center gap-2", !speech.error && "ml-auto")}>
                  {speech.supported && (
                    <button
                      onClick={() =>
                        speech.listening ? speech.stop() : speech.start()
                      }
                      disabled={streamingMessageId !== null}
                      className={cn(
                        "shrink-0 rounded-lg p-2 transition-colors cursor-pointer",
                        speech.listening
                          ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          : "bg-glass-bg text-text-muted hover:bg-glass-hover hover:text-text-primary",
                      )}
                      aria-label={
                        speech.listening
                          ? t("chat.composer.stopListening")
                          : t("chat.composer.startListening")
                      }
                      title={
                        speech.listening
                          ? t("chat.composer.stopListening")
                          : t("chat.composer.startListening")
                      }
                    >
                      {speech.listening ? (
                        <MicOff size={16} />
                      ) : (
                        <Mic size={16} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={handleSend}
                    disabled={
                      (!input.trim() && pendingAttachments.length === 0) ||
                      streamingMessageId !== null ||
                      attachmentsBlocked
                    }
                    className={cn(
                      "shrink-0 rounded-lg p-2 transition-colors cursor-pointer",
                      (input.trim() || pendingAttachments.length > 0) &&
                        streamingMessageId === null &&
                        !attachmentsBlocked
                        ? "bg-accent-purple text-white hover:bg-accent-purple/80"
                        : "bg-glass-bg text-text-muted disabled:cursor-not-allowed",
                    )}
                    aria-label={t("chat.send")}
                  >
                    {streamingMessageId !== null ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                  </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      {flashcardSource && (
        <SaveAsFlashcardsModal
          open={!!flashcardSource}
          onClose={() => setFlashcardSource(null)}
          passage={flashcardSource.text}
          defaultTitle={flashcardSource.title}
        />
      )}

      {/* Folder action modals — replace the old native confirm/
          prompt calls. One modal at a time, dispatched on the
          `kind` of the current folderAction. */}
      <PromptModal
        open={folderAction?.kind === "create"}
        title={t("chat.folders.create")}
        placeholder={t("chat.folders.namePrompt")}
        onClose={() => setFolderAction(null)}
        onSubmit={(name) => {
          void createFolder(name);
        }}
      />
      <PromptModal
        open={folderAction?.kind === "rename"}
        title={t("chat.folders.rename")}
        defaultValue={
          folderAction?.kind === "rename" ? folderAction.name : ""
        }
        placeholder={t("chat.folders.namePrompt")}
        onClose={() => setFolderAction(null)}
        onSubmit={(name) => {
          if (folderAction?.kind === "rename") {
            void renameFolder(folderAction.id, name);
          }
        }}
      />
      <ConfirmModal
        open={folderAction?.kind === "delete"}
        title={t("chat.folders.delete")}
        body={
          folderAction?.kind === "delete"
            ? t("chat.folders.deleteConfirm", { name: folderAction.name })
            : ""
        }
        confirmLabel={t("common.delete")}
        danger
        onClose={() => setFolderAction(null)}
        onConfirm={() => {
          if (folderAction?.kind === "delete") {
            void deleteFolder(folderAction.id);
          }
        }}
      />
      {ConfirmModalElement}
    </div>
  );
}

// ── Attachment card (Gemini-style) ──────────────────────────

/**
 * Small rectangle showing one pending attachment — a 12×12 image
 * thumbnail (or a generic icon for non-image attachments) with a
 * close button on the top-right corner. Clicking the card itself
 * opens the original at full size in a new tab; clicking the X
 * removes the attachment from the pending list before send.
 */
function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: ChatMessageAttachment;
  onRemove: () => void;
}) {
  const dataUri = `data:${attachment.media_type};base64,${attachment.data}`;
  return (
    <div
      className="group relative flex h-12 items-center gap-2 rounded-md border border-glass-border bg-glass-bg/60 pl-1.5 pr-7"
      title={attachment.name ?? attachment.kind}
    >
      {attachment.kind === "image" ? (
        <img
          src={dataUri}
          alt={attachment.name ?? "attachment"}
          className="h-9 w-9 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-bg-primary text-text-muted">
          <ImageIcon size={14} />
        </div>
      )}
      {attachment.name && (
        <span className="max-w-[10rem] truncate text-[11px] text-text-secondary">
          {attachment.name}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="absolute right-1 top-1 rounded-full bg-bg-primary/80 p-0.5 text-text-muted transition-colors hover:bg-bg-primary hover:text-text-primary cursor-pointer"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── Copy-to-clipboard button ────────────────────────────────

/**
 * Tiny inline button on assistant messages that copies the raw
 * markdown content (not the rendered HTML — markdown copy is what
 * users actually want for pasting back into editors / chats).
 * Shows a 1.5s "Copied" confirmation; falls back to a manual prompt
 * if the Clipboard API rejects (rare but happens in some private
 * / iframe contexts).
 */
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked — extremely rare in our deploys, but
      // surface the failure rather than silently swallowing it.
      window.alert(t("chat.copy.failed"));
    }
  };
  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      title={copied ? t("chat.copy.copied") : t("chat.copy.action")}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? t("chat.copy.copied") : t("chat.copy.action")}
    </button>
  );
}

// ── Model dropdown ──────────────────────────────────────────

function ModelPicker({
  value,
  options,
  onChange,
  label,
}: {
  /** null = "Default" (full fallback chain). A specific provider =
   *  strict pick — only that provider is tried, no fallback. */
  value: AiProvider | null;
  options: AiProvider[];
  onChange: (next: AiProvider | null) => void;
  /** Optional small-caps prefix ("MODEL: …"). Omitted in the new
   *  panel-island composer so the dropdown stands on its own. */
  label?: string;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // Display name for the trigger: model name when an explicit
  // provider is picked, "Default" when on auto-fallback.
  const triggerLabel = value
    ? PROVIDER_INFO[value].model
    : t("chat.composer.modelDefault");

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
      {label && (
        <span className="font-medium uppercase tracking-wider">{label}</span>
      )}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-glass-border bg-bg-primary/50 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        <Bot size={12} className="text-accent-purple/80" />
        {triggerLabel}
        <ChevronDown size={11} />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        className="w-64"
      >
        {/* "Default" entry — picks the first available in the
            configured chain, falls through on quota/auth/network
            errors. The user's safety net when they don't care
            which model answers. */}
        <ModelOption
          active={value === null}
          label={t("chat.composer.modelDefault")}
          subtitle={t("chat.composer.modelDefaultSubtitle")}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        />
        {options.length > 0 && (
          <div className="my-0.5 h-px bg-glass-border" />
        )}
        {options.map((p) => (
          <ModelOption
            key={p}
            active={value === p}
            label={PROVIDER_INFO[p].model}
            subtitle={PROVIDER_INFO[p].routing}
            onClick={() => {
              onChange(p);
              setOpen(false);
            }}
          />
        ))}
      </FloatingMenu>
    </div>
  );
}

function ModelOption({
  active,
  label,
  subtitle,
  onClick,
}: {
  active: boolean;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-glass-hover cursor-pointer",
        active ? "text-accent-purple" : "text-text-secondary hover:text-text-primary",
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "text-[10px]",
            active ? "text-accent-purple/70" : "text-text-muted",
          )}
        >
          {subtitle}
        </span>
      </span>
      {active && <Check size={12} className="mt-0.5" />}
    </button>
  );
}

function MessageBubble({
  msg,
  messages,
  activeLeafId,
  streamingMessageId,
  sourceDocId,
  onBranchHere,
  onPickBranch,
  onSaveAsFlashcards,
}: {
  msg: ChatMessage;
  messages: Map<string, ChatMessage>;
  activeLeafId: string | null;
  streamingMessageId: string | null;
  /** Set when the conversation has a source doc — citation tokens
   *  in assistant messages get post-processed into clickable links. */
  sourceDocId: string | null;
  onBranchHere: () => void;
  onPickBranch: (id: string) => void;
  /** Open the flashcards extractor over this message's content. */
  onSaveAsFlashcards: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isUser = msg.role === "user";
  const isStreaming = msg.id === streamingMessageId;
  const branches = countBranches(messages, msg.id);
  const [showBranches, setShowBranches] = useState(false);

  // Which child of this message is on the active path (if any)?
  const activePath = pathFromRoot(messages, activeLeafId).map((m) => m.id);
  const activeChildId = childrenOf(messages, msg.id).find((c) =>
    activePath.includes(c.id),
  )?.id;

  return (
    <div
      className={cn(
        "group flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-accent-purple/20 text-text-primary"
            : "bg-glass-bg text-text-secondary",
          isStreaming && "animate-pulse",
        )}
      >
        {/* User messages render as preformatted text (the user typed
            them — no need to interpret markdown). Assistant messages
            go through marked + DOMPurify so code blocks, tables,
            lists, headings, and inline code all render properly. */}
        {isUser ? (
          <div className="space-y-2">
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {msg.attachments.map((att, idx) =>
                  att.kind === "image" ? (
                    <a
                      key={idx}
                      href={`data:${att.media_type};base64,${att.data}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                      title={att.name ?? ""}
                    >
                      <img
                        src={`data:${att.media_type};base64,${att.data}`}
                        alt={att.name ?? "attachment"}
                        className="max-h-48 max-w-full rounded-md object-cover"
                      />
                    </a>
                  ) : null,
                )}
              </div>
            )}
            {msg.content && (
              <div className="whitespace-pre-wrap break-words">
                {msg.content}
              </div>
            )}
          </div>
        ) : (
          <div
            className="ai-message break-words"
            // Intercept clicks on internal links (citation tokens
            // become <a href="/reader/..."> after the markdown
            // pre-pass) so they use react-router instead of doing a
            // full page reload. External and unrecognised hrefs fall
            // through to the browser's default behaviour.
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const anchor = target.closest("a");
              if (!anchor) return;
              const href = anchor.getAttribute("href") ?? "";
              if (href.startsWith("/")) {
                e.preventDefault();
                e.stopPropagation();
                navigate(href);
              }
            }}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(msg.content, sourceDocId),
            }}
          />
        )}

        {/* Actions: visible on hover or when there are branches */}
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-[10px] text-text-muted transition-opacity",
            branches > 1 || showBranches
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
        >
          <button
            onClick={onBranchHere}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            title={t("chat.branchHere")}
          >
            <GitBranch size={10} />
            {t("chat.branchHere")}
          </button>
          {/* Copy: assistant messages only (the user can already
              re-read what they typed; copying their own message is
              a niche need we can add later). Stays disabled while
              streaming so we don't capture a partial response. */}
          {!isUser && !isStreaming && msg.content.trim().length > 0 && (
            <CopyButton text={msg.content} />
          )}
          {/* Save-as-flashcards: only on assistant messages, only
              once the stream has finished (the extractor would just
              choke on a half-written passage). */}
          {!isUser && !isStreaming && msg.content.trim().length > 40 && (
            <button
              onClick={onSaveAsFlashcards}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              title={t("chat.flashcards.saveAction")}
            >
              <Sparkles size={10} />
              {t("chat.flashcards.saveAction")}
            </button>
          )}
          {branches > 1 && (
            <button
              onClick={() => setShowBranches((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              {t("chat.branchesCount", { count: branches })}
            </button>
          )}
        </div>

        {/* Branch switcher */}
        {showBranches && branches > 1 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {childrenOf(messages, msg.id).map((child, i) => {
              const isActiveChild = child.id === activeChildId;
              return (
                <button
                  key={child.id}
                  onClick={() => onPickBranch(child.id)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px] transition-colors cursor-pointer",
                    isActiveChild
                      ? "border-accent-purple bg-accent-purple/15 text-accent-purple"
                      : "border-glass-border text-text-muted hover:border-accent-purple/40 hover:text-text-primary",
                  )}
                  title={child.content.slice(0, 80)}
                >
                  {t("chat.branchN", { n: i + 1 })}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar tree ────────────────────────────────────────────

interface ChatTreeProps {
  folders: import("@/types/chat").ChatFolder[];
  conversations: import("@/types/chat").ChatConversation[];
  activeId: string | null;
  editingId: string | null;
  editTitle: string;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onSaveTitle: (id: string) => void;
  onEditTitleChange: (s: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  /** Bubble rename/delete intents up to ChatPage, where the actual
   *  modal lives. The folder rows just gather (id, currentName) and
   *  let the parent decide how to confirm. */
  onRequestRenameFolder: (id: string, currentName: string) => void;
  onRequestDeleteFolder: (id: string, currentName: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function ChatTree(props: ChatTreeProps) {
  const { folders, conversations } = props;
  // Index conversations and child folders by parent for cheap lookup.
  // Folder tree is flat-with-parent_id; we render recursively from
  // the roots (parent_id === null) downward.
  const childFolders = useMemo(() => {
    const m = new Map<string | null, typeof folders>();
    for (const f of folders) {
      const arr = m.get(f.parent_id) ?? [];
      arr.push(f);
      m.set(f.parent_id, arr);
    }
    return m;
  }, [folders]);
  const folderConversations = useMemo(() => {
    const m = new Map<string | null, typeof conversations>();
    for (const c of conversations) {
      const arr = m.get(c.folder_id) ?? [];
      arr.push(c);
      m.set(c.folder_id, arr);
    }
    return m;
  }, [conversations]);

  // Root: loose conversations first, then top-level folders.
  return (
    <div className="flex flex-col gap-0.5">
      {(folderConversations.get(null) ?? []).map((c) => (
        <ConversationRow key={c.id} conversation={c} depth={0} {...props} />
      ))}
      {(childFolders.get(null) ?? []).map((f) => (
        <FolderRow
          key={f.id}
          folder={f}
          depth={0}
          childFolders={childFolders}
          folderConversations={folderConversations}
          {...props}
        />
      ))}
    </div>
  );
}

interface FolderRowProps extends ChatTreeProps {
  folder: import("@/types/chat").ChatFolder;
  depth: number;
  childFolders: Map<string | null, import("@/types/chat").ChatFolder[]>;
  folderConversations: Map<string | null, import("@/types/chat").ChatConversation[]>;
}

function FolderRow({
  folder,
  depth,
  childFolders,
  folderConversations,
  ...rest
}: FolderRowProps) {
  const [expanded, setExpanded] = useState(true);
  const subFolders = childFolders.get(folder.id) ?? [];
  const subConversations = folderConversations.get(folder.id) ?? [];
  const t = rest.t;
  // Drag a folder to reparent it; drop conversations / other folders
  // on the row body to nest them inside.
  const draggable = useDraggable({ id: `folder:${folder.id}` });
  const droppable = useDroppable({ id: `nest:${folder.id}` });
  // dnd-kit's `setNodeRef` is a callback ref, not a `.current`-bearing
  // ref; combining two hooks on one node is the documented pattern.
  const combineRef = (el: HTMLDivElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };
  return (
    <>
      <div
        ref={combineRef}
        {...draggable.attributes}
        {...draggable.listeners}
        className={cn(
          "group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-text-secondary transition-colors cursor-grab active:cursor-grabbing",
          droppable.isOver
            ? "bg-accent-purple/20 ring-1 ring-accent-purple/60"
            : "hover:bg-glass-hover hover:text-text-primary",
          draggable.isDragging && "opacity-40",
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <FolderIcon size={12} className="shrink-0 text-text-muted" />
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium cursor-pointer"
          title={folder.name}
        >
          {folder.name}
        </button>
        <button
          onClick={() => rest.onRequestRenameFolder(folder.id, folder.name)}
          className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
          aria-label={t("chat.folders.rename")}
        >
          <Pencil size={10} />
        </button>
        <button
          onClick={() => rest.onRequestDeleteFolder(folder.id, folder.name)}
          className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
          aria-label={t("chat.folders.delete")}
        >
          <Trash2 size={10} />
        </button>
      </div>
      {expanded && (
        <>
          {subConversations.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              depth={depth + 1}
              {...rest}
            />
          ))}
          {subFolders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              depth={depth + 1}
              childFolders={childFolders}
              folderConversations={folderConversations}
              {...rest}
            />
          ))}
        </>
      )}
    </>
  );
}

interface ConversationRowProps extends ChatTreeProps {
  conversation: import("@/types/chat").ChatConversation;
  depth: number;
}

function ConversationRow({
  conversation,
  depth,
  folders,
  activeId,
  editingId,
  editTitle,
  onOpen,
  onStartEdit,
  onCancelEdit,
  onSaveTitle,
  onEditTitleChange,
  onDelete,
  onMove,
  t,
}: ConversationRowProps) {
  const isActive = conversation.id === activeId;
  const isEditing = editingId === conversation.id;
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const [showMove, setShowMove] = useState(false);
  // Conversations are draggable but not droppable — drop targets are
  // folders and the root strip. While editing the title we disable
  // the drag listener so the input doesn't get hijacked.
  const draggable = useDraggable({
    id: `conv:${conversation.id}`,
    disabled: isEditing,
  });

  return (
    <div
      ref={draggable.setNodeRef}
      {...(isEditing ? {} : draggable.attributes)}
      {...(isEditing ? {} : draggable.listeners)}
      className={cn(
        "group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors",
        !isEditing && "cursor-grab active:cursor-grabbing",
        draggable.isDragging && "opacity-40",
        // Active gets a stronger fill + a left accent bar so the
        // current conversation pops out of the list at a glance.
        // Inactive rows get a clearer hover state (bg-glass-hover
        // alone was too subtle against the sidebar's own bg).
        isActive
          ? "bg-accent-purple/20 text-accent-purple before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent-purple"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {isEditing ? (
        <>
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveTitle(conversation.id);
              if (e.key === "Escape") onCancelEdit();
            }}
            className="flex-1 min-w-0 rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent-purple"
          />
          <button
            onClick={() => onSaveTitle(conversation.id)}
            className="rounded p-1 text-green-400 hover:bg-glass-hover cursor-pointer"
          >
            <Check size={12} />
          </button>
          <button
            onClick={onCancelEdit}
            className="rounded p-1 text-text-muted hover:bg-glass-hover cursor-pointer"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <span className="w-5 shrink-0" aria-hidden="true" />
          <button
            onClick={() => onOpen(conversation.id)}
            className="flex-1 min-w-0 truncate text-left text-xs cursor-pointer"
          >
            {conversation.title || t("chat.untitled")}
          </button>
          <button
            ref={moveBtnRef}
            onClick={() => setShowMove((v) => !v)}
            className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.folders.moveTo")}
            title={t("chat.folders.moveTo")}
          >
            <FolderInput size={10} />
          </button>
          <FloatingMenu
            open={showMove}
            anchorRef={moveBtnRef}
            onClose={() => setShowMove(false)}
            className="w-48"
          >
            <button
              onClick={() => {
                onMove(conversation.id, null);
                setShowMove(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderIcon size={12} className="text-text-muted" />
              {t("chat.folders.root")}
            </button>
            {folders.length > 0 && (
              <div className="my-0.5 h-px bg-glass-border" />
            )}
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  onMove(conversation.id, f.id);
                  setShowMove(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <FolderIcon size={12} className="text-text-muted" />
                {f.name}
              </button>
            ))}
          </FloatingMenu>
          <button
            onClick={() => onStartEdit(conversation.id, conversation.title)}
            className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.rename")}
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={() => onDelete(conversation.id)}
            className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.delete")}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </div>
  );
}

// Slim drop strip pinned to the top of the conversation list. Drop
// a conversation or folder onto it to send it back to the root
// (folder_id / parent_id = null). Only visually announces itself
// when there's an active drag — invisible the rest of the time so
// it doesn't take up sidebar space when no one's reaching for it.
function RootDropZone({ label }: { label: string }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: "root" });
  const dragging = !!active;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-all",
        dragging
          ? "mb-1.5 flex items-center justify-center rounded-md border border-dashed py-1.5 text-[11px]"
          : "h-0 overflow-hidden",
        isOver
          ? "border-accent-purple bg-accent-purple/15 text-accent-purple"
          : "border-glass-border text-text-muted",
      )}
    >
      {dragging && label}
    </div>
  );
}
