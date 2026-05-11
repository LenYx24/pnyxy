import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { renderMarkdown, handleCodeBlockCopy, detectAiLinkClick } from "@/lib/markdown-message";
import { promptOpenAiLink } from "@/lib/ai-link-prompt";
import { usePageCitationDispatch } from "@/hooks/use-page-citation";
import { useReadAloud, markdownToSpeech } from "@/hooks/use-read-aloud";
import {
  conversationToMarkdown,
  downloadMarkdown,
} from "@/lib/export-conversation";
import {
  MessagesSquare,
  MoreVertical,
  Gauge,
  Plus,
  Loader2,
  GitBranch,
  Trash2,
  Pencil,
  X,
  Check,
  ChevronRight,
  ChevronDown,
  Menu,
  FolderPlus,
  Folder as FolderIcon,
  FolderInput,
  BookOpen,
  Sparkles,
  Map as MapIcon,
  Copy,
  RefreshCw,
  Download,
  Volume2,
  Search,
} from "lucide-react";
import { ConfirmModal, FloatingMenu, PromptModal, TypingIndicator } from "@/components/ui";
import { extractRecommendations } from "@/lib/extract-recommendations";
import { RecommendationCards } from "./RecommendationsRenderer";
import { buildRecommendationSystemPrompt } from "@/lib/recommendation-prompts";
import { ChatComposer, type ChatComposerSubmitPayload } from "./ChatComposer";
import { useConfirm } from "@/hooks/use-confirm";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
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
import {
  fetchRecentReading,
  formatReadingContextPrompt,
} from "@/lib/reading-context";
import { SaveAsFlashcardsModal } from "./SaveAsFlashcardsModal";
import type { ChatMessage } from "@/types/chat";

// Composer attachment limits — enforced client-side, mirrored
// roughly by Anthropic's per-request payload cap. Image-only for
// v1; PDF / text upload would need server-side extraction or
// provider-native file uploads, both deferred.

