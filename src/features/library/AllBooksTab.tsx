import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  defaultDropAnimationSideEffects,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
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
  Loader2,
} from "lucide-react";
import { Button, GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useTagStore } from "@/stores/tag-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useIsMobile } from "@/hooks/use-media-query";
import { formatShortcut } from "@/lib/keyboard-shortcuts";
import { FolderCard } from "./FolderCard";
import { LibraryBookCard } from "./LibraryBookCard";
import { LibraryListView } from "./LibraryListView";
import { CreateFolderModal } from "./CreateFolderModal";
import { applySort } from "./useLibraryPrefs";
import type { ViewMode } from "./useLibraryPrefs";
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

  const getTagsForBook = useTagStore((s) => s.getTagsForBook);

  const subfolders = useMemo(
    () => folders.filter((f) => f.parent_id === currentFolderId),
    [folders, currentFolderId],
  );
  const booksInFolder = useMemo(
    () => books.filter((b) => b.folder_id === currentFolderId),
    [books, currentFolderId],
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

  // ─── Sort order ───────────────────────────────────────────
  const contextId = currentFolderId ?? "root";
  const savedOrder = sortOrders[contextId];

  // Build combined sortable items (folders first, then books)
  const allItemKeys = useMemo(() => {
    const folderKeys = filteredFolders.map((f) => `folder:${f.id}`);
    const bookKeys = filteredBooks.map((b) => `book:${b.id}`);
    return [...folderKeys, ...bookKeys];
  }, [filteredFolders, filteredBooks]);

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

  // Ordered arrays for rendering
  const orderedFolders = useMemo(
    () => orderedKeys.filter((k) => k.startsWith("folder:")).map((k) => folderMap.get(k)!).filter(Boolean),
    [orderedKeys, folderMap],
  );
  const orderedBooks = useMemo(
    () => orderedKeys.filter((k) => k.startsWith("book:")).map((k) => bookMap.get(k)!).filter(Boolean),
    [orderedKeys, bookMap],
  );

  // ─── DnD ─────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Mobile: long-press kicks off the drag so a regular tap on a
    // row still navigates / opens the context menu instead of
    // dragging away on the first finger move.
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

  const isEmpty = filteredFolders.length === 0 && filteredBooks.length === 0;
  // On mobile the desktop cardSize default (200px) means a single
  // column and a giant 300px-tall cover per row. Clamp the grid's
  // floor to ~130px so two cards fit on a 375px viewport — matches
  // how Apple Books / Readwise lay out on phones.
  const effectiveCardSize = isMobile ? Math.min(cardSize, 130) : cardSize;
  const coverHeight = Math.round(effectiveCardSize * 0.6);

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
        collisionDetection={closestCenter}
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

          {/* The "New folder" button used to live here. It's now an
              inline tile/row inside the grid and list views — the
              user creates a folder where folders live, not from a
              header button. The Ctrl+Shift+F shortcut is still
              wired in case keyboard users want it. */}
        </div>
      </div>

      {/* Search empty state */}
      {isEmpty && query && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-text-muted">
            {t("library.allBooks.noSearchResults", { query: searchQuery })}
          </p>
        </div>
      )}

      {/* Loading state */}
      {isEmpty && !query && isLoading && (
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-accent-purple" />
        </div>
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
                allFolders={folders}
                allBooks={books}
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
                  return null;
                })}
              </div>
            )}
          </SortableContext>

          <DragOverlay dropAnimation={dropAnimation}>
            {activeDragFolder && (
              <div style={{ width: cardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent-purple">
                  <div
                    className="flex w-full items-center justify-center"
                    style={{ height: coverHeight }}
                  >
                    <Folder
                      size={Math.round(Math.min(Math.max(coverHeight * 0.35, 24), 48))}
                      className="text-accent-purple/60"
                    />
                  </div>
                  <div className={coverHeight < 100 ? "p-2" : "p-3"}>
                    <h3
                      className={`mb-0.5 truncate font-semibold text-text-primary ${coverHeight < 100 ? "text-xs" : "text-sm"}`}
                    >
                      {activeDragFolder.name}
                    </h3>
                    <p
                      className={`truncate text-text-muted ${coverHeight < 100 ? "text-[10px]" : "text-xs"}`}
                    >
                      {t("library.allBooks.folderLabel")}
                    </p>
                  </div>
                </GlassCard>
              </div>
            )}
            {activeDragBook && (
              <div style={{ width: cardSize }} className="pointer-events-none">
                <GlassCard className="overflow-hidden opacity-90 shadow-2xl ring-2 ring-accent-purple">
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
                className="cursor-pointer rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
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
          "transition-colors group-hover:border-accent-purple/60 group-hover:bg-accent-purple/5",
        )}
      >
        <FolderPlus
          size={28}
          className="text-text-muted transition-colors group-hover:text-accent-purple"
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
          ? "bg-accent-purple/20 text-accent-purple ring-1 ring-accent-purple/60"
          : "text-text-muted hover:text-text-primary hover:bg-glass-hover",
      )}
    >
      {children}
    </button>
  );
}
