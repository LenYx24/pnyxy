import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useReadAloud } from "@/hooks/use-read-aloud";
import {
  conversationToMarkdown,
  downloadMarkdown,
} from "@/lib/export-conversation";
import {
  MessagesSquare,
  MoreVertical,
  Network,
  Gauge,
  ChevronDown,
  SquarePen,
  Loader2,
  GitBranch,
  X,
  ChevronsDownUp,
  ChevronsUpDown,
  Menu,
  FolderPlus,
  Folder as FolderIcon,
  BookOpen,
  Map as MapIcon,
  Download,
  Search,
  ArrowLeft,
} from "lucide-react";
import { ConfirmModal, FloatingMenu, PromptModal } from "@/components/ui";
import { ConversationGraph } from "./ConversationGraph";
import { useIsMobile } from "@/hooks/use-media-query";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { buildRecommendationSystemPrompt } from "@/lib/ai/recommendation-prompts";
import { ChatComposer, type ChatComposerSubmitPayload } from "./ChatComposer";
import { MessageBubble } from "./MessageBubble";
import { useConfirm } from "@/hooks/use-confirm";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { restrictToWindowEdges } from "@/lib/dnd-modifiers";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import { useUIStore } from "@/stores/ui-store";
import { useLibraryStore } from "@/stores/library-store";
import {
  useChatStore,
  pathFromRoot,
} from "@/stores/chat-store";
import { useRoadmap, useRoadmapStore } from "@/stores/roadmap-store";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { getConfiguredProviders } from "@/lib/ai/ai-client";
import {
  fetchRecentReading,
  formatReadingContextPrompt,
} from "@/lib/reading-context";
import { SaveAsFlashcardsModal } from "./SaveAsFlashcardsModal";
import { ChatTree, RootDropZone } from "./chat-tree";
import { BookChatTree } from "./BookChatTree";

/**
 * When set, ChatPage runs in "book-scoped" mode: the sidebar lists only this
 * book's conversations (source_doc_id === docId), organized by fork lineage,
 * and every new conversation is tagged with the book so it lives beside it in
 * the library. Reached from a book page's "Chat" entry point.
 */
export interface ChatPageScope {
  docId: string;
  docTitle: string;
  /** Route to return to (the book page); shows a back button when present. */
  backTo?: string;
  backLabel?: string;
}

