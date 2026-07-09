import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  defaultDropAnimationSideEffects,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  restrictToVerticalAxis,
  restrictToWindowEdges,
} from "@/lib/dnd-modifiers";
import {
  conversationDisplayTitle,
  noteDisplayTitle,
  whiteboardDisplayTitle,
} from "@/lib/entity-title";
import {
  ChevronRight,
  ArrowUp,
  BookOpen,
  Folder,
  FileText,
  Shapes,
  ListChecks,
  MessageSquare,
  Globe,
  LayoutGrid,
  RotateCw,
  X,
  Check,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Button, GlassCard, ConfirmModal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore, type Note } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { WhiteboardData } from "@/types/whiteboard";
import { useQuizStore } from "@/stores/quiz-store";
import type { Quiz } from "@/types/quiz";
import { useChatStore } from "@/stores/chat-store";
import type { ChatConversation } from "@/types/chat";
import { useResourceStore } from "@/stores/resource-store";
import type { Resource } from "@/types/resource";
import { displayHost } from "@/lib/resource-url";
import { useTagStore } from "@/stores/tag-store";
import { useUploadStore, type UploadJob } from "@/stores/upload-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useIsMobile } from "@/hooks/use-media-query";
import { formatShortcut } from "@/lib/keyboard-shortcuts";
import { FolderCard } from "./FolderCard";
import { LibraryBookCard } from "./LibraryBookCard";
import { LibraryNoteCard } from "./LibraryNoteCard";
import { LibraryWhiteboardCard } from "./LibraryWhiteboardCard";
import { LibraryQuizCard } from "./LibraryQuizCard";
import { LibraryChatCard } from "./LibraryChatCard";
import { LibraryResourceCard } from "./LibraryResourceCard";
import { LibraryListView } from "./LibraryListView";
import { CreateFolderModal } from "./modals/CreateFolderModal";
import { BookCardSkeleton } from "./BookCardSkeleton";
import {
  readBookCounts,
  getCachedCount,
} from "./bookCountCache";
import { useOrgStore } from "@/stores/org-store";
import { applySort } from "./useLibraryPrefs";
import type { ViewMode, ListColumnWidths } from "./useLibraryPrefs";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { BookStatusTag } from "@/types/database";
import type { Folder as FolderType } from "@/types/database";

/** Which kind of library item to show. "all" shows everything.
 *  Folders are navigation and stay visible regardless of the pick. */
type ItemTypeFilter =
  | "all"
  | "books"
  | "notes"
  | "whiteboards"
  | "quizzes"
  | "chats"
  | "resources";

const ITEM_TYPE_FILTERS: {
  value: ItemTypeFilter;
  icon: LucideIcon;
  labelKey: string;
  defaultLabel: string;
}[] = [
  { value: "all", icon: LayoutGrid, labelKey: "library.typeFilter.all", defaultLabel: "All" },
  { value: "books", icon: BookOpen, labelKey: "library.typeFilter.books", defaultLabel: "Books" },
  { value: "notes", icon: FileText, labelKey: "library.typeFilter.notes", defaultLabel: "Notes" },
  { value: "whiteboards", icon: Shapes, labelKey: "library.typeFilter.whiteboards", defaultLabel: "Whiteboards" },
  { value: "quizzes", icon: ListChecks, labelKey: "library.typeFilter.quizzes", defaultLabel: "Quizzes" },
  { value: "chats", icon: MessageSquare, labelKey: "library.typeFilter.chats", defaultLabel: "Chats" },
  { value: "resources", icon: Globe, labelKey: "library.typeFilter.resources", defaultLabel: "Resources" },
];

interface AllBooksTabProps {
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  viewMode: ViewMode;
  cardSize: number;
  searchQuery: string;
  selectedIds: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  /** Reports the current on-screen item order (filtered + sorted) so
   *  the parent's shift-range selection spans exactly what's visible. */
  onOrderedKeysChange?: (keys: string[]) => void;
  activeTag?: BookStatusTag | null;
  sortOrders: Record<string, string[]>;
  setSortOrder: (contextId: string, orderedKeys: string[]) => void;
  listColumnWidths: ListColumnWidths;
  setListColumnWidth: (key: keyof ListColumnWidths, width: number) => void;
  isLoading?: boolean;
  /** Right-click handler for the library area (new folder / upload). */
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function AllBooksTab({
  onMoveBook,
  onRemoveBook,
  viewMode,
  cardSize,
  searchQuery,
  selectedIds,
  selectionActive,
  onToggleSelect,
  onOrderedKeysChange,
  activeTag = null,
  sortOrders,
  setSortOrder,
  listColumnWidths,
  setListColumnWidth,
  isLoading = false,
  onContextMenu,
}: AllBooksTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);
  const folderPath = useLibraryStore((s) => s.folderPath);
  const folders = useLibraryStore((s) => s.folders);
  const books = useLibraryStore((s) => s.books);
  const navigateToFolder = useLibraryStore((s) => s.navigateToFolder);
  const createFolderPath = useLibraryStore((s) => s.createFolderPath);
  const renameFolder = useLibraryStore((s) => s.renameFolder);
  const deleteFolder = useLibraryStore((s) => s.deleteFolder);
  const moveBookToFolder = useLibraryStore((s) => s.moveBookToFolder);
  const moveFolderToFolder = useLibraryStore((s) => s.moveFolderToFolder);

