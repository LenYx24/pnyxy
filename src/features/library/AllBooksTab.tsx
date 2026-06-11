import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  defaultDropAnimationSideEffects,
  DragOverlay,
  KeyboardSensor,
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
  ChevronRight,
  FolderPlus,
  ArrowUp,
  BookOpen,
  Folder,
  FileText,
  Shapes,
  ListChecks,
  MessageSquare,
  RotateCw,
  X,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore, type Note } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { WhiteboardData } from "@/types/whiteboard";
import { useQuizStore } from "@/stores/quiz-store";
import type { Quiz } from "@/types/quiz";
import { useChatStore } from "@/stores/chat-store";
import type { ChatConversation } from "@/types/chat";
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
import { NewItemMenu } from "./NewItemMenu";
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

interface AllBooksTabProps {
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  viewMode: ViewMode;
  cardSize: number;
  searchQuery: string;
  selectedIds: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  activeTag?: BookStatusTag | null;
  sortOrders: Record<string, string[]>;
  setSortOrder: (contextId: string, orderedKeys: string[]) => void;
  listColumnWidths: ListColumnWidths;
  setListColumnWidth: (key: keyof ListColumnWidths, width: number) => void;
  isLoading?: boolean;
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
  activeTag = null,
  sortOrders,
  setSortOrder,
  listColumnWidths,
  setListColumnWidth,
  isLoading = false,
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

