import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, PromptModal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { Folder as FolderType } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { ListColumnWidths } from "../useLibraryPrefs";
import { BookRow } from "./BookRow";
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
  allFolders: FolderType[];
  allBooks: UnifiedLibraryItem[];
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  /** Open the create-folder modal targeting this folder as parent.
   *  Wired to the "New subfolder" context-menu entry. */
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
  allFolders,
  allBooks,
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

  // Top-level folders participate in the SortableContext for sibling
  // reorder. Nested folders are draggable (so users can drag them out)
  // but not part of any sortable list — they only accept drops via the
  // inner "nest" zone below.
  const sortable = useSortable({
    id: sortableId ?? `folder:${folder.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `folder:${folder.id}`,
    disabled: isTopLevel,
  });

  // Inner "nest into me" droppable. Covers the middle of the row — top
  // and bottom edges remain part of the outer sortable so the sortable
  // reorder only triggers when the user is hovering near an edge, not
  // when they're squarely over a folder. This is the file-manager
  // convention (Finder, Explorer): drop in middle = nest, drop on edge
  // = place above/below.
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

  // Right-click + long-press menu. Items are computed lazily so they
  // capture fresh callbacks at the moment the menu opens.
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
    // Row-level content-visibility: cheap when there are hundreds of
    // rows — the browser skips paint/layout for offscreen ones. 48px
    // is an over-estimate for the densest layout so the scrollbar is
    // steady regardless of which density is active.
    <div
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 48px",
      }}
      {...attributes}
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          // Subtle purple tint on folder rows so they read as distinct
          // containers in the mixed file/folder list (Nextcloud-style).
          "group relative flex select-none items-center border-b border-glass-border/30 bg-accent-purple/[0.04] px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent-purple/10",
          isDragging && "opacity-50",
          showDropTargetHighlight &&
            "bg-accent-purple/15 ring-1 ring-inset ring-accent-purple/50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* "Nest into me" drop zone — covers the middle of the row.
            Smaller than the row so top/bottom edges still belong to
            the outer sortable's drop target. */}
        <div
          ref={nest.setNodeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0"
          style={{ top: 6, bottom: 6 }}
        />
        {/* Drag handle — kept as a visual cue. The whole row is
            draggable; the icon is just an affordance. */}
        <div className="mr-1 shrink-0 text-text-muted/50" aria-hidden="true">
          <GripVertical size={14} />
        </div>

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

        {/* Expand/Collapse chevron */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(folder.id);
          }}
          className="mr-1 shrink-0 cursor-pointer rounded p-1 text-text-muted transition-colors hover:text-text-primary"
        >
          <ChevronRight
            size={density.icon}
            className={cn(
              "transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>

        {/* Folder icon — chunky tinted square so "this is a folder"
            reads unmistakably in a list of book rows. */}
        <div
          className="mr-2 flex shrink-0 items-center justify-center rounded-md bg-accent-purple/15"
          style={{
            width: density.icon + 12,
            height: density.icon + 12,
          }}
        >
          <Folder
            size={density.icon}
            className="text-accent-purple"
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

        {/* Item count — aligns under the Author column on md+. */}
        <span
          className="mr-4 hidden shrink-0 truncate text-xs text-text-muted md:block"
          style={{ width: columnWidths.author }}
        >
          {childFolders.length + childBooks.length} items
        </span>

        {/* Spacer matching the BookRow's Size column. */}
        <span
          className="mr-2 hidden shrink-0 lg:block"
          style={{ width: columnWidths.size }}
          aria-hidden="true"
        />

        {/* Date */}
        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(folder.created_at)}
        </span>

        {/* Menu */}
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

      {/* Expanded children */}
      {expanded && (
        <div>
          {childFolders.map((cf) => {
            const cfChildren = allFolders.filter(
              (f) => f.parent_id === cf.id,
            );
            const cfBooks = allBooks.filter((b) => b.folder_id === cf.id);
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
                allFolders={allFolders}
                allBooks={allBooks}
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
          {childFolders.length === 0 && childBooks.length === 0 && (
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
