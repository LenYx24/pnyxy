import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
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
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import {
  computeDropIntent,
  noShiftStrategy,
  DropIntentProvider,
  type DropIntent,
} from "./drag-intent";
import {
  restrictToVerticalAxis,
  restrictToWindowEdges,
} from "@/lib/dnd-modifiers";
import {
  ChevronRight,
  ArrowUp,
  BookOpen,
  FileText,
  Shapes,
  ListChecks,
  MessageSquare,
  Globe,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { Button, ConfirmModal } from "@/components/ui";
import { chipActiveClass, chipClass } from "@/components/ui/classes";
import { cn } from "@/lib/cn";
import { useFeatures } from "@/lib/use-features";
import type { FeatureKey } from "@/lib/features";
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
import { useTagStore } from "@/stores/tag-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useIsMobile } from "@/hooks/use-media-query";
import { formatShortcut } from "@/lib/keyboard-shortcuts";
import { UploadGhostStrip } from "./UploadGhosts";
import { CourseAvailableStrip } from "./CourseAvailableStrip";
import { BreadcrumbDropTarget, ParentDropZone } from "./DropTargets";
import { LibraryPathEditor } from "./LibraryPathEditor";
import { FolderCard } from "./FolderCard";
import { LibraryBookCard } from "./LibraryBookCard";
import { LibraryNoteCard } from "./LibraryNoteCard";
import { LibraryWhiteboardCard } from "./LibraryWhiteboardCard";
import { LibraryQuizCard } from "./LibraryQuizCard";
import { LibraryChatCard } from "./LibraryChatCard";
import { LibraryResourceCard } from "./LibraryResourceCard";
import { LibraryListView } from "./LibraryListView";
import { DragGhost } from "./DragGhost";
import { LibraryOrgCrumb } from "./LibraryOrgCrumb";
import { CreateFolderModal } from "./modals/CreateFolderModal";
import { BookCardSkeleton } from "./BookCardSkeleton";
import { readBookCounts, getCachedCount } from "./bookCountCache";
import { useOrgStore } from "@/stores/org-store";
import { applySort } from "./useLibraryPrefs";
import type { ViewMode, LibraryTypeFilter } from "./useLibraryPrefs";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { BookStatusTag } from "@/types/database";
import type { Folder as FolderType } from "@/types/database";

/** Which kind of library item to show. "all" shows everything.
 *  Folders are navigation and stay visible regardless of the pick.
 *  Lives in useLibraryPrefs so the pick persists (book-first default). */
type ItemTypeFilter = LibraryTypeFilter;

const ITEM_TYPE_FILTERS: {
  value: ItemTypeFilter;
  icon: LucideIcon;
  labelKey: string;
  defaultLabel: string;
  feature?: FeatureKey;
}[] = [
  {
    value: "all",
    icon: LayoutGrid,
    labelKey: "library.typeFilter.all",
    defaultLabel: "All",
  },
  {
    value: "books",
    icon: BookOpen,
    labelKey: "library.typeFilter.books",
    defaultLabel: "Books",
  },
  {
    value: "notes",
    icon: FileText,
    labelKey: "library.typeFilter.notes",
    defaultLabel: "Notes",
    feature: "notes",
  },
  {
    value: "whiteboards",
    icon: Shapes,
    labelKey: "library.typeFilter.whiteboards",
    defaultLabel: "Whiteboards",
    feature: "whiteboard",
  },
  {
    value: "quizzes",
    icon: ListChecks,
    labelKey: "library.typeFilter.quizzes",
    defaultLabel: "Quizzes",
    feature: "quizzes",
  },
  {
    value: "chats",
    icon: MessageSquare,
    labelKey: "library.typeFilter.chats",
    defaultLabel: "Chats",
  },
  {
    value: "resources",
    icon: Globe,
    labelKey: "library.typeFilter.resources",
    defaultLabel: "Resources",
  },
];

interface AllBooksTabProps {
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  viewMode: ViewMode;
  cardSize: number;
  searchQuery: string;
  selectedIds: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  /** Reports the current on-screen item order (filtered + sorted) so
   *  the parent's shift-range selection spans exactly what's visible. */
  onOrderedKeysChange?: (keys: string[]) => void;
  activeTag?: BookStatusTag | null;
  sortOrders: Record<string, string[]>;
  setSortOrder: (contextId: string, orderedKeys: string[]) => void;
  isLoading?: boolean;
  /** Wraps the breadcrumb with the page toolbar. The breadcrumb has to
   *  render inside this tab's DndContext (its crumbs are drop targets),
   *  so the parent hands over the chrome and gets the crumbs back. */
  renderHeader?: (breadcrumb: ReactNode) => ReactNode;
  /** Extra filter chrome (the tag filter) shown in the filters row. */
  filtersExtra?: ReactNode;
  /** Right-click handler for the library area (new folder / upload). */
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Persisted item-type filter (book-first by default). */
  typeFilter: ItemTypeFilter;
  setTypeFilter: (type: ItemTypeFilter) => void;
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
  isLoading = false,
  renderHeader,
  filtersExtra,
  onContextMenu,
  typeFilter,
  setTypeFilter,
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
    // the URL->store effect gets to consume it, let it drive instead.
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
  }, [
    loadNotes,
    loadWhiteboards,
    fetchMyQuizzes,
    fetchConversations,
    fetchResources,
  ]);

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
    () =>
      conversations.filter((c) => (c.folder_id ?? null) === currentFolderId),
    [conversations, currentFolderId],
  );
  const resourcesInFolder = useMemo(
    () => resources.filter((r) => (r.folder_id ?? null) === currentFolderId),
    [resources, currentFolderId],
  );

  // Item-type filter (Books / Notes / … / All), persisted in prefs,
  // book-first by default. When not "all", only that type's items render;
  // folders always stay visible (they're navigation).
  const features = useFeatures();
  const typeEnabled = useCallback(
    (type: ItemTypeFilter) => {
      const def = ITEM_TYPE_FILTERS.find((f) => f.value === type);
      return !def?.feature || features[def.feature];
    },
    [features],
  );
  const showType = useCallback(
    (type: Exclude<ItemTypeFilter, "all">) =>
      typeEnabled(type) && (typeFilter === "all" || typeFilter === type),
    [typeFilter, typeEnabled],
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

  // The target under the cursor wins (rows, cards, crumbs, the "up one
  // level" placeholder); in the gaps between cards, or with the keyboard
  // sensor (no pointer), fall back to the nearest center. Whether a hit
  // means reorder or nest is decided afterwards from the pointer position
  // (see computeDropIntent), not by overlapping droppables.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerHits = pointerWithin(args);
    if (pointerHits.length > 0) return pointerHits;
    return closestCenter(args);
  }, []);

  // Explicit drop intent: what would happen if the item were released
  // now. State drives the indicator (insertion line / folder highlight /
  // crumb chip), the ref is what handleDragEnd acts on.
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const dropIntentRef = useRef<DropIntent | null>(null);
  const updateIntent = useCallback((next: DropIntent | null) => {
    const prev = dropIntentRef.current;
    if (prev?.overId === next?.overId && prev?.position === next?.position)
      return;
    dropIntentRef.current = next;
    setDropIntent(next);
  }, []);

  // Live pointer position (mouse + touch) while a drag is in flight.
  // dnd-kit's move event only carries the translate delta, and the
  // vertical-axis modifier strips x, so track the raw pointer ourselves.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!activeId) return;
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [activeId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    const coords = event.activatorEvent
      ? getEventCoordinates(event.activatorEvent)
      : null;
    pointerRef.current = coords ? { x: coords.x, y: coords.y } : null;
    dropIntentRef.current = null;
    setDropIntent(null);
  }, []);

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { active, over } = event;
      if (!over) {
        updateIntent(null);
        return;
      }
      const activeKey = active.id as string;
      const overKey = over.id as string;
      // keyboard sensor: no pointer, decide from sibling indices
      const isKeyboard =
        !!event.activatorEvent && event.activatorEvent.type === "keydown";
      updateIntent(
        computeDropIntent({
          activeId: activeKey,
          overId: overKey,
          rect: over.rect,
          pointer: isKeyboard ? null : pointerRef.current,
          axis: viewMode === "list" ? "y" : "x",
          activeIndex: orderedKeys.indexOf(activeKey),
          overIndex: orderedKeys.indexOf(overKey),
        }),
      );
    },
    [orderedKeys, updateIntent, viewMode],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const intent = dropIntentRef.current;
      dropIntentRef.current = null;
      setDropIntent(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = active.id as string;
      // The intent computed on the last move is authoritative; fall back
      // to dnd-kit's own `over` only if no move ever fired.
      const overId = intent?.overId ?? (over.id as string);
      const position = intent?.position ?? "after";

      // nest into a folder row / card (middle zone)
      if (position === "inside" && overId.startsWith("folder:")) {
        const targetFolderId = overId.slice("folder:".length);
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

      // drop onto a crumb (incl. root) or the "up one level" placeholder
      // to move the item to that level.
      if (overId.startsWith("breadcrumb:") || overId.startsWith("parent:")) {
        const tail = overId.slice(overId.indexOf(":") + 1);
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

      // sortable target: insert before / after it in the sibling list
      const oldIndex = orderedKeys.indexOf(activeId);
      const targetIndex = orderedKeys.indexOf(overId);
      if (oldIndex === -1 || targetIndex === -1) return;

      const without = orderedKeys.filter((k) => k !== activeId);
      let insertAt = without.indexOf(overId);
      if (position === "after") insertAt += 1;
      const newOrder = [
        ...without.slice(0, insertAt),
        activeId,
        ...without.slice(insertAt),
      ];
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
    dropIntentRef.current = null;
    setDropIntent(null);
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

  // File-manager style path box: Ctrl+Shift+L (Ctrl+L is the browser's
  // address bar) or clicking the trail swaps the breadcrumb for an
  // editable, autocompleting path input.
  const [pathEditing, setPathEditing] = useState(false);
  const openPathEditor = useCallback(() => setPathEditing(true), []);
  const closePathEditor = useCallback(() => setPathEditing(false), []);
  useKeyboardShortcut({
    id: "library:edit-path",
    key: "l",
    ctrl: true,
    shift: true,
    description: "Edit the folder path",
    handler: openPathEditor,
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
    return Math.max(
      3,
      Math.min(10, Math.floor(w / Math.max(effectiveCardSize, 100))),
    );
  }, [currentOrgId, currentFolderId, viewMode, effectiveCardSize]);

  // list view pins drag to Y (grid stays 2D); always clamp to window edges
  const dndModifiers =
    viewMode === "list"
      ? [restrictToVerticalAxis, restrictToWindowEdges]
      : [restrictToWindowEdges];

  // keep the source row dimmed until the overlay finishes settling
  const dropAnimation: DropAnimation = {
    duration: 200,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };

  // "<Org> > All files" at the root, "<Org> > All files > A > B" inside a
  // folder; the org crumb opens the workspace switcher.
  // The h2 carries the page name for assistive tech (and the e2e header
  // check) while the visible text is the crumb trail.
  const breadcrumb = pathEditing ? (
    <LibraryPathEditor
      folders={folders}
      folderPath={folderPath}
      onNavigate={navigateToFolder}
      onClose={closePathEditor}
    />
  ) : (
    <h2
      aria-label={t("library.yourLibrary")}
      title={t("library.pathEditor.hint", {
        shortcut: formatShortcut({ key: "L", ctrl: true, shift: true }),
      })}
      // a click on the trail itself (not on a crumb button) opens the
      // path box, like clicking the address bar in a file manager
      onClick={(e) => {
        if (e.target === e.currentTarget) openPathEditor();
      }}
      className="flex min-w-0 flex-1 cursor-text items-center gap-1 overflow-x-auto rounded-control py-0.5 font-display text-sm font-normal transition-colors hover:bg-surface-3/40"
    >
      {/* root crumb: the active workspace, opens the org switcher */}
      <LibraryOrgCrumb />
      <ChevronRight
        size={14}
        strokeWidth={1.5}
        className="shrink-0 text-text-muted-2"
      />
      {folderPath.length === 0 ? (
        <span className="truncate px-1 font-medium text-text-primary">
          {t("library.list.breadcrumb.allFiles")}
        </span>
      ) : (
        <BreadcrumbDropTarget
          dropId="breadcrumb:root"
          dragging={activeId != null}
          onClick={() => navigateToFolder(null)}
        >
          {t("library.list.breadcrumb.allFiles")}
        </BreadcrumbDropTarget>
      )}
      {folderPath.map((folder, i) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-1">
          {/* every folder crumb, the first included, is preceded by a chevron */}
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-text-muted-2"
          />
          {i === folderPath.length - 1 ? (
            <button
              type="button"
              onClick={openPathEditor}
              title={t("library.pathEditor.hint", {
                shortcut: formatShortcut({ key: "L", ctrl: true, shift: true }),
              })}
              className="truncate rounded-chip px-1 font-medium text-text-primary cursor-text hover:bg-surface-3"
            >
              {folder.name}
            </button>
          ) : (
            <BreadcrumbDropTarget
              dropId={`breadcrumb:${folder.id}`}
              dragging={activeId != null}
              onClick={() => navigateToFolder(folder.id)}
            >
              {folder.name}
            </BreadcrumbDropTarget>
          )}
        </span>
      ))}
    </h2>
  );

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
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <DropIntentProvider value={dropIntent}>
          {/* Header: breadcrumb (each non-current crumb is a drop target for
          moving items up a level) wrapped in the parent's toolbar. */}
          {renderHeader ? renderHeader(breadcrumb) : breadcrumb}

          {/* item-type filter chips: show only one kind of item at a time.
          Folders always render regardless of the active type. */}
          {/* One always-visible filter row: type chips, a hairline divider,
          then the tag chips (filtersExtra). Same chip class / height on
          both sides; wraps on narrow desktop widths and scrolls
          horizontally on mobile. */}
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {/* Parent-folder button leads the row (left), before the type
            chips, so "back up" sits where users look for navigation. */}
            {currentFolderId && (
              <Button
                variant="ghost"
                className="shrink-0 gap-1 px-2 py-1 text-xs"
                onClick={handleGoUp}
                title={t("library.allBooks.upTitle", {
                  shortcut: formatShortcut({ key: "Backspace", alt: true }),
                })}
              >
                <ArrowUp size={16} strokeWidth={1.5} />
                <span className="hidden sm:inline">
                  {t("library.allBooks.up")}
                </span>
              </Button>
            )}
            {ITEM_TYPE_FILTERS.filter((f) => typeEnabled(f.value)).map(
              ({ value, icon: Icon, labelKey, defaultLabel }) => {
                const isActive = typeFilter === value;
                return (
                  <button
                    key={value}
                    onClick={() => setTypeFilter(value)}
                    data-filter="type"
                    aria-pressed={isActive}
                    className={cn(
                      "font-medium transition-colors cursor-pointer hover:text-text-primary",
                      isActive ? chipActiveClass : chipClass,
                    )}
                  >
                    <Icon size={14} strokeWidth={1.5} />
                    {t(labelKey, { defaultValue: defaultLabel })}
                  </button>
                );
              },
            )}
            {filtersExtra && (
              <>
                <div
                  aria-hidden
                  className="mx-1 h-4 w-px shrink-0 bg-surface-3"
                />
                {filtersExtra}
              </>
            )}
          </div>

          {/* not-yet-copied course files, when this folder mirrors a course */}
          <CourseAvailableStrip currentFolderId={currentFolderId} />

          {/* ghost rows for in-flight uploads in this folder */}
          <UploadGhostStrip currentFolderId={currentFolderId} />

          {/* "Up to: <parent>" drop placeholder: only inside a folder, only
          while dragging; lets an item leave the folder without aiming
          at the breadcrumb. */}
          {currentFolderId && (
            <ParentDropZone
              parentFolderId={parentFolderId}
              parentName={
                parentFolderId
                  ? (folderPath[folderPath.length - 2]?.name ?? "")
                  : t("library.list.breadcrumb.allFiles")
              }
              visible={activeId != null}
            />
          )}

          {/* Search empty state */}
          {isEmpty && query && (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="font-display text-base font-medium text-text-primary">
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
              <p className="font-display text-base font-medium text-text-primary">
                {t("library.allBooks.noTagResults")}
              </p>
            </div>
          )}

          {/* type filter yielded nothing here (folder isn't really empty
          when it holds folders, which stay visible above) */}
          {isEmpty &&
            !query &&
            !isLoading &&
            !activeTag &&
            typeFilter !== "all" &&
            typeFilter !== "books" && (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <p className="font-display text-base font-medium text-text-primary">
                  {t("library.typeFilter.noItems")}
                </p>
              </div>
            )}

          {isEmpty &&
            !query &&
            !isLoading &&
            !activeTag &&
            (typeFilter === "all" || typeFilter === "books") && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <div>
                  <p className="font-display text-lg font-medium text-text-primary">
                    {t("library.allBooks.emptyFolder")}
                  </p>
                  {!currentFolderId && (
                    <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
                      {t("library.allBooks.emptyDragHint")}
                    </p>
                  )}
                </div>
                {!currentFolderId && features.catalog && (
                  <Button variant="ghost" onClick={() => navigate("/browse")}>
                    {t("library.allBooks.browseCatalog")}
                  </Button>
                )}
              </div>
            )}

          {/* Content */}
          {!isEmpty && (
            <>
              <SortableContext items={orderedKeys} strategy={noShiftStrategy}>
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
                            selected={selectedIds.has(
                              `whiteboard:${whiteboard.id}`,
                            )}
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
                            selected={selectedIds.has(
                              `resource:${resource.id}`,
                            )}
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
                <DragGhost viewMode={viewMode} />
              </DragOverlay>
            </>
          )}
        </DropIntentProvider>
      </DndContext>

      {/* Create folder modal */}
      <CreateFolderModal
        open={createFolderOpen}
        onClose={() => setCreateFolderOpen(false)}
        onCreate={handleConfirmCreateFolder}
        parentFolderName={
          folderPath.length > 0 ? folderPath[folderPath.length - 1].name : null
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