  // Mirror the current folder into a ?folder= search param so the browser /
  // phone back button pops folder levels one at a time (each nav-in pushes a
  // history entry). Folder nav is otherwise store-only with no URL trace, so
  // back would leave /library entirely. lastSyncedFolderRef breaks the
  // store<->URL echo: whichever side initiates a change stamps the ref, and
  // the opposite effect no-ops when it already matches.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFolder = searchParams.get("folder");
  const lastSyncedFolderRef = useRef<string | null | undefined>(undefined);

  // store -> URL (push a history entry so Back can pop it)
  useEffect(() => {
    const cur = currentFolderId ?? null;
    if (lastSyncedFolderRef.current === cur) return;
    // On the very first run the store is still at its default (root) while a
    // deep-link URL may already carry ?folder=X. Don't wipe that param before
    // the URL->store effect gets to consume it — let it drive instead.
    if (lastSyncedFolderRef.current === undefined && cur === null) {
      const inUrl = new URLSearchParams(window.location.search).get("folder");
      if (inUrl) {
        lastSyncedFolderRef.current = null;
        return;
      }
    }
    lastSyncedFolderRef.current = cur;
    const next = new URLSearchParams(window.location.search);
    if (cur) next.set("folder", cur);
    else next.delete("folder");
    setSearchParams(next);
  }, [currentFolderId, setSearchParams]);

  // URL -> store (handles Back/Forward and folder deep-links)
  useEffect(() => {
    const target = urlFolder ?? null;
    if (target === (useLibraryStore.getState().currentFolderId ?? null)) return;
    lastSyncedFolderRef.current = target;
    navigateToFolder(target);
  }, [urlFolder, navigateToFolder]);

  // notes live in IndexedDB, not the library store. loadNotes is idempotent.
  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const moveNoteToFolder = useNoteStore((s) => s.moveNoteToFolder);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const loadWhiteboards = useWhiteboardStore((s) => s.loadWhiteboards);
  const moveWhiteboardToFolder = useWhiteboardStore(
    (s) => s.moveWhiteboardToFolder,
  );
  const quizzes = useQuizStore((s) => s.myQuizzes);
  const fetchMyQuizzes = useQuizStore((s) => s.fetchMine);
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const conversations = useChatStore((s) => s.conversations);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const moveConversationToFolder = useChatStore(
    (s) => s.moveConversationToFolder,
  );
  const resources = useResourceStore((s) => s.resources);
  const fetchResources = useResourceStore((s) => s.fetchResources);
  const moveResourceToFolder = useResourceStore((s) => s.moveResourceToFolder);
  useEffect(() => {
    void loadNotes();
    void loadWhiteboards();
    void fetchMyQuizzes();
    void fetchConversations();
    void fetchResources();
  }, [loadNotes, loadWhiteboards, fetchMyQuizzes, fetchConversations, fetchResources]);

  const getTagsForBook = useTagStore((s) => s.getTagsForBook);

  const subfolders = useMemo(
    () => folders.filter((f) => f.parent_id === currentFolderId),
    [folders, currentFolderId],
  );
  const booksInFolder = useMemo(
    () => books.filter((b) => b.folder_id === currentFolderId),
    [books, currentFolderId],
  );
  const notesInFolder = useMemo(
    () => notes.filter((n) => n.folderId === currentFolderId),
    [notes, currentFolderId],
  );
  const whiteboardsInFolder = useMemo(
    () => whiteboards.filter((w) => (w.folderId ?? null) === currentFolderId),
    [whiteboards, currentFolderId],
  );
  const quizzesInFolder = useMemo(
    () => quizzes.filter((q) => (q.folder_id ?? null) === currentFolderId),
    [quizzes, currentFolderId],
  );
  const chatsInFolder = useMemo(
    () => conversations.filter((c) => (c.folder_id ?? null) === currentFolderId),
    [conversations, currentFolderId],
  );
  const resourcesInFolder = useMemo(
    () => resources.filter((r) => (r.folder_id ?? null) === currentFolderId),
    [resources, currentFolderId],
  );

