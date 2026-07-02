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
  Gauge,
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
} from "lucide-react";
import { ConfirmModal, FloatingMenu, PromptModal } from "@/components/ui";
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
  // Opens the global app-nav Sidebar overlay (Library / Profile /
  // Settings / …). Surfaced inside the chat's conversation drawer since
  // the global MobileTopBar is hidden on /chat.
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

  // The store now fetches conversations ordered by sort_order asc
  // (DB-backed, see migration 00041). No client-side sort layer
  // needed — what comes out of useChatStore is already in display
  // order. Same for folders.
  const sortedConversations = conversations;

  // Drag-and-drop sensors. MouseSensor (not PointerSensor) so touch
  // events are exclusively handled by TouchSensor below — otherwise
  // PointerSensor's distance activation beat TouchSensor's delay on
  // phones and a regular scroll-swipe over a conversation row would
  // start a drag.
  //
  // distance: 14 (was 8) — sidebar rows are tight and stuffed with
  // inline action buttons (Move/Rename/Delete pencils). Clicking
  // those with even slight cursor drift used to trip the 8px
  // threshold and start an unintended drag. 14px sits above typical
  // hand-jitter while staying well below "obvious drag" distances.
  //
  // delay: 600 (was 200) — the long-press context menu fires at
  // 500ms (see use-context-menu.ts). With 200ms the drag always won
  // and touch users could never reach the context menu via
  // long-press. 600ms leaves a clear gap: < 500ms tap → click,
  // 500-600ms hold → context menu, ≥ 600ms hold + movement → drag.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 14 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 600, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Collision detection: pointerWithin matches the dropzone the
  // pointer is actually inside, which is what users expect for
  // drop-into semantics. The earlier closestCenter mis-targeted in
  // two ways: (1) the thin RootDropZone strip has a center far from
  // where users actually drop, so drops near a folder got attributed
  // to root; (2) when a folder is hovered near a sibling boundary,
  // closestCenter picks whichever center is fractionally closer
  // rather than the one the pointer is in.
  //
  // The outer tree wrapper also registers as a "root" droppable so
  // any drop that misses a folder/conv still lands at root (fixes
  // the "I can't drop on root" complaint). Without the area-sort
  // below, that outer droppable would beat nested folder rows
  // because both contain the pointer. Sorting by ascending area
  // means the most specific (smallest) droppable wins — folder row
  // > root container, conversation row > folder row.
  //
  // closestCenter stays as a fallback for when the pointer is in a
  // dead zone between rows so a drop doesn't silently cancel.
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

  // Active drag preview state. Library uses the same pattern: track
  // what's being dragged so a DragOverlay can render a ghost that
  // follows the cursor 1:1, instead of relying on the implicit
  // dnd-kit transform on the in-place row (which feels laggy on
  // the chat sidebar's tighter row heights).
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // Current `over` id during a drag — drives the drop-indicator line
  // that gets rendered in conversation rows. Tracked separately from
  // the active drag because we need to know what the pointer is over
  // *right now*, which dnd-kit updates on every move via onDragOver.
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

  // ─── Sort-order arithmetic helpers ───────────────────────
  // sort_order is a fractional number (double precision in the DB)
  // so we can drop an item between any two existing siblings by
  // computing the midpoint, no batch renumbering needed.
  //
  // `topOf(ctx)` picks `min - 1` so a new item lands above
  // everything else in `ctx` (used by drop-on-folder-body and
  // drop-on-root).
  //
  // `aboveItem(ctx, targetId)` picks the midpoint between target
  // and its predecessor. `ctx` must be the FUTURE state of the
  // context — i.e. excluding the dragged item if it's coming from
  // another context. Result places the dragged item directly above
  // the target, matching the drop-line UX (line at top = "lands
  // above").
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

    // ─── Folder drag ─────────────────────────────────────────
    if (activeId.startsWith("folder:")) {
      const id = activeId.slice("folder:".length);
      const activeFolder = folders.find((f) => f.id === id);
      if (!activeFolder) return;

      if (isRootDrop) {
        // Move to root + position at the top.
        const futureSiblings = folders.filter(
          (f) => f.parent_id === null && f.id !== id,
        );
        void moveFolderToParent(id, null, topOf(futureSiblings));
        return;
      }

      // Folder drop on another folder: same-parent → reorder,
      // different-parent → nest INTO target. Disambiguation by
      // parent comparison rather than hit-zone splitting keeps the
      // model simple — "drop next to a sibling" is the common
      // intent; users who want to nest a sibling use the context
      // menu or first move the source out of the parent.
      if (overId.startsWith("folder:") || overId.startsWith("nest:")) {
        const targetId = overId.startsWith("folder:")
          ? overId.slice("folder:".length)
          : overId.slice("nest:".length);
        if (id === targetId) return;
        const targetFolder = folders.find((f) => f.id === targetId);
        if (!targetFolder) return;

        if (activeFolder.parent_id === targetFolder.parent_id) {
          // Same parent → reorder. Exclude self from the context
          // sample so aboveItem's midpoint math doesn't see the
          // dragged folder's current position.
          const siblings = folders.filter(
            (f) => f.parent_id === targetFolder.parent_id && f.id !== id,
          );
          void reorderFolder(id, aboveItem(siblings, targetId));
        } else {
          // Different parent → nest INTO the target. Place at the
          // top of target's children so the user sees it land
          // somewhere visible without scrolling.
          const futureChildren = folders.filter(
            (f) => f.parent_id === targetId && f.id !== id,
          );
          void moveFolderToParent(id, targetId, topOf(futureChildren));
        }
      }
      return;
    }

    // ─── Conversation drag ───────────────────────────────────
    if (!activeId.startsWith("conv:")) return;
    const convId = activeId.slice("conv:".length);
    const activeConv = conversations.find((c) => c.id === convId);
    if (!activeConv) return;

    // Drop on root: move to root, land at the top of Quick chats.
    if (isRootDrop) {
      const futureRoot = conversations.filter(
        (c) => c.folder_id === null && c.id !== convId,
      );
      void moveConversationToFolder(convId, null, topOf(futureRoot));
      return;
    }

    // Drop on a folder row → nest into folder, land at the top.
    // Both id forms ("folder:" from sortable, "nest:" if any
    // residual non-sortable path still emits them) route here.
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

    // Drop on another conversation: insert above it. Same folder →
    // single-row reorder; different folder → move + position pin
    // in the same write.
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
  // Mobile-only: controls the slide-in conversation rail drawer.
  // Desktop renders the same aside as a static column and ignores
  // this state.
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [branchFromId, setBranchFromId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // Sidebar folder collapse state. Lifted from individual FolderRow
  // useState into the page so the "Collapse all / Expand all"
  // toolbar button can write to every folder at once. A Set of
  // collapsed folder ids — absence means expanded. New folders the
  // user creates start expanded by default (not in the set).
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  // Session-scoped set of conversation ids whose source-page chip
  // the user has dismissed. Not persisted: re-opening the
  // conversation in a new session brings the chip back, which is
  // forgiving for users who didn't mean to hide it permanently.
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

  // Resizable sidebar (desktop only). Width persists per-device via
  // localStorage so reopening the chat lands on the user's preferred
  // size. Same UX as the reader's panel — drag a 4px-wide handle on
  // the right edge between 200px (min, still readable) and 480px
  // (max, before it starts eating the conversation column).
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_STORAGE_KEY = "pnyxy-chat-sidebar-width";
  const isMobile = useIsMobile();
  // Height the soft keyboard covers, so we can lift the composer above
  // it on mobile (visualViewport-backed). 0 on desktop. Mirrors the
  // reader's AiChatPanel, which already does this — the standalone chat
  // page was relying on `100dvh` alone, whose lag/inconsistency on
  // Android made the composer jump out from under the keyboard.
  const keyboardInset = useKeyboardInset();
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      const n = stored ? parseInt(stored, 10) : 256;
      if (Number.isFinite(n)) {
        return Math.min(Math.max(n, SIDEBAR_MIN), SIDEBAR_MAX);
      }
    } catch {
      // localStorage may be blocked in private mode — fall through.
    }
    return 256;
  });
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      // preventDefault keeps the drag from also selecting text
      // inside the sidebar/main pane as the cursor moves.
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
          // Persistence is best-effort; the in-memory width stays.
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

  // Stable handler refs for ChatTree props — without these, every
  // ChatPage re-render (each composer keystroke) feeds fresh
  // function identities into the tree, defeating the memo wrappers
  // on FolderRow / ConversationRow. With useCallback they fire
  // exactly once per state change instead of once per render.
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
      return { conversations: sortedConversations, folders };
    }
    const folderById = new Map(folders.map((f) => [f.id, f]));
    const matched = sortedConversations.filter((c) =>
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
  }, [sortedConversations, folders, conversationSearch]);
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
    console.log("[chat-page-drain] consumed draft", {
      textLen: draft.text.length,
      textPreview: draft.text.slice(0, 80),
      hasSource: !!draft.source,
    });
    // Pre-fill IMMEDIATELY, before any await. Two reasons:
    //   1. The composer is a controlled textarea on local state, so
    //      the value lands regardless of whether the conversation
    //      row has finished creating in Supabase yet.
    //   2. If `openConversation` errors silently (network, RLS), we
    //      still want the user to see their draft text so they can
    //      retry — putting setInput behind await means an error
    //      anywhere upstream silently swallows the prefill.
    setInput(draft.text);
    void (async () => {
      const id = await createConversation(
        "",
        null,
        draft.source ?? null,
        draft.target ?? null,
      );
      if (!id) return;
      await openConversation(id);
      console.log("[chat-page-drain] conversation opened", { id });
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

  // Auto-scroll to the latest message. We split the behavior in two:
  //   - On a fresh conversation open (active conversation changed)
  //     we jump instantly. Smooth scrolling for the whole history
  //     felt sluggish on long threads — the user just wants to be at
  //     the bottom, not animated there.
  //   - During an in-place update (new tokens, new turn within the
  //     same conversation) we keep the smooth behavior so the
  //     reading flow stays natural.
  const lastScrollConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isConvSwitch = lastScrollConvIdRef.current !== activeId;
    lastScrollConvIdRef.current = activeId;
    threadEndRef.current?.scrollIntoView({
      behavior: isConvSwitch ? "auto" : "smooth",
    });
  }, [activeId, activeLeafId, messages, streamingMessageId]);

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

  const handleNewInFolder = useCallback(
    async (folderId: string) => {
      setMobileListOpen(false);
      const id = await createConversation("", folderId);
      if (id) await openConversation(id);
    },
    [createConversation, openConversation],
  );

  // "Collapse all" flips every existing folder into the collapsed
  // set; "Expand all" clears the set so every folder is open.
  const handleCollapseAll = useCallback(() => {
    setCollapsedFolders(new Set(folders.map((f) => f.id)));
  }, [folders]);
  const handleExpandAll = useCallback(() => {
    setCollapsedFolders(new Set());
  }, []);
  // True when every existing folder is in the collapsed set — drives
  // the toolbar button's icon flip (collapse-all vs expand-all).
  const allFoldersCollapsed =
    folders.length > 0 && folders.every((f) => collapsedFolders.has(f.id));

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
      // the next turn is a regular chat unless re-picked. Reasoning
      // is the only sticky flag — the composer keeps it on across
      // turns until the user toggles it off.
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
    <div className="relative flex h-[100dvh] w-full p-0">
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
        // Width is class-driven on mobile (the slide-in drawer is a
        // fixed `w-72`) and inline-style-driven on desktop (the
        // user-resizable static column). The conditional inline style
        // makes the desktop width win without bleeding into the
        // mobile drawer.
        style={!isMobile ? { width: sidebarWidth } : undefined}
        // Mobile: `fixed` so the drawer overlays without occupying
        // layout space — sliding `-translate-x-full` actually hides
        // it. (Earlier this had `relative fixed` together; Tailwind
        // emits `relative` later in the CSS than `fixed`, so the
        // aside resolved to position:relative on mobile, took up
        // width in the flow, and looked like a "permanently open
        // but empty" submenu the user couldn't close.) Desktop:
        // `sm:relative` keeps the aside as a static column AND
        // provides the positioning context the resize handle's
        // `absolute right-0` needs to land on the aside's right
        // edge instead of the chat page's right edge.
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 max-w-[80vw] shrink-0 flex-col gap-3 border-r border-glass-border bg-bg-secondary p-3 transition-transform duration-200",
          // Desktop: trade the flat slab + hard divider for a frosted
          // vertical-gradient pane with a hairline border, so the
          // sidebar reads as glass in the same family as the message
          // bubbles and aurora rather than a heavy block bolted on.
          "sm:relative sm:translate-x-0 sm:border-glass-border/60 sm:bg-gradient-to-b sm:from-bg-secondary/70 sm:to-bg-secondary/30 sm:backdrop-blur-xl",
          mobileListOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Mobile drawer header — the global MobileTopBar is hidden on
            /chat (one contextual top bar per screen), so this row keeps
            app-level navigation one tap away: a nav trigger that opens
            the global Sidebar overlay (Library / Profile / Settings) and
            the brand/home link. Desktop already shows the global Sidebar
            as a column, so this is mobile-only. */}
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

        {/* Top action row. Primary "New conversation" is a full-width
            ghost/outline button with a compose glyph — the highest-
            frequency action, styled as the primary without the heavy
            filled accent block. Secondary actions sit in a smaller row
            of icon-only buttons below: New folder + Collapse/Expand all.
            The collapse toggle's icon flips based on whether every
            existing folder is already collapsed. */}
        <div className="flex flex-col gap-1.5">
          <button
            onClick={handleNew}
            className="flex items-center justify-center gap-2 rounded-md border border-glass-border bg-transparent px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <SquarePen size={14} className="text-accent" />
            {t("chat.newConversation")}
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFolderAction({ kind: "create" })}
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
          {/* Drag preview that follows the cursor 1:1 — matches the
              Library page's DnD pattern. The in-place row still
              animates via dnd-kit's transform; this overlay just
              adds a clearer "what you're dragging" hint. Empty
              when nothing is being dragged. */}
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
        {/* Resize handle — desktop only. 4px wide ribbon on the
            right edge; the hover-only purple tint hints that the
            edge is draggable without taking visual weight when
            idle. Mobile gets a fixed-width drawer so no handle. */}
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
        {/* Aurora backdrop — slow, abstract drift of accent-tinted
            light behind the thread. `isolate` on <main> contains the
            -z-10 layer so it sits behind the messages but in front of
            the page base; pointer-events-none keeps it inert. Blobs
            are parked toward the corners so colour lives in the
            gutters, not under the reading column. */}
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
        {/* Mobile header — the single contextual top bar for /chat now
            that the global MobileTopBar is suppressed here. Hamburger
            opens the conversation rail drawer (which also carries the
            global-nav trigger); title; overflow; new-chat. Owns the
            safe-area top inset the global bar used to provide, so the
            row doesn't slide under the notch/status bar. */}
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
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/80 cursor-pointer"
              >
                <SquarePen size={14} />
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
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4">
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

            {/* Composer — wrapped as a "panel island" on desktop
                (rounded card with breathing room around it). On
                mobile the wrapper keeps its horizontal padding so the
                branching / roadmap pills above stay inset, while
                pb-6 drops to 0 so the composer can sit flush against
                the screen bottom. The composer's flush variant
                breaks out of the px-3 horizontally with a negative
                margin. */}
            <div className="bg-bg-primary/30 px-3 pb-0 pt-3 backdrop-blur-md sm:pb-6">
              {/* Roadmap edit-mode pill — present when this
                  conversation is tied to a roadmap. The AI has tool
                  access; tool calls render as quoted lines inline. */}
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
              {/* Source-document context pill — present when this
                  conversation was started from the reader. Click it
                  to jump back to the page the user was on when they
                  sent the selection. The X hides the chip for this
                  session — the user can still navigate via the chat
                  list, and the chip returns next session in case the
                  dismiss was accidental. */}
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


// ── Sidebar tree ────────────────────────────────────────────

