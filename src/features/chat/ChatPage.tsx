import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { FloatingMenu } from "@/components/ui";
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
import type { ChatMessage } from "@/types/chat";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Claude",
  openai: "GPT",
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

  // Per-conversation provider override. Initial value = the first
  // currently-configured provider (mirrors the saved fallback chain).
  // The dropdown is always present; if the user has only Pnyxy
  // enabled, it just shows Pnyxy with no other choices.
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    () => getConfiguredProviders(),
    // configuration changes when settings change — re-evaluate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>(
    () => configuredProviders[0] ?? "pnyxy",
  );
  // If the user disables the picked provider, fall back to whatever's
  // first in the still-configured list — better than holding a stale
  // value that streamChatResponse will silently ignore.
  useEffect(() => {
    if (!configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(configuredProviders[0] ?? "pnyxy");
    }
  }, [configuredProviders, selectedProvider]);

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

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    // Stop dictation when the user submits — otherwise the next
    // utterance lands on the now-empty textarea and looks like a
    // ghost transcript.
    if (speech.listening) speech.stop();
    if (branchFromId) {
      const parentId = branchFromId;
      setBranchFromId(null);
      await branchFrom(parentId, text, selectedProvider);
    } else {
      if (!activeId) {
        const id = await createConversation();
        if (!id) return;
        await openConversation(id);
      }
      await sendMessage(text, selectedProvider);
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
      <aside className="hidden w-64 shrink-0 flex-col gap-2 border-r border-glass-border bg-glass-bg/40 p-2 sm:flex">
        <div className="flex items-center gap-1">
          <button
            onClick={handleNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed border-glass-border bg-glass-bg/30 px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-purple/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <Plus size={14} />
            {t("chat.newConversation")}
          </button>
          <button
            onClick={async () => {
              const name = prompt(t("chat.folders.namePrompt"));
              if (name?.trim()) await createFolder(name.trim());
            }}
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
          <div className="flex-1 overflow-y-auto">
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
                  onDelete={deleteConversation}
                  onMove={moveConversationToFolder}
                  onRenameFolder={renameFolder}
                  onDeleteFolder={deleteFolder}
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

            {/* Composer */}
            <div className="border-t border-glass-border bg-bg-primary/30 p-3">
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
              {/* Model picker (header) + composer row (textbox flanked
                  by mic/send, all vertically centered). The model
                  dropdown is a styled FloatingMenu trigger — visually
                  consistent with the rest of the app, no native
                  <select> ugly-by-default behaviour. */}
              <div className="mx-auto w-full max-w-3xl">
                <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-3">
                    <ModelPicker
                      value={selectedProvider}
                      options={configuredProviders}
                      onChange={setSelectedProvider}
                      label={t("chat.composer.modelLabel")}
                    />
                    <button
                      ref={readingContextBtnRef}
                      onClick={() => setReadingMenuOpen((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md border border-glass-border bg-bg-primary/50 px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                      title={t("chat.readingContext.title")}
                    >
                      <History size={11} />
                      {t("chat.readingContext.button")}
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
                  </div>
                  {speech.error && (
                    <span className="text-[11px] text-red-400">
                      {speech.error === "not-allowed"
                        ? t("chat.composer.micDenied")
                        : t("chat.composer.micError")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
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
                    rows={1}
                    className={cn(
                      "block w-full resize-none overflow-y-auto rounded-lg border bg-glass-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors",
                      speech.listening
                        ? "border-accent-purple ring-2 ring-accent-purple/30"
                        : "border-glass-border focus:border-accent-purple",
                    )}
                    disabled={streamingMessageId !== null}
                  />
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
                    disabled={!input.trim() || streamingMessageId !== null}
                    className={cn(
                      "shrink-0 rounded-lg p-2 transition-colors cursor-pointer",
                      input.trim() && streamingMessageId === null
                        ? "bg-accent-purple text-white hover:bg-accent-purple/80"
                        : "bg-glass-bg text-text-muted",
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
    </div>
  );
}

// ── Model dropdown ──────────────────────────────────────────

function ModelPicker({
  value,
  options,
  onChange,
  label,
}: {
  value: AiProvider;
  options: AiProvider[];
  onChange: (next: AiProvider) => void;
  label: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
      <span className="font-medium uppercase tracking-wider">{label}</span>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-glass-border bg-bg-primary/50 px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        {PROVIDER_LABEL[value]}
        <ChevronDown size={11} />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        className="w-44"
      >
        {options.map((p) => (
          <button
            key={p}
            onClick={() => {
              onChange(p);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
              value === p ? "text-accent-purple" : "text-text-secondary",
            )}
          >
            <span>{PROVIDER_LABEL[p]}</span>
            {value === p && <Check size={12} />}
          </button>
        ))}
      </FloatingMenu>
    </div>
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
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
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
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
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
          "group flex items-center gap-1 rounded-md px-1.5 py-1 text-text-secondary transition-colors cursor-grab active:cursor-grabbing",
          droppable.isOver
            ? "bg-accent-purple/20 ring-1 ring-accent-purple/60"
            : "hover:bg-glass-hover hover:text-text-primary",
          draggable.isDragging && "opacity-40",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
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
          onClick={() => {
            const next = prompt(t("chat.folders.renamePrompt"), folder.name);
            if (next?.trim()) rest.onRenameFolder(folder.id, next.trim());
          }}
          className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
          aria-label={t("chat.folders.rename")}
        >
          <Pencil size={10} />
        </button>
        <button
          onClick={() => {
            if (confirm(t("chat.folders.deleteConfirm", { name: folder.name }))) {
              rest.onDeleteFolder(folder.id);
            }
          }}
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
        "group flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
        !isEditing && "cursor-grab active:cursor-grabbing",
        draggable.isDragging && "opacity-40",
        isActive
          ? "bg-accent-purple/15 text-accent-purple"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
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