export function ChatPage({ scope }: { scope?: ChatPageScope } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // opens the global nav overlay
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);

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
  const reorderConversation = useChatStore((s) => s.reorderConversation);
  const reorderFolder = useChatStore((s) => s.reorderFolder);
  // chat folders live in the shared library folders table
  const navigateToLibraryFolder = useLibraryStore((s) => s.navigateToFolder);

  // in book-scoped mode, only this book's conversations (forks copy the
  // source_doc_id, so they come along too)
  const visibleConversations = useMemo(
    () =>
      scope
        ? conversations.filter((c) => c.source_doc_id === scope.docId)
        : conversations,
    [scope, conversations],
  );
  // new conversations started here inherit the book as their source context
  const scopeSource = useMemo(
    () =>
      scope
        ? { docId: scope.docId, docTitle: scope.docTitle, page: null }
        : null,
    [scope],
  );
  // already sorted by sort_order in the store
  const sortedConversations = visibleConversations;

  // MouseSensor (not PointerSensor) so touch scroll goes through TouchSensor and
  // doesn't start a drag. delay 600ms clears the 500ms long-press menu.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 14 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 600, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // smallest droppable wins so the most specific target gets the drop;
  // closestCenter fallback for gaps between rows
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length === 0) return closestCenter(args);
    return within.slice().sort((a, b) => {
      const aRect = args.droppableRects.get(a.id);
      const bRect = args.droppableRects.get(b.id);
      if (!aRect || !bRect) return 0;
      return aRect.width * aRect.height - bRect.width * bRect.height;
    });
  };

  // drives the DragOverlay ghost
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // current `over` id, drives the drop-indicator line
  const [overDragId, setOverDragId] = useState<string | null>(null);
  const activeDragConv = useMemo(() => {
    if (!activeDragId?.startsWith("conv:")) return null;
    const id = activeDragId.slice("conv:".length);
    return conversations.find((c) => c.id === id) ?? null;
  }, [activeDragId, conversations]);
  const activeDragFolder = useMemo(() => {
    if (!activeDragId?.startsWith("folder:")) return null;
    const id = activeDragId.slice("folder:".length);
    return folders.find((f) => f.id === id) ?? null;
  }, [activeDragId, folders]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
    setOverDragId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverDragId((event.over?.id as string | null) ?? null);
  };

  // sort_order is fractional: insert via midpoints, no renumbering.
  // ctx must be the future state (exclude the dragged item if it's moving in).
  const topOf = (ctx: { sort_order: number }[]): number => {
    if (ctx.length === 0) return 0;
    return Math.min(...ctx.map((x) => x.sort_order)) - 1;
  };
  const aboveItem = (
    ctx: { id: string; sort_order: number }[],
    targetId: string,
  ): number => {
    const sorted = [...ctx].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((x) => x.id === targetId);
    if (idx === -1) return topOf(ctx);
    const targetSort = sorted[idx].sort_order;
    if (idx === 0) return targetSort - 1;
    const prevSort = sorted[idx - 1].sort_order;
    return (prevSort + targetSort) / 2;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    setOverDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    const isRootDrop = overId === "root" || overId === "root-pin";

    // folder drag
    if (activeId.startsWith("folder:")) {
      const id = activeId.slice("folder:".length);
      const activeFolder = folders.find((f) => f.id === id);
      if (!activeFolder) return;

      if (isRootDrop) {
        const futureSiblings = folders.filter(
          (f) => f.parent_id === null && f.id !== id,
        );
        void moveFolderToParent(id, null, topOf(futureSiblings));
        return;
      }

      // folder onto folder: same-parent reorders, different-parent nests
      if (overId.startsWith("folder:") || overId.startsWith("nest:")) {
        const targetId = overId.startsWith("folder:")
          ? overId.slice("folder:".length)
          : overId.slice("nest:".length);
        if (id === targetId) return;
        const targetFolder = folders.find((f) => f.id === targetId);
        if (!targetFolder) return;

        if (activeFolder.parent_id === targetFolder.parent_id) {
          const siblings = folders.filter(
            (f) => f.parent_id === targetFolder.parent_id && f.id !== id,
          );
          void reorderFolder(id, aboveItem(siblings, targetId));
        } else {
          const futureChildren = folders.filter(
            (f) => f.parent_id === targetId && f.id !== id,
          );
          void moveFolderToParent(id, targetId, topOf(futureChildren));
        }
      }
      return;
    }

    // conversation drag
    if (!activeId.startsWith("conv:")) return;
    const convId = activeId.slice("conv:".length);
    const activeConv = conversations.find((c) => c.id === convId);
    if (!activeConv) return;

    if (isRootDrop) {
      const futureRoot = conversations.filter(
        (c) => c.folder_id === null && c.id !== convId,
      );
      void moveConversationToFolder(convId, null, topOf(futureRoot));
      return;
    }

    // drop on a folder row: nest in at top
    if (overId.startsWith("folder:") || overId.startsWith("nest:")) {
      const targetFolderId = overId.startsWith("folder:")
        ? overId.slice("folder:".length)
        : overId.slice("nest:".length);
      const futureChildren = conversations.filter(
        (c) => c.folder_id === targetFolderId && c.id !== convId,
      );
      void moveConversationToFolder(
        convId,
        targetFolderId,
        topOf(futureChildren),
      );
      return;
    }

    // drop on another conversation: insert above it
    if (overId.startsWith("conv:")) {
      const overConvId = overId.slice("conv:".length);
      if (overConvId === convId) return;
      const overConv = conversations.find((c) => c.id === overConvId);
      if (!overConv) return;

      const futureContext = conversations.filter(
        (c) => c.folder_id === overConv.folder_id && c.id !== convId,
      );
      const newSortOrder = aboveItem(futureContext, overConvId);

      if (activeConv.folder_id === overConv.folder_id) {
        void reorderConversation(convId, newSortOrder);
      } else {
        void moveConversationToFolder(
          convId,
          overConv.folder_id,
          newSortOrder,
        );
      }
    }
  };

  const [input, setInput] = useState("");
  // mobile-only slide-in conversation drawer
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // collapsed folder ids (absence = expanded), lifted so collapse-all can write all at once
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  // conversation ids whose source-page chip is dismissed, session-only
  const [hiddenSourceChips, setHiddenSourceChips] = useState<Set<string>>(
    () => new Set(),
  );
  const handleHideSourceChip = useCallback((conversationId: string) => {
    setHiddenSourceChips((prev) => {
      const next = new Set(prev);
      next.add(conversationId);
      return next;
    });
  }, []);

  // resizable sidebar (desktop only), width persisted in localStorage
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_STORAGE_KEY = "pnyxy-chat-sidebar-width";
  const isMobile = useIsMobile();
  // soft-keyboard height, lifts the composer. 100dvh alone lagged on Android.
  const keyboardInset = useKeyboardInset();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      const n = stored ? parseInt(stored, 10) : 256;
      if (Number.isFinite(n)) {
        return Math.min(Math.max(n, SIDEBAR_MIN), SIDEBAR_MAX);
      }
    } catch {
      // localStorage can be blocked in private mode
    }
    return 256;
  });
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      // don't select text while dragging
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let lastWidth = startWidth;
      const onMove = (mv: MouseEvent) => {
        const next = Math.min(
          Math.max(startWidth + (mv.clientX - startX), SIDEBAR_MIN),
          SIDEBAR_MAX,
        );
        lastWidth = next;
        setSidebarWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try {
          localStorage.setItem(SIDEBAR_STORAGE_KEY, String(lastWidth));
        } catch {
          // ignore
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );
  const handleToggleFolder = useCallback((id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // stable identities so ChatTree's memoized rows don't re-render on every keystroke
  const handleStartEdit = useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  }, []);
  const handleCancelEdit = useCallback(() => setEditingId(null), []);
  const handleRequestRenameFolder = useCallback(
    (id: string, currentName: string) => {
      setFolderAction({ kind: "rename", id, name: currentName });
    },
    [],
  );
  const handleRequestDeleteFolder = useCallback(
    (id: string, currentName: string) => {
      setFolderAction({ kind: "delete", id, name: currentName });
    },
    [],
  );
  const handleRequestCreateSubfolder = useCallback((parentId: string) => {
    setFolderAction({ kind: "create", parentId });
  }, []);
  const handleOpenFolderInLibrary = useCallback(
    (folderId: string) => {
      navigateToLibraryFolder(folderId);
      navigate("/library");
    },
    [navigateToLibraryFolder, navigate],
  );
  const threadEndRef = useRef<HTMLDivElement>(null);
  // const textareaRef = useRef<HTMLTextAreaElement>(null);

  // model picker: null = default fallback chain, otherwise a strict pick
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    () => getConfiguredProviders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );
  // used by the onPickSuggestion path; composer keeps its own copy
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(
    () => null,
  );
  // title-only case-insensitive substring match
  const [conversationSearch, setConversationSearch] = useState("");
  const filteredConversationData = useMemo(() => {
    const q = conversationSearch.trim().toLowerCase();
    if (!q) {
      return { conversations: sortedConversations, folders };
    }
    const folderById = new Map(folders.map((f) => [f.id, f]));
    const matched = sortedConversations.filter((c) =>
      (c.title || "").toLowerCase().includes(q),
    );
    // keep every ancestor folder of a match so nested hits aren't orphaned
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
  }, [sortedConversations, folders, conversationSearch]);
  // if the picked provider gets disabled, fall back to default
  useEffect(() => {
    if (selectedProvider && !configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(null);
    }
  }, [configuredProviders, selectedProvider]);

  // one folder-action modal at a time, dispatched by `kind`
  type FolderAction =
    // parentId null = root folder
    | { kind: "create"; parentId: string | null }
    | { kind: "rename"; id: string; name: string }
    | { kind: "delete"; id: string; name: string };
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);

  useEffect(() => {
    if (user) {
      fetchConversations();
      fetchFolders();
    }
  }, [user, fetchConversations, fetchFolders]);

  // reader hand-off: drain a stashed draft on mount, create a source-tagged
  // conversation and prefill the composer
  useEffect(() => {
    if (!user) return;
    // reader hand-off drafts always target the global /chat page, not a
    // book-scoped one
    if (scope) return;
    const draft = useChatStore.getState().consumePendingDraft();
    if (!draft) return;
    // prefill before the await so the draft survives an upstream error
    setInput(draft.text);
    void (async () => {
      // createConversation already opens it (sets active + empty thread)
      await createConversation(
        "",
        null,
        draft.source ?? null,
        draft.target ?? null,
      );
    })();
    // drain once per mount / sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // book-scoped: if the store's active conversation belongs to another book
  // (leftover from the global /chat), drop it so we snap to this book's thread
  useEffect(() => {
    if (!scope || !activeId) return;
    const active = conversations.find((c) => c.id === activeId);
    if (active && active.source_doc_id === scope.docId) return;
    useChatStore.getState().clearActive();
  }, [scope, activeId, conversations]);

  // auto-open the most recent conversation on a fresh /chat, unless a
  // reader-handoff draft is in flight
  useEffect(() => {
    if (!user) return;
    if (activeId) return;
    if (visibleConversations.length === 0) return;
    if (!scope && useChatStore.getState().pendingDraft !== null) return;
    void openConversation(visibleConversations[0].id);
  }, [user, activeId, visibleConversations, openConversation, scope]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // export the active thread as Markdown
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

  // roadmap-edit mode: load the roadmap store and resolve its title for the pill
  const targetRoadmapId = activeConversation?.target_roadmap_id ?? null;
  const targetRoadmap = useRoadmap(targetRoadmapId ?? undefined);
  const roadmapsLoaded = useRoadmapStore((s) => s.loaded);
  const loadRoadmaps = useRoadmapStore((s) => s.load);
  useEffect(() => {
    if (targetRoadmapId && !roadmapsLoaded) void loadRoadmaps();
  }, [targetRoadmapId, roadmapsLoaded, loadRoadmaps]);

  // flashcard extractor, held at page level so the modal overlays the app
  const [flashcardSource, setFlashcardSource] = useState<{
    text: string;
    title: string;
  } | null>(null);

  // separate overflow-menu state for desktop and mobile
  const overflowAnchorRef = useRef<HTMLButtonElement>(null);
  const overflowAnchorMobileRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowOpenMobile, setOverflowOpenMobile] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  // tracks whether the thread is scrolled near the bottom; drives both the
  // auto-follow gate and the scroll-to-bottom button
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = dist < 120;
    atBottomRef.current = near;
    setAtBottom(near);
  }, []);
  const scrollToBottom = useCallback(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    atBottomRef.current = true;
    setAtBottom(true);
  }, []);

  // auto-scroll to latest: instant on conversation switch, smooth within it —
  // but only while the user is already at the bottom, so scrolling up to
  // re-read mid-stream isn't yanked back down on every token.
  const lastScrollConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isConvSwitch = lastScrollConvIdRef.current !== activeId;
    lastScrollConvIdRef.current = activeId;
    if (isConvSwitch) {
      atBottomRef.current = true;
      setAtBottom(true);
      threadEndRef.current?.scrollIntoView({ behavior: "auto" });
    } else if (atBottomRef.current) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeId, activeLeafId, messages, streamingMessageId]);

  const threadPath = useMemo(
    () => pathFromRoot(messages, activeLeafId),
    [messages, activeLeafId],
  );

  // one shared TTS instance so reading one bubble stops another
  const tts = useReadAloud();
  const messageSuggestions = useChatStore((s) => s.messageSuggestions);

  const handleNew = async () => {
    setMobileListOpen(false);
    // createConversation already sets it active with an empty thread — no need
    // for a second openConversation round-trip (that was the visible lag).
    await createConversation("", null, scopeSource);
  };

  const handleNewInFolder = useCallback(
    async (folderId: string) => {
      setMobileListOpen(false);
      await createConversation("", folderId, scopeSource);
    },
    [createConversation, scopeSource],
  );

  const handleCollapseAll = useCallback(() => {
    setCollapsedFolders(new Set(folders.map((f) => f.id)));
  }, [folders]);
  const handleExpandAll = useCallback(() => {
    setCollapsedFolders(new Set());
  }, []);
  // flips the toolbar button between collapse-all and expand-all
  const allFoldersCollapsed =
    folders.length > 0 && folders.every((f) => collapsedFolders.has(f.id));

  // opening a thread from the mobile drawer closes it
  const handleOpenFromDrawer = useCallback(
    (id: string) => {
      setMobileListOpen(false);
      void openConversation(id);
    },
    [openConversation],
  );

  // maps the composer payload to a chat-store call (branch / lazy-create flows)
  const sendImageMessage = useChatStore((s) => s.sendImageMessage);
  const handleSubmit = useCallback(
    async (payload: ChatComposerSubmitPayload) => {
      const text = payload.text.trim();
      const attachments =
        payload.attachments.length > 0 ? payload.attachments : undefined;
      // allow attachment-only sends
      if (!text && !attachments) return;
      setInput("");
      // image mode routes to the Images API, needs a conversation first
      if (payload.mode === "image") {
        if (!activeId) {
          const id = await createConversation("", null, scopeSource);
          if (!id) return;
        }
        await sendImageMessage(text);
        return;
      }
      const provider = payload.provider ?? undefined;
      // topic-first modes swap the system prompt for one turn; reasoning is sticky
      const sendOptions =
        payload.mode !== "default" || payload.reasoning
          ? {
              ...(payload.mode !== "default"
                ? {
                    systemPromptOverride: buildRecommendationSystemPrompt(
                      payload.mode,
                    ),
                  }
                : {}),
              ...(payload.reasoning ? { reasoning: true } : {}),
            }
          : undefined;
      if (branchFromId) {
        const parentId = branchFromId;
        setBranchFromId(null);
        await branchFrom(parentId, text, provider, attachments, sendOptions);
      } else {
        if (!activeId) {
          const id = await createConversation("", null, scopeSource);
          if (!id) return;
        }
        await sendMessage(text, provider, attachments, sendOptions);
      }
    },
    [
      branchFromId,
      activeId,
      branchFrom,
      createConversation,
      sendMessage,
      sendImageMessage,
      scopeSource,
    ],
  );

  // reading-context loader for the composer's History dropdown
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
    <div className="relative flex h-[100dvh] w-full p-0">
      {/* mobile backdrop, tap to close the drawer */}
      {mobileListOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={() => setMobileListOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* sidebar: folder tree + conversations. column on desktop, drawer on mobile */}
      <aside
        // resizable width on desktop only; mobile is a fixed w-72 drawer
        style={!isMobile ? { width: sidebarWidth } : undefined}
        // fixed on mobile so the drawer overlays; sm:relative anchors the resize handle
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 max-w-[80vw] shrink-0 flex-col gap-3 border-r border-glass-border bg-bg-secondary p-3 transition-transform duration-200",
          // desktop: frosted gradient glass pane
          "sm:relative sm:translate-x-0 sm:border-glass-border/60 sm:bg-gradient-to-b sm:from-bg-secondary/70 sm:to-bg-secondary/30 sm:backdrop-blur-xl",
          mobileListOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* mobile drawer header: global MobileTopBar is hidden on /chat, so
            this keeps the nav trigger and home link reachable. mobile-only. */}
        <div
          className="flex items-center gap-1.5 sm:hidden"
          style={{ marginTop: "var(--spacing-safe-top, 0px)" }}
        >
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label={t("sidebar.openNav", {
              defaultValue: "Open navigation",
            })}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <Menu size={18} />
          </button>
          <Link
            to="/"
            aria-label="Pnyxy home"
            className="flex items-center"
          >
            <img src="/logo.svg" alt="Pnyxy" className="h-6 w-auto" />
          </Link>
        </div>

        {/* book-scoped banner: back to the book + which book these chats are about */}
        {scope && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() =>
                scope.backTo ? navigate(scope.backTo) : navigate(-1)
              }
              className="flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              <ArrowLeft size={14} />
              {scope.backLabel ||
                t("chat.book.backToBook", { defaultValue: "Back to book" })}
            </button>
            <div className="flex items-center gap-1.5 rounded-md border border-accent-blue/30 bg-accent-blue/10 px-2 py-1.5">
              <BookOpen size={13} className="shrink-0 text-accent-blue" />
              <span
                className="min-w-0 flex-1 truncate text-xs font-medium text-accent-blue"
                title={scope.docTitle}
              >
                {scope.docTitle}
              </span>
            </div>
          </div>
        )}

        {/* header controls: small icon actions + search sit on top, then a
            prominent New conversation button below to nudge starting a chat */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFolderAction({ kind: "create", parentId: null })}
              title={t("chat.folders.create")}
              aria-label={t("chat.folders.create")}
              className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderPlus size={14} />
            </button>
            {folders.length > 0 && (
              <button
                onClick={
                  allFoldersCollapsed
                    ? handleExpandAll
                    : handleCollapseAll
                }
                title={
                  allFoldersCollapsed
                    ? t("chat.sidebar.expandAll", {
                        defaultValue: "Expand all folders",
                      })
                    : t("chat.sidebar.collapseAll", {
                        defaultValue: "Collapse all folders",
                      })
                }
                aria-label={
                  allFoldersCollapsed
                    ? t("chat.sidebar.expandAll", {
                        defaultValue: "Expand all folders",
                      })
                    : t("chat.sidebar.collapseAll", {
                        defaultValue: "Collapse all folders",
                      })
                }
                className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                {allFoldersCollapsed ? (
                  <ChevronsUpDown size={14} />
                ) : (
                  <ChevronsDownUp size={14} />
                )}
              </button>
            )}
          </div>

          {/* conversation search, hidden when there's nothing to search */}
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
                className="w-full rounded-md border border-glass-border bg-glass-bg/50 px-2 py-1.5 pl-7 pr-7 text-xs text-text-primary outline-none focus:border-accent/60 placeholder:text-text-muted"
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

          <button
            onClick={handleNew}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent/90 cursor-pointer"
          >
            <SquarePen size={16} />
            {t("chat.newConversation")}
          </button>
        </div>

        {scope ? (
          <div className="flex-1 space-y-0.5 overflow-y-auto">
            {visibleConversations.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                {t("chat.book.empty", {
                  defaultValue: "No chats about this book yet.",
                })}
              </p>
            ) : filteredConversationData.conversations.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-muted">
                {t("chat.searchNoResults")}
              </p>
            ) : (
              <BookChatTree
                conversations={filteredConversationData.conversations}
                folders={folders}
                activeId={activeId}
                editingId={editingId}
                editTitle={editTitle}
                onOpen={handleOpenFromDrawer}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onSaveTitle={handleSaveTitle}
                onEditTitleChange={setEditTitle}
                onDelete={handleDeleteConversation}
                onMove={moveConversationToFolder}
                onNewInFolder={handleNewInFolder}
                onRequestRenameFolder={handleRequestRenameFolder}
                onRequestDeleteFolder={handleRequestDeleteFolder}
                onOpenFolderInLibrary={handleOpenFolderInLibrary}
                t={t}
              />
            )}
          </div>
        ) : (
        <DndContext
          sensors={dndSensors}
          collisionDetection={collisionDetection}
          modifiers={[restrictToWindowEdges]}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveDragId(null);
            setOverDragId(null);
          }}
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
                  activeDragId={activeDragId}
                  overDragId={overDragId}
                  editingId={editingId}
                  editTitle={editTitle}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={handleToggleFolder}
                  onNewInFolder={handleNewInFolder}
                  onNewSubfolder={handleRequestCreateSubfolder}
                  onOpenFolderInLibrary={handleOpenFolderInLibrary}
                  onOpen={handleOpenFromDrawer}
                  onStartEdit={handleStartEdit}
                  onCancelEdit={handleCancelEdit}
                  onSaveTitle={handleSaveTitle}
                  onEditTitleChange={setEditTitle}
                  onDelete={handleDeleteConversation}
                  onMove={moveConversationToFolder}
                  onRequestRenameFolder={handleRequestRenameFolder}
                  onRequestDeleteFolder={handleRequestDeleteFolder}
                  t={t}
                />
              </>
            )}
          </div>
          {/* drag preview that follows the cursor, empty when nothing is dragging */}
          <DragOverlay dropAnimation={null}>
            {activeDragConv && (
              <div className="pointer-events-none flex items-center gap-2 rounded-md border border-accent/60 bg-bg-secondary/95 px-3 py-1.5 text-xs text-text-primary shadow-lg backdrop-blur-md">
                <MessagesSquare
                  size={12}
                  className="shrink-0 text-accent"
                />
                <span className="truncate max-w-[200px]">
                  {activeDragConv.title || t("chat.untitled")}
                </span>
              </div>
            )}
            {activeDragFolder && (
              <div className="pointer-events-none flex items-center gap-2 rounded-md border border-accent/60 bg-bg-secondary/95 px-3 py-1.5 text-xs text-text-primary shadow-lg backdrop-blur-md">
                <FolderIcon
                  size={12}
                  className="shrink-0 text-accent"
                />
                <span className="truncate max-w-[200px]">
                  {activeDragFolder.name}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
        )}
        {/* resize handle, desktop only (mobile drawer is fixed width) */}
        {!isMobile && (
          <div
            onMouseDown={handleSidebarResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("chat.sidebar.resize", {
              defaultValue: "Resize sidebar",
            })}
            className="absolute inset-y-0 right-0 z-10 hidden w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40 sm:block"
          />
        )}
      </aside>

      {/* Main pane */}
      <main
        className="relative isolate flex min-w-0 flex-1 flex-col transition-[padding] duration-150 ease-out"
        style={{
          paddingBottom: keyboardInset > 0 ? keyboardInset : undefined,
        }}
      >
        {showGraph && (
          <div className="absolute inset-0 z-20 flex flex-col bg-bg-primary/95 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-glass-border px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Network size={16} className="text-accent" />
                {t("chat.graph.title", { defaultValue: "Conversation graph" })}
              </span>
              <button
                type="button"
                onClick={() => setShowGraph(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                aria-label={t("common.close", { defaultValue: "Close" })}
              >
                <X size={16} />
              </button>
            </div>
            <ConversationGraph
              className="min-h-0 flex-1"
              scopeDocId={scope?.docId}
              onOpen={(id) => {
                void openConversation(id);
                setShowGraph(false);
              }}
            />
          </div>
        )}
        {/* aurora backdrop. `isolate` on <main> keeps the -z-10 layer
            behind the messages; pointer-events-none keeps it inert */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div
            className="chat-aurora__blob h-[34rem] w-[34rem] -left-32 -top-40 bg-accent/20"
            style={{ animation: "aurora-a 24s ease-in-out infinite" }}
          />
          <div
            className="chat-aurora__blob h-[30rem] w-[30rem] -right-28 top-1/4 bg-accent-blue/15"
            style={{ animation: "aurora-b 31s ease-in-out infinite" }}
          />
          <div
            className="chat-aurora__blob h-[32rem] w-[32rem] bottom-[-12rem] left-1/3 bg-accent/15"
            style={{ animation: "aurora-c 27s ease-in-out infinite" }}
          />
        </div>
        {/* desktop overflow, floats so it doesn't push the thread down.
            mobile has its own header menu */}
        <div className="absolute right-2 top-2 z-10 hidden items-center gap-1 sm:flex">
          <button
            onClick={() => setShowGraph(true)}
            className="rounded-md border border-glass-border bg-bg-secondary/70 p-1.5 text-text-muted backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.graph.title", { defaultValue: "Conversation graph" })}
            title={t("chat.graph.title", { defaultValue: "Conversation graph" })}
          >
            <Network size={16} />
          </button>
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
        {/* mobile header: the only top bar on /chat. hamburger opens the
            conversation drawer. owns the safe-area top inset itself. */}
        <div
          className="flex items-center gap-2 border-b border-glass-border bg-bg-primary/40 px-3 pb-2 sm:hidden"
          style={{ paddingTop: "calc(0.5rem + var(--spacing-safe-top, 0px))" }}
        >
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
            className="rounded-md p-1 text-accent transition-colors hover:bg-glass-hover cursor-pointer"
            aria-label={t("chat.newConversation")}
          >
            <SquarePen size={18} />
          </button>
        </div>

        {/* empty state, shown on mobile and desktop when no conversation is active */}
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
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/80 cursor-pointer"
              >
                <SquarePen size={14} />
                {t("chat.newConversation")}
              </button>
            </div>
          </div>
        )}

        {/* active conversation, message column capped at max-w-3xl and centered */}
        {activeId && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4"
            >
              <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3">
              {isLoading && threadPath.length === 0 && (
                <div
                  className="flex items-center justify-center py-16"
                  aria-label={t("chat.loading")}
                >
                  <Loader2
                    size={28}
                    className="animate-spin text-accent/80"
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
                // regenerate needs an assistant message with a user parent to resend;
                // undefined otherwise (first turn / detached) hides the button
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
                // edit only on user messages: branches a sibling under the same
                // parent, carrying attachments so an image+question keeps its image
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
                    onDelete={async () => {
                      const ok = await confirm({
                        title: t("chat.confirmDeleteMessageTitle", {
                          defaultValue: "Delete this message?",
                        }),
                        body: t("chat.confirmDeleteMessageBody", {
                          defaultValue:
                            "Every reply and follow-up underneath this message will also be removed. The deletion is permanent.",
                        }),
                        confirmLabel: t("common.delete"),
                        danger: true,
                      });
                      if (!ok) return;
                      await useChatStore.getState().deleteMessage(msg.id);
                    }}
                    onDuplicate={async () => {
                      await useChatStore
                        .getState()
                        .duplicateFromMessage(msg.id);
                    }}
                    tts={tts}
                    suggestions={
                      msg.role === "assistant"
                        ? messageSuggestions.get(msg.id)
                        : undefined
                    }
                    onPickSuggestion={(text) => {
                      // branch a new user turn under this assistant message
                      const provider = selectedProvider ?? undefined;
                      void branchFrom(msg.id, text, provider);
                    }}
                  />
                );
              })}
              <div ref={threadEndRef} />
              </div>
            </div>
            {/* jump-to-latest, shown when the user has scrolled up (e.g. reading
                while the answer is still streaming) */}
            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label={t("chat.scrollToBottom", {
                  defaultValue: "Scroll to latest",
                })}
                title={t("chat.scrollToBottom", {
                  defaultValue: "Scroll to latest",
                })}
                className="absolute bottom-3 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-glass-border bg-bg-secondary/90 text-text-muted shadow-lg backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <ChevronDown size={18} />
              </button>
            )}
            </div>

            {/* composer wrapper. keeps horizontal padding on mobile so the pills
                stay inset; pb drops to 0 so the composer sits flush to the bottom */}
            <div className="bg-bg-primary/30 px-3 pb-0 pt-3 backdrop-blur-md sm:pb-6">
              {/* roadmap edit-mode pill, shown when this conversation is tied to a roadmap */}
              {targetRoadmapId && (
                <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-2 py-1.5 text-xs text-accent">
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
                    className="rounded px-1.5 py-0.5 text-2xs underline-offset-2 hover:bg-accent/20 hover:underline cursor-pointer"
                  >
                    {t("chat.openInEditor")}
                  </a>
                </div>
              )}
              {/* source-document pill, shown when this conversation started from the
                  reader. click jumps back to the page; X hides it for the session */}
              {activeConversation?.source_doc_id &&
                !hiddenSourceChips.has(activeConversation.id) && (
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
                      className="rounded px-1.5 py-0.5 text-2xs underline-offset-2 hover:bg-accent-blue/20 hover:underline cursor-pointer"
                    >
                      {t("chat.openInReader")}
                    </a>
                    <button
                      onClick={() =>
                        handleHideSourceChip(activeConversation.id)
                      }
                      title={t("chat.hideSourceChip", {
                        defaultValue: "Hide for this session",
                      })}
                      aria-label={t("chat.hideSourceChip", {
                        defaultValue: "Hide for this session",
                      })}
                      className="rounded p-0.5 text-accent-blue/70 transition-colors hover:bg-accent-blue/20 hover:text-accent-blue cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}
              {branchParent && (
                <div className="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent/10 px-2 py-1.5 text-xs text-accent">
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
                    className="rounded p-0.5 hover:bg-accent/20 cursor-pointer"
                    aria-label={t("common.cancel")}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {/* composer island: textarea, mic, send and controls in one rounded card */}
              <div className="mx-auto w-full max-w-3xl">
                <ChatComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={handleSubmit}
                  isStreaming={streamingMessageId !== null}
                  onStop={() => useChatStore.getState().stopStreaming()}
                  onLoadReadingContext={handleLoadReadingContext}
                  edgeToEdgeOnMobile
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

      {/* folder action modals, one at a time by folderAction.kind */}
      <PromptModal
        open={folderAction?.kind === "create"}
        title={t("chat.folders.create")}
        placeholder={t("chat.folders.namePrompt")}
        onClose={() => setFolderAction(null)}
        onSubmit={(name) => {
          void createFolder(
            name,
            folderAction?.kind === "create" ? folderAction.parentId : null,
          );
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