  // Notes live in the local-first note-store (IndexedDB), not the
  // Supabase-backed library store — so the tree aggregates them in
  // directly. loadNotes hydrates from IDB on mount (idempotent / cheap;
  // the editor pages call it too).
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
  useEffect(() => {
    void loadNotes();
    void loadWhiteboards();
    void fetchMyQuizzes();
    void fetchConversations();
  }, [loadNotes, loadWhiteboards, fetchMyQuizzes, fetchConversations]);

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
  }, [booksInFolder, query, activeTag, getTagsForBook]);

  // Notes are searchable by title. The book status-tag filter doesn't
  // apply to notes (they carry no reading-status tags), so an active
  // tag hides them entirely — matching the "show only tagged books"
  // intent of that filter.
  const filteredNotes = useMemo(() => {
    if (activeTag) return [] as Note[];
    if (!query) return notesInFolder;
    return notesInFolder.filter((n) =>
      (n.title || "").toLowerCase().includes(query),
    );
  }, [notesInFolder, query, activeTag]);

  // Same treatment as notes: searchable by title, hidden when a book
  // status-tag filter is active (whiteboards carry no such tags).
  const filteredWhiteboards = useMemo(() => {
    if (activeTag) return [] as WhiteboardData[];
    if (!query) return whiteboardsInFolder;
    return whiteboardsInFolder.filter((w) =>
      (w.title || "").toLowerCase().includes(query),
    );
  }, [whiteboardsInFolder, query, activeTag]);

  const filteredQuizzes = useMemo(() => {
    if (activeTag) return [] as Quiz[];
    if (!query) return quizzesInFolder;
    return quizzesInFolder.filter((q) =>
      (q.title || "").toLowerCase().includes(query),
    );
  }, [quizzesInFolder, query, activeTag]);

  const filteredChats = useMemo(() => {
    if (activeTag) return [] as ChatConversation[];
    if (!query) return chatsInFolder;
    return chatsInFolder.filter((c) =>
      (c.title || "").toLowerCase().includes(query),
    );
  }, [chatsInFolder, query, activeTag]);

  // ─── Sort order ───────────────────────────────────────────
  const contextId = currentFolderId ?? "root";
  const savedOrder = sortOrders[contextId];

  // Build combined sortable items (folders, then books, notes, whiteboards)
  const allItemKeys = useMemo(() => {
    const folderKeys = filteredFolders.map((f) => `folder:${f.id}`);
    const bookKeys = filteredBooks.map((b) => `book:${b.id}`);
    const noteKeys = filteredNotes.map((n) => `note:${n.id}`);
    const whiteboardKeys = filteredWhiteboards.map((w) => `whiteboard:${w.id}`);
    const quizKeys = filteredQuizzes.map((q) => `quiz:${q.id}`);
    const chatKeys = filteredChats.map((c) => `chat:${c.id}`);
    return [
      ...folderKeys,
      ...bookKeys,
      ...noteKeys,
      ...whiteboardKeys,
      ...quizKeys,
      ...chatKeys,
    ];
  }, [
    filteredFolders,
    filteredBooks,
    filteredNotes,
    filteredWhiteboards,
    filteredQuizzes,
    filteredChats,
  ]);

  const orderedKeys = useMemo(
    () => applySort(savedOrder, allItemKeys),
    [savedOrder, allItemKeys],
  );

  // Build lookup maps
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

  // Ordered arrays for rendering. orderedKeys is derived from the
  // same filtered folders/books that populate the maps, so every
  // key resolves — no `filter(Boolean)` safety net needed.
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

  // ─── DnD ─────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    // Desktop only — MouseSensor (not PointerSensor) so touch events
    // are handled exclusively by TouchSensor below. PointerSensor's
    // unified pointer-events listener was catching touch too, and
    // its `distance: 8` constraint beat the TouchSensor's 200ms
    // delay → on mobile, a regular scroll-swipe would start a drag
    // as soon as the finger moved 8px. MouseSensor scopes the
    // distance-based activation to mouse input where it belongs.
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Mobile: long-press kicks off the drag so a regular tap on a
    // row still navigates / opens the context menu and a scroll-
    // swipe still scrolls.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    // Keyboard a11y: Tab to a row, Space to pick up, arrows to
    // move, Space to drop. `sortableKeyboardCoordinates` from
    // @dnd-kit/sortable hooks the arrow-key navigation into the
    // sortable strategy so the moves are valid drop targets.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Custom collision detector: explicit action targets (nest, breadcrumb)
  // win whenever the cursor is actually inside them, even when the
  // outer sortable shares the same center point — which is exactly
  // the case for the list-view nest droppable (inset 6px symmetrically
  // inside the row, so closestCenter alone tied with the sortable
  // wrapper and "drop into folder" silently fell back to sibling
  // reorder). Sibling reorder still uses closestCenter for everything
  // that isn't an explicit action target.
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

      // "Nest into" — the inner droppable that covers the middle of a
      // folder row. Drops here move the dragged item into the folder.
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
        } else if (activeId.startsWith("folder:")) {
          const draggedFolderId = activeId.slice("folder:".length);
          if (draggedFolderId !== targetFolderId) {
            void moveFolderToFolder(draggedFolderId, targetFolderId);
          }
        }
        return;
      }

      // Breadcrumb drop — drop a row onto any crumb in the path
      // (including "Library" root) to move it to that level. This is
      // the file-manager pattern (Finder, Explorer, Drive) and is the
      // only way to get a nested folder back out to the top level.
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
        } else if (activeId.startsWith("folder:")) {
          const draggedFolderId = activeId.slice("folder:".length);
          if (draggedFolderId !== targetFolderId) {
            void moveFolderToFolder(draggedFolderId, targetFolderId);
          }
        }
        return;
      }

      // Sortable target. Top-level folder/book rows are part of the
      // SortableContext — dropping near their top/bottom edge reorders
      // the sibling list. (The middle of folder rows is handled by the
      // nest droppable above, so we don't need to special-case it here.)
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
    ],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  // ─── Other handlers ───────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  // When set, the create-folder modal targets this folder as parent
  // instead of `currentFolderId` — used by the "New subfolder" entry
  // in a folder row's context menu so the new folder lands inside the
  // right-clicked folder, not the visible folder.
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
    // Name may be a slash-separated path like "p1/p2/p3"; createFolderPath
    // walks each segment, reusing existing siblings and creating missing
    // parents. A bare name (no "/") behaves exactly as before.
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
    filteredChats.length === 0;
  // On mobile the desktop cardSize default (200px) means a single
  // column and a giant 300px-tall cover per row. Clamp the grid's
  // floor to ~130px so two cards fit on a 375px viewport — matches
  // how Apple Books / Readwise lay out on phones.
  const effectiveCardSize = isMobile ? Math.min(cardSize, 130) : cardSize;
  const coverHeight = Math.round(effectiveCardSize * 0.6);

  // Skeleton count for the loading state. Reads the per-folder count
  // snapshot written by the last successful fetchLibrary — synchronous
  // localStorage read, so the placeholders are in the very first paint
  // and books don't pop in from a blank container on revisit. No
  // cached count (first-ever visit, or a folder we've never opened
  // while populated) falls back to ~one row's worth.
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  const skeletonCount = useMemo(() => {
    const cached = currentOrgId
      ? getCachedCount(readBookCounts(currentOrgId), currentFolderId)
      : null;
    if (cached !== null && cached > 0) return cached;
    if (viewMode === "list") return 4;
    // Grid: estimate one row from the viewport. Off-by-one is fine
    // here — the goal is "something to look at" until the real count
    // gets cached after this fetch resolves.
    const w = typeof window !== "undefined" ? window.innerWidth : 1024;
    return Math.max(3, Math.min(10, Math.floor(w / Math.max(effectiveCardSize, 100))));
  }, [currentOrgId, currentFolderId, viewMode, effectiveCardSize]);

  // List view is a strict vertical stack, so pin the drag transform
  // to the Y axis — eliminates horizontal drift that the user almost
  // never intends. Grid view stays 2D since rows wrap. Always clamp
  // to window edges so a fast finger flick can't carry the overlay
  // off-screen on mobile.
  const dndModifiers =
    viewMode === "list"
      ? [restrictToVerticalAxis, restrictToWindowEdges]
      : [restrictToWindowEdges];

  // ─── Drag overlay content ────────────────────────────────
  const activeDragFolder = activeId ? folderMap.get(activeId) : null;
  const activeDragBook = activeId ? bookMap.get(activeId) : null;
  const activeDragNote = activeId ? noteMap.get(activeId) : null;
  const activeDragWhiteboard = activeId ? whiteboardMap.get(activeId) : null;
  const activeDragQuiz = activeId ? quizMap.get(activeId) : null;
  const activeDragChat = activeId ? chatMap.get(activeId) : null;
  // Smooth "settle into place" on drop instead of the default snap.
  // Same easing dnd-kit ships in `defaultDropAnimation`, but with the
  // sideEffects helper so the dragged source row keeps its dimming
  // briefly while the overlay finishes animating.
  const dropAnimation: DropAnimation = {
    duration: 200,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        modifiers={dndModifiers}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      {/* Toolbar: Breadcrumbs + Actions */}
      <div className="mb-4 flex items-center justify-between gap-2">
        {/* Breadcrumbs — only rendered when the user has navigated
            into a subfolder. At the library root the page title
            already says "Library", so a single redundant crumb just
            adds noise. Once inside a folder, the leading "Library"
            crumb is useful again for jumping back to root. Each
            non-current crumb is a drop target, so the user can drag
            a folder/book onto any ancestor level to move it there. */}
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
          // Empty spacer so the right-side actions stay right-aligned
          // by `flex justify-between` on the parent.
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

          {/* "New ▸" — create a note / whiteboard / quiz / chat (or
              folder) directly into the folder being viewed, then open
              its editor. Items are born where they live instead of
              created elsewhere and dragged in. Folder creation also
              still has its inline tile/row + Ctrl+Shift+F shortcut. */}
          <NewItemMenu
            currentFolderId={currentFolderId}
            onNewFolder={handleCreateFolder}
          />
        </div>
      </div>

      {/* In-flight upload strip — shows ghost rows for files the
          user just dropped/picked, so they can leave the modal /
          drag-drop the next batch without watching a blocking
          progress bar. Filtered to the current folder context. */}
      <UploadGhostStrip currentFolderId={currentFolderId} />

      {/* Search empty state */}
      {isEmpty && query && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">
            {t("library.allBooks.noSearchResults", { query: searchQuery })}
          </p>
        </div>
      )}

      {/* Loading state — skeleton tiles in place of a spinner so the
          grid/list looks populated while fetchLibrary is in flight.
          Count comes from the per-folder localStorage cache written
          on the last successful fetch; first-ever visit (no cache)
          falls back to a single row so the user still sees activity
          without committing to a fake count. */}
      {isEmpty && !query && isLoading && (
        <BookCardSkeleton
          viewMode={viewMode}
          count={skeletonCount}
          cardSize={effectiveCardSize}
        />
      )}

      {isEmpty && !query && !isLoading && (
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
                orderedKeys={orderedKeys}
                allFolders={folders}
                allBooks={books}
                allNotes={notes}
                allWhiteboards={whiteboards}
                allQuizzes={quizzes}
                allChats={conversations}
                selectedIds={selectedIds}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                onNavigateFolder={navigateToFolder}
                onRenameFolder={renameFolder}
                onDeleteFolder={handleDeleteFolder}
                onMoveBook={onMoveBook}
                onRemoveBook={onRemoveBook}
                onCreateSubfolder={handleCreateSubfolder}
                onCreateRootFolder={handleCreateFolder}
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
                {/* Persistent "create folder" affordance — sits at
                    the head of the grid as a dashed-border tile,
                    same dimensions as the surrounding cards. Not
                    part of the SortableContext: it's a stable
                    action, not a draggable item. */}
                <CreateFolderTile onClick={handleCreateFolder} />

                {/* Render in orderedKeys order so a DnD reorder (which may
                    interleave folders and books) is reflected visually. */}
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
                  return null;
                })}
              </div>
            )}
          </SortableContext>

          <DragOverlay dropAnimation={dropAnimation}>
            {activeDragFolder && (
              <div style={{ width: cardSize }} className="pointer-events-none">
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
              <div style={{ width: cardSize }} className="pointer-events-none">
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
              <div style={{ width: cardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <FileText size={16} className="shrink-0 text-accent-blue/70" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {activeDragNote.title.trim() ||
                        t("library.allBooks.untitledNote")}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragWhiteboard && (
              <div style={{ width: cardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <Shapes size={16} className="shrink-0 text-success/80" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {activeDragWhiteboard.title.trim() ||
                        t("library.allBooks.untitledWhiteboard")}
                    </span>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragQuiz && (
              <div style={{ width: cardSize }} className="pointer-events-none">
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
              <div style={{ width: cardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent">
                  <div className="flex items-center gap-3 p-3">
                    <MessageSquare size={16} className="shrink-0 text-sky-400/80" />
                    <span className="text-sm font-medium text-text-primary truncate">
                      {activeDragChat.title.trim() ||
                        t("library.allBooks.untitledChat")}
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
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              {t("library.allBooks.deleteFolder.title")}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {t("library.allBooks.deleteFolder.body")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(null)}
              >
                {t("common.cancel")}
              </Button>
              <button
                onClick={confirmDeleteFolder}
                className="cursor-pointer rounded-lg bg-danger/20 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/30"
              >
                {t("library.allBooks.deleteFolder.action")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Grid-view "create folder" tile. Replaces the header button — the
 * action lives where the user is already looking. Same 2:3 aspect
 * + label block as the book/folder cards so it lays out cleanly in
 * the grid; dashed border hints at "tap to create" without trying
 * to imitate a real folder.
 */
/**
 * Renders one row per in-flight (or just-finished) upload in the
 * current folder. Filters by `currentFolderId` so a user with two
 * folders open in two tabs only sees their own ghosts.
 *
 * Successful uploads auto-dismiss 1.5s after they land — by that
 * point the real book card has rendered (the upload-store fires a
 * forced `fetchLibrary` on success), so the ghost would just
 * duplicate it. Errored uploads stay until the user dismisses or
 * retries.
 */
function UploadGhostStrip({
  currentFolderId,
}: {
  currentFolderId: string | null;
}) {
  const uploads = useUploadStore((s) => s.uploads);
  const dismissUpload = useUploadStore((s) => s.dismissUpload);
  const retryUpload = useUploadStore((s) => s.retryUpload);

  const visible = useMemo(() => {
    const out: UploadJob[] = [];
    for (const job of uploads.values()) {
      if ((job.folderId ?? null) === currentFolderId) out.push(job);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [uploads, currentFolderId]);

  // Auto-dismiss successful jobs after a short fade so the ghost
  // doesn't sit next to its real book card forever. Tracks a per-id
  // timer so re-renders don't double-schedule.
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
        />
      ))}
    </div>
  );
}

function UploadGhostRow({
  job,
  onDismiss,
  onRetry,
}: {
  job: UploadJob;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const isError = job.status === "error";
  const isSuccess = job.status === "success";
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

function CreateFolderTile({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("library.allBooks.newFolder")}
      className={cn(
        "group flex w-full flex-col text-left transition-transform",
        "cursor-pointer focus:outline-none",
      )}
    >
      <div
        className={cn(
          "relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md",
          "border-2 border-dashed border-glass-border bg-glass-bg/30",
          "transition-colors group-hover:border-accent/60 group-hover:bg-accent/5",
        )}
      >
        <FolderPlus
          size={28}
          className="text-text-muted transition-colors group-hover:text-accent"
        />
      </div>
      <div className="mt-2 min-w-0">
        <h3 className="truncate text-sm font-medium text-text-secondary group-hover:text-text-primary">
          {t("library.allBooks.newFolder")}
        </h3>
      </div>
    </button>
  );
}

/**
 * One crumb in the breadcrumb path. Behaves as a normal nav button,
 * but also registers as a dnd-kit drop target — dropping a folder or
 * book here moves it to that level. The hover highlight comes from
 * `isOver`; collision detection in dnd-kit picks the smallest
 * matching bounding box, so a crumb deep in the path doesn't grab
 * drops aimed at the row body underneath.
 */
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
