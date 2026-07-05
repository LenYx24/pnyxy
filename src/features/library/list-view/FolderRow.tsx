import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, PromptModal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { Folder as FolderType } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { Note } from "@/stores/note-store";
import type { WhiteboardData } from "@/types/whiteboard";
import type { Quiz } from "@/types/quiz";
import type { ChatConversation } from "@/types/chat";
import type { ListColumnWidths } from "../useLibraryPrefs";
import { BookRow } from "./BookRow";
import { NoteRow } from "./NoteRow";
import { WhiteboardRow } from "./WhiteboardRow";
import { QuizRow } from "./QuizRow";
import { ChatRow } from "./ChatRow";
import { ContextMenu, MenuItem } from "./MenuButton";
import { formatDate, type RowDensity } from "./helpers";

interface FolderRowProps {
  folder: FolderType;
  depth?: number;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onNavigate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  childFolders: FolderType[];
  childBooks: UnifiedLibraryItem[];
  childNotes?: Note[];
  childWhiteboards?: WhiteboardData[];
  childQuizzes?: Quiz[];
  childChats?: ChatConversation[];
  allFolders: FolderType[];
  allBooks: UnifiedLibraryItem[];
  allNotes?: Note[];
  allWhiteboards?: WhiteboardData[];
  allQuizzes?: Quiz[];
  allChats?: ChatConversation[];
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  /** Open the create-folder modal with this folder as parent. */
  onCreateSubfolder?: (parentFolderId: string) => void;
  expandedFolders: Set<string>;
  selectedIds: Set<string>;
  density: RowDensity;
  sortableId?: string;
  columnWidths: ListColumnWidths;
}