// Markdown rendering moved to `@/lib/markdown-message`; same citation
// pre-pass logic now lives there so the reader's AI panel renders
// `[p.N]` clickably too. Click dispatch is the
// `usePageCitationDispatch` hook — anchors that target the
// already-active reader doc jump in place; everything else navigates.

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
  const sendMessage = useChatStore((s) => s.sendMessage);
  const branchFrom = useChatStore((s) => s.branchFrom);
  const setActiveLeaf = useChatStore((s) => s.setActiveLeaf);
  const folders = useChatStore((s) => s.folders);
  const fetchFolders = useChatStore((s) => s.fetchFolders);
  const createFolder = useChatStore((s) => s.createFolder);
  const renameFolder = useChatStore((s) => s.renameFolder);
  const deleteFolder = useChatStore((s) => s.deleteFolder);
  const moveFolderToParent = useChatStore((s) => s.moveFolderToParent);

  // Drag-and-drop sensors. MouseSensor (not PointerSensor) so touch
  // events are exclusively handled by TouchSensor below — otherwise
  // PointerSensor's `distance: 8` activation beat TouchSensor's
  // 200ms delay on phones and a regular scroll-swipe over a
  // conversation row would start a drag.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
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
  // Mobile-only: controls the slide-in conversation rail drawer.
  // Desktop renders the same aside as a static column and ignores
  // this state.
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);
  // Kept so reader→chat handoff can refocus the input post-prefill.
  // Composer owns the actual textarea ref internally, so this is
  // unused for now — leaving it commented as a placeholder once we
  // expose a focus() imperative handle on ChatComposer.
  // const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  // selectedProvider is kept around for the onPickSuggestion quick-
  // reply path which branches off existing assistant messages. The
  // composer manages its own copy too — they don't have to agree.
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(
    () => null,
  );
  // Conversation search — filters the visible sidebar list (desktop)
  // and the mobile pre-open conversations list. Title-only,
  // case-insensitive substring match. Full-text-across-messages is
  // a follow-up — would need a Postgres RPC since we don't have
  // every conversation's message bodies in memory.
  const [conversationSearch, setConversationSearch] = useState("");
  const filteredConversationData = useMemo(() => {
    const q = conversationSearch.trim().toLowerCase();
    if (!q) {
      return { conversations, folders };
    }
    const folderById = new Map(folders.map((f) => [f.id, f]));
    const matched = conversations.filter((c) =>
      (c.title || "").toLowerCase().includes(q),
    );
    // Walk up each matched conversation's folder chain so every
    // ancestor folder stays visible — otherwise a hit deep in a
    // nested folder would render orphaned.
    const keptFolderIds = new Set<string>();
    for (const c of matched) {
      let fid = c.folder_id;
      while (fid && !keptFolderIds.has(fid)) {
        keptFolderIds.add(fid);
        const f = folderById.get(fid);
        fid = f?.parent_id ?? null;
      }
    }
    return {
      conversations: matched,
      folders: folders.filter((f) => keptFolderIds.has(f.id)),
    };
  }, [conversations, folders, conversationSearch]);
  // If the user disables the picked provider, snap back to "Default"
  // rather than hold a stale value that would either error or be
  // silently ignored by the strict-mode resolver.
  useEffect(() => {
    if (selectedProvider && !configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(null);
    }
  }, [configuredProviders, selectedProvider]);

  // One folder-action modal at a time, dispatched by `kind`. Keeps
  // a single render branch in JSX instead of three near-identical
  // copies, and means there's never two folder dialogs open at once.
  type FolderAction =
    | { kind: "create" }
    | { kind: "rename"; id: string; name: string }
    | { kind: "delete"; id: string; name: string };
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);

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

  // Export the active conversation's visible thread as Markdown.
  // Pulled out of the overflow menu's onClick so both the mobile
  // header menu and the desktop floating menu wire to the same
  // handler. No-op when there's no active conversation.
  const handleExportActive = useCallback(() => {
    if (!activeConversation) return;
    const md = conversationToMarkdown(
      activeConversation,
      messages,
      activeLeafId,
    );
    downloadMarkdown(
      activeConversation.title.trim() || t("chat.untitled"),
      md,
    );
  }, [activeConversation, messages, activeLeafId, t]);

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

  // Overflow menus — desktop top-right and mobile header. Distinct
  // refs/state so opening one doesn't auto-close the other.
  const overflowAnchorRef = useRef<HTMLButtonElement>(null);
  const overflowAnchorMobileRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowOpenMobile, setOverflowOpenMobile] = useState(false);

  // Auto-scroll to the latest message as stream tokens arrive.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeLeafId, messages, streamingMessageId]);

  const threadPath = useMemo(
    () => pathFromRoot(messages, activeLeafId),
    [messages, activeLeafId],
  );

  // Single TTS instance shared across all bubbles in the thread —
  // starting a read on message B implicitly stops message A. Per-
  // bubble hook calls would have isolated state and lose this
  // behaviour.
  const tts = useReadAloud();
  const messageSuggestions = useChatStore((s) => s.messageSuggestions);

  const handleNew = async () => {
    setMobileListOpen(false);
    const id = await createConversation();
    if (id) await openConversation(id);
  };

  // Wraps openConversation so picking a thread from the mobile
  // drawer also closes the drawer. On desktop the setState is a
  // no-op because the drawer is never open.
  const handleOpenFromDrawer = useCallback(
    (id: string) => {
      setMobileListOpen(false);
      void openConversation(id);
    },
    [openConversation],
  );

  // Composer-shape submit. Composer owns attachments, mode, mic,
  // and provider pick; this surface translates the payload into a
  // chat-store call and handles the surface-specific branch /
  // lazy-create-conversation flows.
  const sendImageMessage = useChatStore((s) => s.sendImageMessage);
  const handleSubmit = useCallback(
    async (payload: ChatComposerSubmitPayload) => {
      const text = payload.text.trim();
      const attachments =
        payload.attachments.length > 0 ? payload.attachments : undefined;
      // Allow sending with attachments only (e.g. "describe this"
      // worth of intent in the image alone).
      if (!text && !attachments) return;
      // Parent clears its controlled input — composer cleared its
      // own attachment + mode state before invoking us.
      setInput("");
      // Image mode: skip the chat-completion path entirely and
      // route to the Images API. Needs an active conversation, so
      // create one lazily like the regular send flow does.
      if (payload.mode === "image") {
        if (!activeId) {
          const id = await createConversation();
          if (!id) return;
          await openConversation(id);
        }
        await sendImageMessage(text);
        return;
      }
      const provider = payload.provider ?? undefined;
      // Topic-first modes swap the system prompt for a single turn.
      // Composer already resets `mode` to "default" after submit so
      // the next turn is a regular chat unless re-picked.
      const sendOptions =
        payload.mode !== "default"
          ? {
              systemPromptOverride: buildRecommendationSystemPrompt(
                payload.mode,
              ),
            }
          : undefined;
      if (branchFromId) {
        const parentId = branchFromId;
        setBranchFromId(null);
        await branchFrom(parentId, text, provider, attachments, sendOptions);
      } else {
        if (!activeId) {
          const id = await createConversation();
          if (!id) return;
          await openConversation(id);
        }
        await sendMessage(text, provider, attachments, sendOptions);
      }
    },
    [
      branchFromId,
      activeId,
      branchFrom,
      createConversation,
      openConversation,
      sendMessage,
      sendImageMessage,
    ],
  );

  // Reading-context loader for the composer's History dropdown.
  // Wrapped here so the composer doesn't need to know about
  // Supabase fetching — it just gets a callback that returns the
  // formatted prompt to prepend.
  const handleLoadReadingContext = useCallback(
    async (mode: "week" | "all") => {
      const books = await fetchRecentReading(
        mode === "week" ? { days: 7, limit: 10 } : { limit: 10 },
      );
      const intro =
        mode === "week"
          ? t("chat.readingContext.weekIntro")
          : t("chat.readingContext.recentIntro");
      return formatReadingContextPrompt(books, intro);
    },
    [t],
  );

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
    <div className="relative flex h-[calc(100vh-3.5rem)] w-full p-0 sm:h-screen">
      {/* Mobile-only backdrop. Tapping it closes the drawer. Hidden
          on desktop where the aside is a permanent column. */}
      {mobileListOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={() => setMobileListOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Sidebar: folder tree + conversations. Static column on
          desktop, slide-in drawer on mobile. The translate-x-0 /
          -translate-x-full toggle drives the slide; sm:translate-x-0
          locks it visible on desktop so the same element serves
          both. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 max-w-[80vw] shrink-0 flex-col gap-3 border-r border-glass-border bg-bg-secondary p-3 transition-transform duration-200",
          "sm:static sm:w-64 sm:translate-x-0 sm:bg-glass-bg/40",
          mobileListOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
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

        {/* Conversation search — filters the tree as the user types.
            Hidden when there are zero conversations to search. */}
        {conversations.length > 0 && (
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              value={conversationSearch}
              onChange={(e) => setConversationSearch(e.target.value)}
              placeholder={t("chat.searchPlaceholder")}
              className="w-full rounded-md border border-glass-border bg-glass-bg/50 px-2 py-1.5 pl-7 pr-7 text-xs text-text-primary outline-none focus:border-accent-purple/60 placeholder:text-text-muted"
            />
            {conversationSearch && (
              <button
                type="button"
                onClick={() => setConversationSearch("")}
                aria-label={t("common.cancel")}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

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
            ) : filteredConversationData.conversations.length === 0 &&
              filteredConversationData.folders.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                {t("chat.searchNoResults")}
              </p>
            ) : (
              <>
                <RootDropZone label={t("chat.folders.dropToRoot")} />
                <ChatTree
                  folders={filteredConversationData.folders}
                  conversations={filteredConversationData.conversations}
                  activeId={activeId}
                  editingId={editingId}
                  editTitle={editTitle}
                  onOpen={handleOpenFromDrawer}
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
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Desktop overflow — mobile has its own header with the menu
            so this is hidden below sm. Floats so it doesn't push the
            messages area down on desktop where there's no header. */}
        <div className="absolute right-2 top-2 z-10 hidden sm:block">
          <button
            ref={overflowAnchorRef}
            onClick={() => setOverflowOpen((v) => !v)}
            className="rounded-md border border-glass-border bg-bg-secondary/70 p-1.5 text-text-muted backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("settings.aiSection.moreActions")}
            title={t("settings.aiSection.moreActions")}
          >
            <MoreVertical size={16} />
          </button>
          <FloatingMenu
            open={overflowOpen}
            anchorRef={overflowAnchorRef}
            onClose={() => setOverflowOpen(false)}
          >
            {activeConversation && (
              <button
                type="button"
                onClick={() => {
                  setOverflowOpen(false);
                  handleExportActive();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Download size={14} />
                {t("chat.exportMarkdown")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOverflowOpen(false);
                navigate("/settings/ai");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Gauge size={14} />
              {t("settings.aiSection.openQuotas")}
            </button>
          </FloatingMenu>
        </div>
        {/* Mobile header — hamburger opens the conversation rail
            drawer so the user can switch chats without losing their
            place. The old "back to list" pattern is gone now that
            the rail is always one tap away. */}
        <div className="flex items-center gap-2 border-b border-glass-border bg-bg-primary/40 px-3 py-2 sm:hidden">
          <button
            onClick={() => setMobileListOpen(true)}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.title")}
          >
            <Menu size={16} />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {activeId
              ? conversations.find((c) => c.id === activeId)?.title ||
                t("chat.untitled")
              : t("chat.title")}
          </span>
          <button
            ref={overflowAnchorMobileRef}
            onClick={() => setOverflowOpenMobile((v) => !v)}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("settings.aiSection.moreActions")}
          >
            <MoreVertical size={16} />
          </button>
          <FloatingMenu
            open={overflowOpenMobile}
            anchorRef={overflowAnchorMobileRef}
            onClose={() => setOverflowOpenMobile(false)}
          >
            {activeConversation && (
              <button
                type="button"
                onClick={() => {
                  setOverflowOpenMobile(false);
                  handleExportActive();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <Download size={14} />
                {t("chat.exportMarkdown")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOverflowOpenMobile(false);
                navigate("/settings/ai");
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Gauge size={14} />
              {t("settings.aiSection.openQuotas")}
            </button>
          </FloatingMenu>
          <button
            onClick={handleNew}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.newConversation")}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Empty state — shows on both mobile and desktop when no
            conversation is active. On mobile the conversation list
            is one hamburger-tap away via the slide-in drawer, so we
            no longer need a separate mobile list page here. */}
        {!activeId && (
          <div className="flex flex-1 items-center justify-center p-6">
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

              {threadPath.map((msg) => {
                const parent = msg.parent_message_id
                  ? messages.get(msg.parent_message_id)
                  : null;
                // Regenerate is meaningful only when the assistant
                // message has a user-message parent we can resend.
                // Falls through to undefined for the first turn /
                // detached messages — the bubble hides the button.
                const handleRegenerate =
                  msg.role === "assistant" && parent && parent.role === "user"
                    ? () => {
                        const grandparent = parent.parent_message_id;
                        const provider = selectedProvider ?? undefined;
                        void branchFrom(
                          grandparent,
                          parent.content,
                          provider,
                          parent.attachments ?? undefined,
                        );
                      }
                    : undefined;
                // Edit is meaningful only on user messages — it
                // branches a sibling with the new text under the
                // same parent. Image attachments carry through so
                // an image+question turn keeps its image when the
                // user just tweaks the question.
                const handleEdit =
                  msg.role === "user"
                    ? (newText: string) => {
                        const provider = selectedProvider ?? undefined;
                        void branchFrom(
                          msg.parent_message_id,
                          newText,
                          provider,
                          msg.attachments ?? undefined,
                        );
                      }
                    : undefined;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    messages={messages}
                    activeLeafId={activeLeafId}
                    streamingMessageId={streamingMessageId}
                    sourceDocId={activeConversation?.source_doc_id ?? null}
                    confirm={confirm}
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
                    onRegenerate={handleRegenerate}
                    onEdit={handleEdit}
                    tts={tts}
                    suggestions={
                      msg.role === "assistant"
                        ? messageSuggestions.get(msg.id)
                        : undefined
                    }
                    onPickSuggestion={(text) => {
                      // Branch from this assistant message — sends a
                      // new user turn under it. Equivalent to typing
                      // the chip into the composer when this is the
                      // active leaf, plus correct branching when it
                      // isn't.
                      const provider = selectedProvider ?? undefined;
                      void branchFrom(msg.id, text, provider);
                    }}
                  />
                );
              })}
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
                <ChatComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSubmit}
                  isStreaming={streamingMessageId !== null}
                  onStop={() => useChatStore.getState().stopStreaming()}
                  onLoadReadingContext={handleLoadReadingContext}
                />
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

/**
 * Assistant message body. Pulls any `pnyxy-books` / `pnyxy-videos`
 * fenced JSON blocks out of the model's reply and renders the
 * remaining prose as markdown, then drops the parsed recommendations
 * underneath as React cards. Behaviour for plain answers (the vast
 * majority): identical to the previous inline markdown render.
 */
function AssistantContent({
  content,
  sourceDocId,
  confirm,
  handleCitationClick,
}: {
  content: string;
  sourceDocId: string | null;
  confirm: (opts: {
    title: string;
    body?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  handleCitationClick: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const { cleaned, books, videos } = useMemo(
    () => extractRecommendations(content),
    [content],
  );
  return (
    <>
      <div
        className="ai-message break-words"
        onClick={(e) => {
          handleCodeBlockCopy(e);
          if (e.defaultPrevented) return;
          const aiLink = detectAiLinkClick(e);
          if (aiLink) {
            void promptOpenAiLink(aiLink, confirm, t);
            return;
          }
          handleCitationClick(e);
        }}
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(cleaned, sourceDocId),
        }}
      />
      {(books || videos) && (
        <RecommendationCards books={books} videos={videos} />
      )}
    </>
  );
}

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

function MessageBubble({
  msg,
  messages,
  activeLeafId,
  streamingMessageId,
  sourceDocId,
  confirm,
  onBranchHere,
  onPickBranch,
  onSaveAsFlashcards,
  onRegenerate,
  onEdit,
  tts,
  suggestions,
  onPickSuggestion,
}: {
  msg: ChatMessage;
  messages: Map<string, ChatMessage>;
  activeLeafId: string | null;
  streamingMessageId: string | null;
  /** Set when the conversation has a source doc — citation tokens
   *  in assistant messages get post-processed into clickable links. */
  sourceDocId: string | null;
  /** Parent's `useConfirm` handle, threaded down so the AI-link
   *  warning modal can reuse the page-level confirm dialog. */
  confirm: (opts: {
    title: string;
    body?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  onBranchHere: () => void;
  onPickBranch: (id: string) => void;
  /** Open the flashcards extractor over this message's content. */
  onSaveAsFlashcards: () => void;
  /** Regenerate this assistant message — re-runs its parent user
   *  message as a sibling branch. Undefined for user messages and
   *  while another stream is in flight. */
  onRegenerate?: () => void;
  /** Edit-in-place for user messages — submits a fresh sibling
   *  branch with the new text under the same parent. Undefined for
   *  assistant messages and while another stream is in flight. */
  onEdit?: (newText: string) => void;
  /** Shared TTS controller from the parent — single utterance lives
   *  at the thread level so starting a read on one message stops
   *  whatever was already speaking. */
  tts: ReturnType<typeof useReadAloud>;
  /** Optional follow-up question chips rendered below the assistant
   *  bubble. Populated by `requestFollowupSuggestions` after the
   *  turn settles; absent for user messages and for assistant
   *  messages whose response was too short / errored / aborted. */
  suggestions?: string[];
  /** Click handler for a suggestion chip — sends it as a new user
   *  message branched from the current assistant. */
  onPickSuggestion?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const isUser = msg.role === "user";
  const isStreaming = msg.id === streamingMessageId;
  const branches = countBranches(messages, msg.id);
  const [showBranches, setShowBranches] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);
  const handleCitationClick = usePageCitationDispatch();

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
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
          isUser
            ? "bg-accent-purple/20 text-text-primary rounded-br-md"
            : "bg-glass-bg text-text-secondary rounded-bl-md",
          // Slightly taller while still empty so the typing indicator
          // sits comfortably; collapses back to py-2 once content is
          // streaming.
          isStreaming && msg.content.trim().length === 0 && "py-3",
        )}
      >
        {/* User messages render as preformatted text (the user typed
            them — no need to interpret markdown). Assistant messages
            go through marked + DOMPurify so code blocks, tables,
            lists, headings, and inline code all render properly. */}
        {isUser ? (
          isEditing ? (
            // Edit-in-place: textarea pre-filled with the original
            // content. Save = `onEdit` → branchFrom under the same
            // parent → fresh sibling branch + new assistant reply.
            // Original message stays accessible via the branch picker.
            <div className="space-y-2">
              <textarea
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const trimmed = editText.trim();
                    if (
                      trimmed.length > 0 &&
                      trimmed !== msg.content.trim() &&
                      onEdit
                    ) {
                      onEdit(trimmed);
                    }
                    setIsEditing(false);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditText(msg.content);
                    setIsEditing(false);
                  }
                }}
                rows={Math.min(8, Math.max(2, msg.content.split("\n").length))}
                className="block w-full resize-none rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1.5 text-sm text-text-primary outline-none focus:border-accent-purple/60"
              />
              <div className="flex justify-end gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setEditText(msg.content);
                    setIsEditing(false);
                  }}
                  className="rounded px-2 py-0.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = editText.trim();
                    if (
                      trimmed.length > 0 &&
                      trimmed !== msg.content.trim() &&
                      onEdit
                    ) {
                      onEdit(trimmed);
                    }
                    setIsEditing(false);
                  }}
                  disabled={
                    !editText.trim() ||
                    editText.trim() === msg.content.trim()
                  }
                  className="rounded bg-accent-purple/80 px-2 py-0.5 font-medium text-white transition-colors hover:bg-accent-purple disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                >
                  {t("chat.editSaveAndSend")}
                </button>
              </div>
            </div>
          ) : (
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
          )
        ) : isStreaming && msg.content.trim().length === 0 ? (
          // Empty assistant placeholder while waiting for the first
          // delta. Showing the typing indicator inside the bubble
          // beats pulsing an empty rectangle — that read as
          // "something's broken" on mobile where the bubble is
          // otherwise just a thin sliver.
          <div className="text-text-muted">
            <TypingIndicator label={t("chat.thinking", { defaultValue: "Thinking…" })} />
          </div>
        ) : (
          <div className="space-y-2">
            {/* Generated image (or any other attachment a future
                tool might emit) on an assistant turn. Rendered
                above the markdown so the image is the visual focal
                point and any caption/explanation reads below it. */}
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
                        alt={att.name ?? "generated image"}
                        className="max-h-96 max-w-full rounded-md object-contain"
                      />
                    </a>
                  ) : null,
                )}
              </div>
            )}
            {msg.content && (
              <AssistantContent
                content={msg.content}
                sourceDocId={sourceDocId}
                confirm={confirm}
                handleCitationClick={handleCitationClick}
              />
            )}
          </div>
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
          {/* Edit: user messages only. Flips the bubble into a
              textarea; on save it branches a sibling under the same
              parent so the original message stays accessible via
              the branch picker. */}
          {isUser && !isStreaming && onEdit && !isEditing && (
            <button
              onClick={() => {
                setEditText(msg.content);
                setIsEditing(true);
              }}
              disabled={streamingMessageId !== null}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title={t("chat.editAction")}
            >
              <Pencil size={10} />
              {t("chat.editAction")}
            </button>
          )}
          {/* Copy: assistant messages only (the user can already
              re-read what they typed; copying their own message is
              a niche need we can add later). Stays disabled while
              streaming so we don't capture a partial response. */}
          {!isUser && !isStreaming && msg.content.trim().length > 0 && (
            <CopyButton text={msg.content} />
          )}
          {/* Regenerate: assistant messages only, parent user msg
              must still exist in the tree (it does unless the
              conversation was edited externally). Disabled while
              another stream is in flight to avoid stacking turns. */}
          {!isUser && !isStreaming && onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={streamingMessageId !== null}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              title={t("chat.regenerate")}
            >
              <RefreshCw size={10} />
              {t("chat.regenerate")}
            </button>
          )}
          {/* Read aloud: assistant messages only, only when the Web
              Speech API is supported, only after streaming finishes
              (don't read a half-complete sentence). Toggles to Stop
              while the same message is speaking. */}
          {!isUser && !isStreaming && tts.supported && msg.content.trim() && (
            <button
              onClick={() => {
                if (tts.speakingId === msg.id) {
                  tts.stop();
                } else {
                  tts.read(msg.id, markdownToSpeech(msg.content));
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-glass-hover hover:text-text-primary cursor-pointer",
                tts.speakingId === msg.id && "text-accent-purple",
              )}
              title={
                tts.speakingId === msg.id
                  ? t("chat.readAloudStop")
                  : t("chat.readAloud")
              }
            >
              <Volume2 size={10} />
              {tts.speakingId === msg.id
                ? t("chat.readAloudStop")
                : t("chat.readAloud")}
            </button>
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

        {/* Follow-up suggestion chips. Only on assistant messages
            once the turn has settled. Hidden once the user has
            already replied to this assistant (countBranches > 0)
            since the chips would be re-asking what the user has
            already moved past. */}
        {!isUser &&
          !isStreaming &&
          suggestions &&
          suggestions.length > 0 &&
          branches === 0 &&
          onPickSuggestion && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onPickSuggestion(q)}
                  disabled={streamingMessageId !== null}
                  className="inline-flex items-center rounded-full border border-glass-border bg-glass-bg/40 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent-purple/50 hover:bg-accent-purple/10 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                >
                  {q}
                </button>
              ))}
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
