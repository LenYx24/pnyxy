import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  ChevronRight,
  FolderPlus,
  ArrowUp,
  BookOpen,
  Folder,
  Loader2,
} from "lucide-react";
import { Button, GlassCard, Kbd } from "@/components/ui";
import { useLibraryStore } from "@/stores/library-store";
import { useTagStore } from "@/stores/tag-store";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
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
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);
  const folderPath = useLibraryStore((s) => s.folderPath);
  const folders = useLibraryStore((s) => s.folders);
  const books = useLibraryStore((s) => s.books);
  const navigateToFolder = useLibraryStore((s) => s.navigateToFolder);
  const createFolderPath = useLibraryStore((s) => s.createFolderPath);
  const renameFolder = useLibraryStore((s) => s.renameFolder);
  const deleteFolder = useLibraryStore((s) => s.deleteFolder);

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
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = orderedKeys.indexOf(active.id as string);
      const newIndex = orderedKeys.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(orderedKeys, oldIndex, newIndex);
      setSortOrder(contextId, newOrder);
    },
    [orderedKeys, contextId, setSortOrder],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  // ─── Other handlers ───────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  const handleCreateFolder = useCallback(() => {
    setCreateFolderOpen(true);
  }, []);

  const handleConfirmCreateFolder = async (name: string) => {
    // Name may be a slash-separated path like "p1/p2/p3"; createFolderPath
    // walks each segment, reusing existing siblings and creating missing
    // parents. A bare name (no "/") behaves exactly as before.
    await createFolderPath(name, currentFolderId);
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
  const coverHeight = Math.round(cardSize * 0.6);

  // ─── Drag overlay content ────────────────────────────────
  const activeDragFolder = activeId ? folderMap.get(activeId) : null;
  const activeDragBook = activeId ? bookMap.get(activeId) : null;

  return (
    <div>
      {/* Toolbar: Breadcrumbs + Actions */}
      <div className="mb-4 flex items-center justify-between gap-2">
        {/* Breadcrumbs */}
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
          <button
            onClick={() => navigateToFolder(null)}
            className="cursor-pointer text-text-muted transition-colors hover:text-text-primary"
          >
            {t("library.allBooks.breadcrumbRoot")}
          </button>
          {folderPath.map((folder, i) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight size={14} className="text-text-muted" />
              {i === folderPath.length - 1 ? (
                <span className="font-medium text-text-primary">
                  {folder.name}
                </span>
              ) : (
                <button
                  onClick={() => navigateToFolder(folder.id)}
                  className="cursor-pointer text-text-muted transition-colors hover:text-text-primary"
                >
                  {folder.name}
                </button>
              )}
            </span>
          ))}
        </nav>

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

          <Button
            variant="secondary"
            className="gap-1.5 px-3 py-1.5 text-xs sm:text-sm"
            onClick={handleCreateFolder}
            title={t("library.allBooks.newFolderTitle", {
              shortcut: formatShortcut({ key: "f", ctrl: true, shift: true }),
            })}
          >
            <FolderPlus size={16} />
            <span>{t("library.allBooks.newFolder")}</span>
            <Kbd
              shortcut={{ key: "f", ctrl: true, shift: true }}
              className="ml-1 hidden lg:inline-flex"
            />
          </Button>
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
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
                cardSize={cardSize}
              />
            )}

            {viewMode === "grid" && (
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`,
                }}
              >
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

          <DragOverlay>
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
        </DndContext>
      )}

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