export function FolderRow({
  folder,
  depth = 0,
  expanded,
  onToggleExpand,
  onNavigate,
  onRename,
  onDelete,
  selected,
  selectionActive,
  onToggleSelect,
  childFolders,
  childBooks,
  childNotes = [],
  childWhiteboards = [],
  childQuizzes = [],
  childChats = [],
  allFolders,
  allBooks,
  allNotes = [],
  allWhiteboards = [],
  allQuizzes = [],
  allChats = [],
  onMoveBook,
  onRemoveBook,
  onCreateSubfolder,
  expandedFolders,
  selectedIds,
  density,
  sortableId,
  columnWidths,
}: FolderRowProps) {
  const { t } = useTranslation();
  const isTopLevel = depth === 0;

  // Top-level folders are sortable for sibling reorder. Nested folders are
  // only draggable (to drag out); they accept drops via the nest zone below.
  const sortable = useSortable({
    id: sortableId ?? `folder:${folder.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `folder:${folder.id}`,
    disabled: isTopLevel,
  });

  // Nest droppable covers the row's middle; the top/bottom edges stay with the
  // outer sortable. Drop in middle = nest, drop on edge = reorder above/below.
  const nest = useDroppable({
    id: `nest:${folder.id}`,
    data: { type: "folder", folderId: folder.id },
  });

  const setNodeRef = isTopLevel ? sortable.setNodeRef : draggable.setNodeRef;
  const attributes = isTopLevel ? sortable.attributes : draggable.attributes;
  const listeners = isTopLevel ? sortable.listeners : draggable.listeners;
  const isDragging = isTopLevel ? sortable.isDragging : draggable.isDragging;
  const style = isTopLevel
    ? {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }
    : undefined;

  // content-visibility:auto collapses offscreen rects, which breaks dnd-kit
  // collision detection mid-drag. Disable it while a drag is active.
  const dragActive = useDndContext().active != null;
  const cvStyle = dragActive
    ? null
    : { contentVisibility: "auto" as const, containIntrinsicSize: "auto 48px" };
  const showDropTargetHighlight = nest.isOver;

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const selKey = `folder:${folder.id}`;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    onNavigate(folder.id);
  };

  const indent = Math.min(depth * 20, 80);

  // Items built lazily so they capture fresh callbacks when the menu opens.
  const contextHandlers = useContextMenu((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: "Open",
        icon: FolderOpen,
        onClick: () => onNavigate(folder.id),
      },
      {
        id: "rename",
        label: "Rename",
        icon: Pencil,
        onClick: () => setRenameOpen(true),
      },
    ];
    if (onCreateSubfolder) {
      items.push({
        id: "new-subfolder",
        label: "New subfolder",
        icon: FolderPlus,
        onClick: () => onCreateSubfolder(folder.id),
      });
    }
    items.push(
      { id: "div-1", divider: true },
      {
        id: "delete",
        label: "Delete",
        icon: Trash2,
        danger: true,
        onClick: () => onDelete(folder.id),
      },
    );
    return items;
  });

  return (
    // Row content-visibility skips paint/layout for offscreen rows. 48px
    // over-estimates the densest layout to keep the scrollbar steady.
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...cvStyle,
      }}
      {...attributes}
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          // Same row background as files; only the folder icon differs.
          "group relative flex select-none items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent/10",
          isDragging && "opacity-50",
          showDropTargetHighlight &&
            "bg-accent/15 ring-1 ring-inset ring-accent/50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* Nest drop zone: middle of the row only, so top/bottom edges
            stay with the outer sortable. */}
        <div
          ref={nest.setNodeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0"
          style={{ top: 6, bottom: 6 }}
        />
        {/* Checkbox */}
        <div
          className={cn(
            "mr-1.5 flex shrink-0 items-center transition-opacity sm:mr-2",
            selectionActive || selected
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onChange={() =>
              onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })
            }
          />
        </div>

        {/* Icon. Fixed-height box keeps rows equal height and aligns the
            name column across types. */}
        <div className="mr-2.5 flex h-8 w-7 shrink-0 items-center justify-center sm:h-9">
          <Folder
            size={density.icon + 4}
            className="text-accent"
            strokeWidth={1.5}
          />
        </div>

        {/* Name */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-text-primary",
            density.text,
          )}
        >
          {folder.name}
        </span>

        {/* Menu, placed right after the name. */}
        <div className="relative mr-2 shrink-0">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={Pencil}
              label="Rename"
              onClick={() => {
                setMenuOpen(false);
                setRenameOpen(true);
              }}
            />
            <MenuItem
              icon={Trash2}
              label="Delete"
              danger
              onClick={() => {
                setMenuOpen(false);
                onDelete(folder.id);
              }}
            />
          </ContextMenu>
        </div>

        {/* Size column shows item count for folders. */}
        <span
          className="mr-2 hidden shrink-0 truncate text-sm text-text-secondary lg:block"
          style={{ width: columnWidths.size }}
        >
          {childFolders.length +
            childBooks.length +
            childNotes.length +
            childWhiteboards.length +
            childQuizzes.length +
            childChats.length}{" "}
          items
        </span>

        {/* Date */}
        <span
          className="mr-2 hidden shrink-0 truncate text-sm text-text-secondary lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(folder.created_at)}
        </span>
      </div>

      {/* Expanded children */}
      {expanded && (
        <div>
          {childFolders.map((cf) => {
            const cfChildren = allFolders.filter(
              (f) => f.parent_id === cf.id,
            );
            const cfBooks = allBooks.filter((b) => b.folder_id === cf.id);
            const cfNotes = allNotes.filter((n) => n.folderId === cf.id);
            const cfWhiteboards = allWhiteboards.filter(
              (w) => (w.folderId ?? null) === cf.id,
            );
            const cfQuizzes = allQuizzes.filter(
              (q) => (q.folder_id ?? null) === cf.id,
            );
            const cfChats = allChats.filter(
              (c) => (c.folder_id ?? null) === cf.id,
            );
            return (
              <FolderRow
                key={cf.id}
                folder={cf}
                depth={depth + 1}
                expanded={expandedFolders.has(cf.id)}
                onToggleExpand={onToggleExpand}
                onNavigate={onNavigate}
                onRename={onRename}
                onDelete={onDelete}
                selected={selectedIds.has(`folder:${cf.id}`)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                childFolders={cfChildren}
                childBooks={cfBooks}
                childNotes={cfNotes}
                childWhiteboards={cfWhiteboards}
                childQuizzes={cfQuizzes}
                childChats={cfChats}
                allFolders={allFolders}
                allBooks={allBooks}
                allNotes={allNotes}
                allWhiteboards={allWhiteboards}
                allQuizzes={allQuizzes}
                allChats={allChats}
                onMoveBook={onMoveBook}
                onRemoveBook={onRemoveBook}
                onCreateSubfolder={onCreateSubfolder}
                expandedFolders={expandedFolders}
                selectedIds={selectedIds}
                density={density}
                columnWidths={columnWidths}
              />
            );
          })}
          {childBooks.map((entry) => (
            <BookRow
              key={`${entry.source}-${entry.id}`}
              entry={entry}
              depth={depth + 1}
              selected={selectedIds.has(`book:${entry.id}`)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              onMove={onMoveBook}
              onRemove={onRemoveBook}
              density={density}
              columnWidths={columnWidths}
            />
          ))}
          {childNotes.map((note) => (
            <NoteRow
              key={`note:${note.id}`}
              note={note}
              depth={depth + 1}
              selected={selectedIds.has(`note:${note.id}`)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              density={density}
              columnWidths={columnWidths}
            />
          ))}
          {childWhiteboards.map((wb) => (
            <WhiteboardRow
              key={`whiteboard:${wb.id}`}
              whiteboard={wb}
              depth={depth + 1}
              selected={selectedIds.has(`whiteboard:${wb.id}`)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              density={density}
              columnWidths={columnWidths}
            />
          ))}
          {childQuizzes.map((quiz) => (
            <QuizRow
              key={`quiz:${quiz.id}`}
              quiz={quiz}
              depth={depth + 1}
              selected={selectedIds.has(`quiz:${quiz.id}`)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              density={density}
              columnWidths={columnWidths}
            />
          ))}
          {childChats.map((chat) => (
            <ChatRow
              key={`chat:${chat.id}`}
              conversation={chat}
              depth={depth + 1}
              selected={selectedIds.has(`chat:${chat.id}`)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              density={density}
              columnWidths={columnWidths}
            />
          ))}
          {childFolders.length === 0 &&
            childBooks.length === 0 &&
            childNotes.length === 0 &&
            childWhiteboards.length === 0 &&
            childQuizzes.length === 0 &&
            childChats.length === 0 && (
              <div
                className="px-3 py-2 text-xs text-text-muted italic"
                style={{ paddingLeft: 8 + Math.min((depth + 1) * 20, 80) }}
              >
                Empty folder
              </div>
            )}
        </div>
      )}
      <PromptModal
        open={renameOpen}
        title={t("library.folderCard.rename")}
        defaultValue={folder.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => onRename(folder.id, name)}
      />
    </div>
  );
}