  // Item-type filter (Books / Notes / … / All). When not "all", only that
  // type's items render; folders always stay visible (they're navigation).
  const [typeFilter, setTypeFilter] = useState<ItemTypeFilter>("all");
  const showType = useCallback(
    (type: Exclude<ItemTypeFilter, "all">) =>
      typeFilter === "all" || typeFilter === type,
    [typeFilter],
  );

  // Apply search + tag filter
  const query = searchQuery.toLowerCase().trim();
  const filteredFolders = useMemo(
    () =>
      query
        ? subfolders.filter((f) => f.name.toLowerCase().includes(query))
        : subfolders,
    [subfolders, query],
  );
  const filteredBooks = useMemo(() => {
    if (!showType("books")) return [] as UnifiedLibraryItem[];
    let result = booksInFolder;
    if (query) {
      result = result.filter((b) => {
        const title =
          b.source === "catalog" ? b.catalog_book.title : b.book.title;
        const author =
          b.source === "catalog"
            ? b.catalog_book.authors?.join(", ") || ""
            : b.book.author || "";
        const lower = title.toLowerCase() + " " + author.toLowerCase();
        return lower.includes(query);
      });
    }
    if (activeTag) {
      result = result.filter((b) => getTagsForBook(b).includes(activeTag));
    }
    return result;
  }, [booksInFolder, query, activeTag, getTagsForBook, showType]);

  // active book status-tag hides notes entirely; else match on title.
  const filteredNotes = useMemo(() => {
    if (activeTag || !showType("notes")) return [] as Note[];
    if (!query) return notesInFolder;
    return notesInFolder.filter((n) =>
      (n.title || "").toLowerCase().includes(query),
    );
  }, [notesInFolder, query, activeTag, showType]);

  const filteredWhiteboards = useMemo(() => {
    if (activeTag || !showType("whiteboards")) return [] as WhiteboardData[];
    if (!query) return whiteboardsInFolder;
    return whiteboardsInFolder.filter((w) =>
      (w.title || "").toLowerCase().includes(query),
    );
  }, [whiteboardsInFolder, query, activeTag, showType]);

  const filteredQuizzes = useMemo(() => {
    if (activeTag || !showType("quizzes")) return [] as Quiz[];
    if (!query) return quizzesInFolder;
    return quizzesInFolder.filter((q) =>
      (q.title || "").toLowerCase().includes(query),
    );
  }, [quizzesInFolder, query, activeTag, showType]);

  const filteredChats = useMemo(() => {
    if (activeTag || !showType("chats")) return [] as ChatConversation[];
    if (!query) return chatsInFolder;
    return chatsInFolder.filter((c) =>
      (c.title || "").toLowerCase().includes(query),
    );
  }, [chatsInFolder, query, activeTag, showType]);

  const filteredResources = useMemo(() => {
    if (activeTag || !showType("resources")) return [] as Resource[];
    if (!query) return resourcesInFolder;
    return resourcesInFolder.filter((r) =>
      (r.title || "").toLowerCase().includes(query),
    );
  }, [resourcesInFolder, query, activeTag, showType]);

  const contextId = currentFolderId ?? "root";
  const savedOrder = sortOrders[contextId];

  // combined sortable keys: folders first, then books/notes/etc
  const allItemKeys = useMemo(() => {
    const folderKeys = filteredFolders.map((f) => `folder:${f.id}`);
    const bookKeys = filteredBooks.map((b) => `book:${b.id}`);
    const noteKeys = filteredNotes.map((n) => `note:${n.id}`);
    const whiteboardKeys = filteredWhiteboards.map((w) => `whiteboard:${w.id}`);
    const quizKeys = filteredQuizzes.map((q) => `quiz:${q.id}`);
    const chatKeys = filteredChats.map((c) => `chat:${c.id}`);
    const resourceKeys = filteredResources.map((r) => `resource:${r.id}`);
    return [
      ...folderKeys,
      ...bookKeys,
      ...noteKeys,
      ...whiteboardKeys,
      ...quizKeys,
      ...chatKeys,
      ...resourceKeys,
    ];
  }, [
    filteredFolders,
    filteredBooks,
    filteredNotes,
    filteredWhiteboards,
    filteredQuizzes,
    filteredChats,
    filteredResources,
  ]);

  const orderedKeys = useMemo(
    () => applySort(savedOrder, allItemKeys),
    [savedOrder, allItemKeys],
  );

  // Report the live display order up so shift-range selection matches
  // exactly what's on screen.
  useEffect(() => {
    onOrderedKeysChange?.(orderedKeys);
  }, [orderedKeys, onOrderedKeysChange]);

  const folderMap = useMemo(() => {
    const m = new Map<string, FolderType>();
    for (const f of filteredFolders) m.set(`folder:${f.id}`, f);
    return m;
  }, [filteredFolders]);

  const bookMap = useMemo(() => {
    const m = new Map<string, UnifiedLibraryItem>();
    for (const b of filteredBooks) m.set(`book:${b.id}`, b);
    return m;
  }, [filteredBooks]);

  const noteMap = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of filteredNotes) m.set(`note:${n.id}`, n);
    return m;
  }, [filteredNotes]);

  const whiteboardMap = useMemo(() => {
    const m = new Map<string, WhiteboardData>();
    for (const w of filteredWhiteboards) m.set(`whiteboard:${w.id}`, w);
    return m;
  }, [filteredWhiteboards]);

  const quizMap = useMemo(() => {
    const m = new Map<string, Quiz>();
    for (const q of filteredQuizzes) m.set(`quiz:${q.id}`, q);
    return m;
  }, [filteredQuizzes]);

  const chatMap = useMemo(() => {
    const m = new Map<string, ChatConversation>();
    for (const c of filteredChats) m.set(`chat:${c.id}`, c);
    return m;
  }, [filteredChats]);

  const resourceMap = useMemo(() => {
    const m = new Map<string, Resource>();
    for (const r of filteredResources) m.set(`resource:${r.id}`, r);
    return m;
  }, [filteredResources]);

  // keys come from the same filtered lists as the maps, so every get() resolves
  const orderedFolders = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("folder:"))
        .map((k) => folderMap.get(k)!),
    [orderedKeys, folderMap],
  );
  const orderedBooks = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("book:"))
        .map((k) => bookMap.get(k)!),
    [orderedKeys, bookMap],
  );
  const orderedNotes = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("note:"))
        .map((k) => noteMap.get(k)!),
    [orderedKeys, noteMap],
  );
  const orderedWhiteboards = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("whiteboard:"))
        .map((k) => whiteboardMap.get(k)!),
    [orderedKeys, whiteboardMap],
  );
  const orderedQuizzes = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("quiz:"))
        .map((k) => quizMap.get(k)!),
    [orderedKeys, quizMap],
  );
  const orderedChats = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("chat:"))
        .map((k) => chatMap.get(k)!),
    [orderedKeys, chatMap],
  );
  const orderedResources = useMemo(
    () =>
      orderedKeys
        .filter((k) => k.startsWith("resource:"))
        .map((k) => resourceMap.get(k)!),
    [orderedKeys, resourceMap],
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    // MouseSensor, not PointerSensor: PointerSensor's distance beat the touch
    // delay so a mobile scroll-swipe kept starting a drag at 8px.
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // long-press to drag so tap still navigates and swipe still scrolls
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // nest/breadcrumb win when the cursor is inside them. The list-view nest
  // droppable shares a row's center, so closestCenter alone ties and drops
  // fall back to reorder. Everything else uses closestCenter.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerHits = pointerWithin(args);
    const explicit = pointerHits.filter((c) => {
      const id = String(c.id);
      return id.startsWith("nest:") || id.startsWith("breadcrumb:");
    });
    if (explicit.length > 0) return explicit;
    return closestCenter(args);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // nest droppable (middle of a folder row): move dragged item into it
      if (overId.startsWith("nest:")) {
        const targetFolderId = overId.slice("nest:".length);
        if (activeId.startsWith("book:")) {
          const book = bookMap.get(activeId);
          if (book) void moveBookToFolder(book, targetFolderId);
        } else if (activeId.startsWith("note:")) {
          moveNoteToFolder(activeId.slice("note:".length), targetFolderId);
        } else if (activeId.startsWith("whiteboard:")) {
          moveWhiteboardToFolder(
            activeId.slice("whiteboard:".length),
            targetFolderId,
          );
        } else if (activeId.startsWith("quiz:")) {
          void moveQuizToFolder(activeId.slice("quiz:".length), targetFolderId);
        } else if (activeId.startsWith("chat:")) {
          void moveConversationToFolder(
            activeId.slice("chat:".length),
            targetFolderId,
          );
        } else if (activeId.startsWith("resource:")) {
          void moveResourceToFolder(
            activeId.slice("resource:".length),
            targetFolderId,
          );
        } else if (activeId.startsWith("folder:")) {
          const draggedFolderId = activeId.slice("folder:".length);
          if (draggedFolderId !== targetFolderId) {
            void moveFolderToFolder(draggedFolderId, targetFolderId);
          }
        }
        return;
      }

      // drop onto a crumb (incl. root) to move to that level; only way to pull
      // a nested folder back out to the top level.
      if (overId.startsWith("breadcrumb:")) {
        const tail = overId.slice("breadcrumb:".length);
        const targetFolderId = tail === "root" ? null : tail;
        if (activeId.startsWith("book:")) {
          const book = bookMap.get(activeId);
          if (book) void moveBookToFolder(book, targetFolderId);
        } else if (activeId.startsWith("note:")) {
          moveNoteToFolder(activeId.slice("note:".length), targetFolderId);
        } else if (activeId.startsWith("whiteboard:")) {
          moveWhiteboardToFolder(
            activeId.slice("whiteboard:".length),
            targetFolderId,
          );
        } else if (activeId.startsWith("quiz:")) {
          void moveQuizToFolder(activeId.slice("quiz:".length), targetFolderId);
        } else if (activeId.startsWith("chat:")) {
          void moveConversationToFolder(
            activeId.slice("chat:".length),
            targetFolderId,
          );
        } else if (activeId.startsWith("resource:")) {
          void moveResourceToFolder(
            activeId.slice("resource:".length),
            targetFolderId,
          );
        } else if (activeId.startsWith("folder:")) {
          const draggedFolderId = activeId.slice("folder:".length);
          if (draggedFolderId !== targetFolderId) {
            void moveFolderToFolder(draggedFolderId, targetFolderId);
          }
        }
        return;
      }

      // sortable target: reorder the sibling list
      const oldIndex = orderedKeys.indexOf(activeId);
      const newIndex = orderedKeys.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(orderedKeys, oldIndex, newIndex);
      setSortOrder(contextId, newOrder);
    },
    [
      orderedKeys,
      contextId,
      setSortOrder,
      bookMap,
      moveBookToFolder,
      moveFolderToFolder,
      moveNoteToFolder,
      moveWhiteboardToFolder,
      moveQuizToFolder,
      moveConversationToFolder,
      moveResourceToFolder,
    ],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  // when set, new folders parent here instead of currentFolderId (New subfolder)
  const [createParentOverride, setCreateParentOverride] = useState<
    string | null | undefined
  >(undefined);

  const handleCreateFolder = useCallback(() => {
    setCreateParentOverride(undefined);
    setCreateFolderOpen(true);
  }, []);

  const handleCreateSubfolder = useCallback((parentFolderId: string) => {
    setCreateParentOverride(parentFolderId);
    setCreateFolderOpen(true);
  }, []);

  const handleConfirmCreateFolder = async (name: string) => {
    // name may be a slash path like "p1/p2/p3"; createFolderPath walks each segment
    const parent =
      createParentOverride !== undefined
        ? createParentOverride
        : currentFolderId;
    await createFolderPath(name, parent);
  };

  const handleDeleteFolder = (id: string) => {
    setConfirmDelete(id);
  };

  const confirmDeleteFolder = async () => {
    if (!confirmDelete) return;
    await deleteFolder(confirmDelete);
    setConfirmDelete(null);
  };

  const parentFolderId = currentFolderId
    ? folderPath.length > 1
      ? folderPath[folderPath.length - 2].id
      : null
    : null;

  const handleGoUp = useCallback(() => {
    if (!currentFolderId) return;
    navigateToFolder(parentFolderId);
  }, [currentFolderId, parentFolderId, navigateToFolder]);

  useKeyboardShortcut({
    id: "library:new-folder",
    key: "f",
    ctrl: true,
    shift: true,
    description: "Create a new folder",
    handler: handleCreateFolder,
  });

  useKeyboardShortcut({
    id: "library:go-up",
    key: "Backspace",
    alt: true,
    description: "Go to parent folder",
    handler: handleGoUp,
  });

  const isEmpty =
    filteredFolders.length === 0 &&
    filteredBooks.length === 0 &&
    filteredNotes.length === 0 &&
    filteredWhiteboards.length === 0 &&
    filteredQuizzes.length === 0 &&
    filteredChats.length === 0 &&
    filteredResources.length === 0;
  // clamp card floor on mobile so two fit on a 375px viewport
  const effectiveCardSize = isMobile ? Math.min(cardSize, 130) : cardSize;
  const coverHeight = Math.round(effectiveCardSize * 0.6);

  // skeleton count from the per-folder localStorage snapshot; no cache falls back to a row
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const skeletonCount = useMemo(() => {
    const cached = currentOrgId
      ? getCachedCount(readBookCounts(currentOrgId), currentFolderId)
      : null;
    if (cached !== null && cached > 0) return cached;
    if (viewMode === "list") return 4;
    // grid: estimate one row from the viewport, off-by-one is fine
    const w = typeof window !== "undefined" ? window.innerWidth : 1024;
    return Math.max(3, Math.min(10, Math.floor(w / Math.max(effectiveCardSize, 100))));
  }, [currentOrgId, currentFolderId, viewMode, effectiveCardSize]);

  // list view pins drag to Y (grid stays 2D); always clamp to window edges
  const dndModifiers =
    viewMode === "list"
      ? [restrictToVerticalAxis, restrictToWindowEdges]
      : [restrictToWindowEdges];

  const activeDragFolder = activeId ? folderMap.get(activeId) : null;
  const activeDragBook = activeId ? bookMap.get(activeId) : null;
  const activeDragNote = activeId ? noteMap.get(activeId) : null;
  const activeDragWhiteboard = activeId ? whiteboardMap.get(activeId) : null;
  const activeDragQuiz = activeId ? quizMap.get(activeId) : null;
  const activeDragChat = activeId ? chatMap.get(activeId) : null;
  const activeDragResource = activeId ? resourceMap.get(activeId) : null;
  // keep the source row dimmed until the overlay finishes settling
  const dropAnimation: DropAnimation = {
    duration: 200,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };

  return (
    <div
      onContextMenu={onContextMenu}
      className={activeId ? "library-dnd-active" : undefined}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        modifiers={dndModifiers}
        // Re-measure droppables on every move: the .library-dnd-active
        // class flips content-visibility at drag start, and Always makes
        // dnd-kit pick up the corrected rects rather than the stale
        // intrinsic-size guess measured once at drag start.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {/* Toolbar (breadcrumbs + actions), only inside a subfolder */}
      {folderPath.length > 0 && (
      <div className="mb-4 flex items-center justify-between gap-2">
        {/* each non-current crumb is a drop target for moving items up a level */}
        {folderPath.length > 0 ? (
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
            <BreadcrumbDropTarget
              dropId="breadcrumb:root"
              onClick={() => navigateToFolder(null)}
            >
              {t("library.allBooks.breadcrumbRoot")}
            </BreadcrumbDropTarget>
            {folderPath.map((folder, i) => (
              <span key={folder.id} className="flex items-center gap-1">
                <ChevronRight size={14} className="text-text-muted" />
                {i === folderPath.length - 1 ? (
                  <span className="font-medium text-text-primary">
                    {folder.name}
                  </span>
                ) : (
                  <BreadcrumbDropTarget
                    dropId={`breadcrumb:${folder.id}`}
                    onClick={() => navigateToFolder(folder.id)}
                  >
                    {folder.name}
                  </BreadcrumbDropTarget>
                )}
              </span>
            ))}
          </nav>
        ) : (
          // spacer to keep the right-side actions right-aligned
          <span />
        )}

        <div className="flex shrink-0 items-center gap-2">
          {/* Go to parent */}
          {currentFolderId && (
            <Button
              variant="ghost"
              className="gap-1 px-2 py-1.5 text-xs"
              onClick={handleGoUp}
              title={t("library.allBooks.upTitle", {
                shortcut: formatShortcut({ key: "Backspace", alt: true }),
              })}
            >
              <ArrowUp size={14} />
              <span className="hidden sm:inline">
                {t("library.allBooks.up")}
              </span>
            </Button>
          )}
        </div>
      </div>
      )}

      {/* item-type filter chips: show only one kind of item at a time.
          Folders always render regardless of the active type. */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {ITEM_TYPE_FILTERS.map(({ value, icon: Icon, labelKey, defaultLabel }) => {
          const isActive = typeFilter === value;
          return (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              aria-pressed={isActive}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
                isActive
                  ? "bg-accent/15 text-accent"
                  : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
              )}
            >
              <Icon size={13} />
              {t(labelKey, { defaultValue: defaultLabel })}
            </button>
          );
        })}
      </div>

      {/* ghost rows for in-flight uploads in this folder */}
      <UploadGhostStrip currentFolderId={currentFolderId} />

      {/* Search empty state */}
      {isEmpty && query && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">
            {t("library.allBooks.noSearchResults", { query: searchQuery })}
          </p>
        </div>
      )}

      {/* skeleton tiles while fetchLibrary is in flight */}
      {isEmpty && !query && isLoading && (
        <BookCardSkeleton
          viewMode={viewMode}
          count={skeletonCount}
          cardSize={effectiveCardSize}
        />
      )}

      {/* tag filter hid everything (folder isn't really empty) */}
      {isEmpty && !query && !isLoading && activeTag && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">
            {t("library.allBooks.noTagResults")}
          </p>
        </div>
      )}

      {/* type filter yielded nothing here (folder isn't really empty
          when it holds folders, which stay visible above) */}
      {isEmpty && !query && !isLoading && !activeTag && typeFilter !== "all" && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">
            {t("library.typeFilter.noItems", {
              defaultValue: "No items of this type here.",
            })}
          </p>
        </div>
      )}

      {isEmpty && !query && !isLoading && !activeTag && typeFilter === "all" && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <BookOpen size={48} className="text-text-muted/50" />
          <div>
            <p className="text-lg font-medium text-text-primary">
              {t("library.allBooks.emptyFolder")}
            </p>
            {!currentFolderId && (
              <p className="mt-1 text-sm text-text-muted">
                {t("library.allBooks.emptyRootHint")}
              </p>
            )}
          </div>
          {!currentFolderId && (
            <Button
              variant="secondary"
              onClick={() => navigate("/browse")}
            >
              {t("library.allBooks.browseCatalog")}
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {!isEmpty && (
        <>
          <SortableContext
            items={orderedKeys}
            strategy={viewMode === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
          >
            {viewMode === "list" && (
              <LibraryListView
                folders={orderedFolders}
                books={orderedBooks}
                notes={orderedNotes}
                whiteboards={orderedWhiteboards}
                quizzes={orderedQuizzes}
                chats={orderedChats}
                resources={orderedResources}
                orderedKeys={orderedKeys}
                allFolders={folders}
                allBooks={books}
                allNotes={notes}
                allWhiteboards={whiteboards}
                allQuizzes={quizzes}
                allChats={conversations}
                allResources={resources}
                selectedIds={selectedIds}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                onNavigateFolder={navigateToFolder}
                onRenameFolder={renameFolder}
                onDeleteFolder={handleDeleteFolder}
                onMoveBook={onMoveBook}
                onRemoveBook={onRemoveBook}
                onCreateSubfolder={handleCreateSubfolder}
                cardSize={cardSize}
                columnWidths={listColumnWidths}
                setColumnWidth={setListColumnWidth}
              />
            )}

            {viewMode === "grid" && (
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(min(${effectiveCardSize}px, 100%), 1fr))`,
                }}
              >
                {/* iterate orderedKeys so a reorder that interleaves types shows up */}
                {orderedKeys.map((key) => {
                  const folder = folderMap.get(key);
                  if (folder) {
                    return (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        sortableId={`folder:${folder.id}`}
                        onNavigate={navigateToFolder}
                        onRename={renameFolder}
                        onDelete={handleDeleteFolder}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`folder:${folder.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  const entry = bookMap.get(key);
                  if (entry) {
                    return (
                      <LibraryBookCard
                        key={`${entry.source}-${entry.id}`}
                        entry={entry}
                        sortableId={`book:${entry.id}`}
                        onMove={onMoveBook}
                        onRemove={onRemoveBook}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`book:${entry.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  const note = noteMap.get(key);
                  if (note) {
                    return (
                      <LibraryNoteCard
                        key={`note:${note.id}`}
                        note={note}
                        sortableId={`note:${note.id}`}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`note:${note.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  const whiteboard = whiteboardMap.get(key);
                  if (whiteboard) {
                    return (
                      <LibraryWhiteboardCard
                        key={`whiteboard:${whiteboard.id}`}
                        whiteboard={whiteboard}
                        sortableId={`whiteboard:${whiteboard.id}`}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`whiteboard:${whiteboard.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  const quiz = quizMap.get(key);
                  if (quiz) {
                    return (
                      <LibraryQuizCard
                        key={`quiz:${quiz.id}`}
                        quiz={quiz}
                        sortableId={`quiz:${quiz.id}`}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`quiz:${quiz.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  const chat = chatMap.get(key);
                  if (chat) {
                    return (
                      <LibraryChatCard
                        key={`chat:${chat.id}`}
                        conversation={chat}
                        sortableId={`chat:${chat.id}`}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`chat:${chat.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  const resource = resourceMap.get(key);
                  if (resource) {
                    return (
                      <LibraryResourceCard
                        key={`resource:${resource.id}`}
                        resource={resource}
                        sortableId={`resource:${resource.id}`}
                        coverHeight={coverHeight}
                        selected={selectedIds.has(`resource:${resource.id}`)}
                        selectionActive={selectionActive}
                        onToggleSelect={onToggleSelect}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </SortableContext>

          <DragOverlay dropAnimation={dropAnimation}>
            {activeDragFolder && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div
                    className="flex w-full items-center justify-center"
                    style={{ height: coverHeight }}
                  >
                    <Folder
                      size={Math.round(Math.min(Math.max(coverHeight * 0.35, 24), 48))}
                      className="text-accent/60"
                    />
                  </div>
                  <div className={coverHeight < 100 ? "p-2" : "p-3"}>
                    <h3
                      className={`mb-0.5 truncate font-semibold text-text-primary ${coverHeight < 100 ? "text-xs" : "text-sm"}`}
                    >
                      {activeDragFolder.name}
                    </h3>
                    <p
                      className={`truncate text-text-muted ${coverHeight < 100 ? "text-2xs" : "text-xs"}`}
                    >
                      {t("library.allBooks.folderLabel")}
                    </p>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragBook && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {activeDragBook.source === "catalog"
                        ? activeDragBook.catalog_book.title
                        : activeDragBook.book.title}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragNote && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <FileText size={16} className="shrink-0 text-accent-blue/70" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {noteDisplayTitle(activeDragNote, t)}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragWhiteboard && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <Shapes size={16} className="shrink-0 text-success/80" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {whiteboardDisplayTitle(activeDragWhiteboard, t)}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragQuiz && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <ListChecks size={16} className="shrink-0 text-warning/80" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {activeDragQuiz.title.trim() ||
                        t("library.allBooks.untitledQuiz")}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragChat && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <MessageSquare size={16} className="shrink-0 text-accent-blue/80" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {conversationDisplayTitle(activeDragChat, t)}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragResource && (
              <div style={{ width: effectiveCardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <Globe size={16} className="shrink-0 text-accent-blue/80" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {activeDragResource.title ||
                        displayHost(activeDragResource.url)}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
          </DragOverlay>
        </>
      )}
      </DndContext>

      {/* Create folder modal */}
      <CreateFolderModal
        open={createFolderOpen}
        onClose={() => setCreateFolderOpen(false)}
        onCreate={handleConfirmCreateFolder}
        parentFolderName={
          folderPath.length > 0
            ? folderPath[folderPath.length - 1].name
            : null
        }
      />

      {/* Confirm delete dialog */}
      <ConfirmModal
        open={!!confirmDelete}
        title={t("library.allBooks.deleteFolder.title")}
        body={t("library.allBooks.deleteFolder.body")}
        confirmLabel={t("library.allBooks.deleteFolder.action")}
        danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteFolder}
      />
    </div>
  );
}

/**
 * One row per in-flight upload in the current folder. Successful jobs
 * auto-dismiss 1.5s after landing (the real book card has rendered by then);
 * errored ones stay until dismissed or retried.
 */
function UploadGhostStrip({
  currentFolderId,
}: {
  currentFolderId: string | null;
}) {
  const uploads = useUploadStore((s) => s.uploads);
  const dismissUpload = useUploadStore((s) => s.dismissUpload);
  const retryUpload = useUploadStore((s) => s.retryUpload);
  const cancelUpload = useUploadStore((s) => s.cancelUpload);

  const visible = useMemo(() => {
    const out: UploadJob[] = [];
    for (const job of uploads.values()) {
      if ((job.folderId ?? null) === currentFolderId) out.push(job);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [uploads, currentFolderId]);

  // auto-dismiss successful jobs after a short delay; per-id timers avoid double-scheduling
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const job of visible) {
      if (job.status === "success") {
        timers.push(setTimeout(() => dismissUpload(job.id), 1500));
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [visible, dismissUpload]);

  if (visible.length === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {visible.map((job) => (
        <UploadGhostRow
          key={job.id}
          job={job}
          onDismiss={() => dismissUpload(job.id)}
          onRetry={() => retryUpload(job.id)}
          onCancel={() => cancelUpload(job.id)}
        />
      ))}
    </div>
  );
}

function UploadGhostRow({
  job,
  onDismiss,
  onRetry,
  onCancel,
}: {
  job: UploadJob;
  onDismiss: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isError = job.status === "error";
  const isSuccess = job.status === "success";
  const isUploading = job.status === "uploading";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-glass-bg/40 px-3 py-2 transition-colors",
        isError
          ? "border-danger/30"
          : isSuccess
            ? "border-success/30"
            : "border-glass-border",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          isError
            ? "bg-danger/15 text-danger"
            : isSuccess
              ? "bg-success/15 text-success"
              : "bg-accent/15 text-accent",
        )}
      >
        {isError ? (
          <AlertTriangle size={14} />
        ) : isSuccess ? (
          <Check size={14} />
        ) : (
          <FileText size={14} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{job.fileName}</p>
        {/* Progress bar (uploading) / status text (success/error). */}
        {job.status === "uploading" ? (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-glass-bg">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        ) : isError ? (
          <p className="truncate text-2xs text-danger">
            {job.error ?? t("library.upload.failed")}
          </p>
        ) : (
          <p className="text-2xs text-success">
            {t("library.upload.success")}
          </p>
        )}
      </div>
      {/* cancel an in-flight upload; aborts the transfer and drops the row */}
      {isUploading && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title={t("library.upload.cancel")}
          aria-label={t("library.upload.cancel")}
        >
          <X size={14} />
        </button>
      )}
      {isError && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title={t("library.upload.retry")}
          aria-label={t("library.upload.retry")}
        >
          <RotateCw size={14} />
        </button>
      )}
      {(isError || isSuccess) && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** A breadcrumb nav button that's also a drop target; dropping here moves the item to that level. */
function BreadcrumbDropTarget({
  dropId,
  onClick,
  children,
}: {
  dropId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 cursor-pointer transition-colors",
        isOver
          ? "bg-accent/20 text-accent ring-1 ring-accent/60"
          : "text-text-muted hover:text-text-primary hover:bg-glass-hover",
      )}
    >
      {children}
    </button>
  );
}
