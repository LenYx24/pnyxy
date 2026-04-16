import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  Folder,
  ChevronRight,
  MoreVertical,
  Pencil,
  Trash2,
  FolderInput,
  Upload,
  FileText,
  Tag,
  GripVertical,
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, TagBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useOpenUploadedPdf } from "@/hooks/use-open-uploaded-pdf";
import { useTagStore, bookKey } from "@/stores/tag-store";
import { TagPickerDropdown } from "./TagPickerDropdown";
import type { Folder as FolderType } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";

// ─── Helpers ──────────────────────────────────────────────────

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function getTitle(entry: UnifiedLibraryItem) {
  return entry.source === "catalog" ? entry.catalog_book.title : entry.book.title;
}
function getAuthor(entry: UnifiedLibraryItem) {
  return entry.source === "catalog"
    ? entry.catalog_book.authors?.join(", ") || "Unknown author"
    : entry.book.author || "Unknown author";
}

// ─── Context Menu ─────────────────────────────────────────────

function ContextMenu({
  children,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onToggle();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onToggle]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
          open
            ? "opacity-100"
            : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
        )}
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-lg backdrop-blur-xl">
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-glass-hover cursor-pointer",
        danger ? "text-red-400" : "text-text-secondary hover:text-text-primary",
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

// ─── Sortable Folder Row ───────────────────────────────────────

type RowDensity = ReturnType<typeof getRowDensity>;

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
  onToggleSelect: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  childFolders: FolderType[];
  childBooks: UnifiedLibraryItem[];
  allFolders: FolderType[];
  allBooks: UnifiedLibraryItem[];
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  expandedFolders: Set<string>;
  selectedIds: Set<string>;
  density: RowDensity;
  sortableId?: string;
}

function FolderRow({
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
  expandedFolders,
  selectedIds,
  density,
  sortableId,
}: FolderRowProps) {
  const isTopLevel = depth === 0 && !!sortableId;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId ?? folder.id, disabled: !isTopLevel });

  const style = isTopLevel
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const selKey = `folder:${folder.id}`;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect(selKey, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    if (selectionActive) {
      onToggleSelect(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    onNavigate(folder.id);
  };

  const indent = Math.min(depth * 20, 80);

  return (
    <div ref={isTopLevel ? setNodeRef : undefined} style={style} {...(isTopLevel ? attributes : {})}>
      <div
        className={cn(
          "group flex items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent-purple/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* Drag handle */}
        {isTopLevel && (
          <div
            className="mr-1 shrink-0 cursor-grab text-text-muted/50 hover:text-text-muted active:cursor-grabbing"
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </div>
        )}

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
            onChange={() => onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })}
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

        {/* Folder icon */}
        <Folder size={density.icon} className="mr-2 shrink-0 text-accent-purple/60" />

        {/* Name */}
        <span className={cn("min-w-0 flex-1 truncate font-medium text-text-primary", density.text)}>
          {folder.name}
        </span>

        {/* Item count */}
        <span className="mr-4 hidden shrink-0 text-xs text-text-muted sm:block">
          {childFolders.length + childBooks.length} items
        </span>

        {/* Date */}
        <span className="mr-2 hidden w-20 shrink-0 text-xs text-text-muted lg:block">
          {formatDate(folder.created_at)}
        </span>

        {/* Menu */}
        <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
          <MenuItem
            icon={Pencil}
            label="Rename"
            onClick={() => {
              setMenuOpen(false);
              const name = prompt("Rename folder:", folder.name);
              if (name?.trim()) onRename(folder.id, name.trim());
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
            const cfChildren = allFolders.filter((f) => f.parent_id === cf.id);
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
                expandedFolders={expandedFolders}
                selectedIds={selectedIds}
                density={density}
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
    </div>
  );
}

// ─── Sortable Book Row ─────────────────────────────────────────

interface BookRowProps {
  entry: UnifiedLibraryItem;
  depth?: number;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  onMove: (entry: UnifiedLibraryItem) => void;
  onRemove: (entry: UnifiedLibraryItem) => void;
  density?: RowDensity;
  sortableId?: string;
}

function BookRow({
  entry,
  depth = 0,
  selected,
  selectionActive,
  onToggleSelect,
  onMove,
  onRemove,
  density = { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" },
  sortableId,
}: BookRowProps) {
  const navigate = useNavigate();
  const { openUploadedBook } = useOpenUploadedPdf();

  const isTopLevel = depth === 0 && !!sortableId;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId ?? entry.id, disabled: !isTopLevel });

  const style = isTopLevel
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const tagKey = bookKey(entry);
  const tags = useTagStore((s) => s.bookTags.get(tagKey)) ?? [];
  const selKey = `book:${entry.id}`;
  const title = getTitle(entry);
  const author = getAuthor(entry);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect(selKey, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    if (selectionActive) {
      onToggleSelect(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    if (entry.source === "catalog") {
      navigate(`/browse/${entry.catalog_book_id}`);
    } else {
      openUploadedBook(entry);
    }
  };

  const indent = Math.min(depth * 20, 80);

  return (
    <div ref={isTopLevel ? setNodeRef : undefined} style={style} {...(isTopLevel ? attributes : {})}>
      <div
        className={cn(
          "group flex items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent-purple/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* Drag handle */}
        {isTopLevel && (
          <div
            className="mr-1 shrink-0 cursor-grab text-text-muted/50 hover:text-text-muted active:cursor-grabbing"
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </div>
        )}

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
            onChange={() => onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })}
          />
        </div>

        {/* Spacer matching chevron in folder rows */}
        <div className="mr-1 hidden w-[26px] sm:block" />

        {/* File icon */}
        <FileText size={density.icon} className="mr-2 shrink-0 text-text-muted" />

        {/* Title */}
        <span className={cn("min-w-0 flex-1 truncate text-text-primary", density.text)}>
          {title}
        </span>

        {/* Tag badges */}
        {tags.length > 0 && (
          <div className="mr-2 hidden shrink-0 items-center gap-1 sm:flex">
            {tags.slice(0, 2).map((tag) => (
              <TagBadge key={tag} tag={tag} size="sm" />
            ))}
          </div>
        )}

        {/* Uploaded badge */}
        {entry.source === "uploaded" && (
          <span className="mr-2 hidden items-center gap-1 rounded bg-accent-purple/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-purple sm:inline-flex">
            <Upload size={9} />
            Uploaded
          </span>
        )}

        {/* Author */}
        <span className="mr-4 hidden w-32 shrink-0 truncate text-xs text-text-muted md:block">
          {author}
        </span>

        {/* Date */}
        <span className="mr-2 hidden w-20 shrink-0 text-xs text-text-muted lg:block">
          {formatDate(entry.added_at)}
        </span>

        {/* Menu */}
        <div className="relative">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={Tag}
              label="Manage Tags"
              onClick={() => {
                setMenuOpen(false);
                setTagPickerOpen(true);
              }}
            />
            <MenuItem
              icon={FolderInput}
              label="Move to Folder"
              onClick={() => {
                setMenuOpen(false);
                onMove(entry);
              }}
            />
            <MenuItem
              icon={Trash2}
              label={entry.source === "uploaded" ? "Delete" : "Remove from Library"}
              danger
              onClick={() => {
                setMenuOpen(false);
                onRemove(entry);
              }}
            />
          </ContextMenu>
          {tagPickerOpen && (
            <TagPickerDropdown
              item={entry}
              onClose={() => setTagPickerOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List View Container ──────────────────────────────────────

function getRowDensity(cardSize: number) {
  if (cardSize <= 180) return { py: "py-1", text: "text-xs", icon: 14, gap: "gap-1" } as const;
  if (cardSize <= 250) return { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" } as const;
  return { py: "py-3.5", text: "text-sm", icon: 18, gap: "gap-2.5" } as const;
}

interface LibraryListViewProps {
  folders: FolderType[];
  books: UnifiedLibraryItem[];
  allFolders: FolderType[];
  allBooks: UnifiedLibraryItem[];
  selectedIds: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  onNavigateFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  cardSize?: number;
}

export function LibraryListView({
  folders,
  books,
  allFolders,
  allBooks,
  selectedIds,
  selectionActive,
  onToggleSelect,
  onNavigateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveBook,
  onRemoveBook,
  cardSize = 200,
}: LibraryListViewProps) {
  const density = getRowDensity(cardSize);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (folders.length === 0 && books.length === 0) return null;

  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-glass-border">
      {/* Column headers */}
      <div className="flex items-center border-b border-glass-border bg-glass-bg px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted sm:px-3">
        <div className="mr-1 w-4 shrink-0" /> {/* drag handle spacer */}
        <div className="mr-1.5 w-7 shrink-0 sm:mr-2" />
        <div className="mr-1 hidden w-[26px] sm:block" />
        <div className="mr-2 w-4 shrink-0" />
        <div className="min-w-0 flex-1">Name</div>
        <div className="mr-4 hidden w-32 md:block">Author</div>
        <div className="mr-2 hidden w-20 lg:block">Added</div>
        <div className="w-7 shrink-0" />
      </div>

      {/* Folders */}
      {folders.map((folder) => {
        const childFolders = allFolders.filter(
          (f) => f.parent_id === folder.id,
        );
        const childBooks = allBooks.filter(
          (b) => b.folder_id === folder.id,
        );
        return (
          <FolderRow
            key={folder.id}
            folder={folder}
            sortableId={`folder:${folder.id}`}
            expanded={expandedFolders.has(folder.id)}
            onToggleExpand={toggleExpand}
            onNavigate={onNavigateFolder}
            onRename={onRenameFolder}
            onDelete={onDeleteFolder}
            selected={selectedIds.has(`folder:${folder.id}`)}
            selectionActive={selectionActive}
            onToggleSelect={onToggleSelect}
            childFolders={childFolders}
            childBooks={childBooks}
            allFolders={allFolders}
            allBooks={allBooks}
            onMoveBook={onMoveBook}
            onRemoveBook={onRemoveBook}
            expandedFolders={expandedFolders}
            selectedIds={selectedIds}
            density={density}
          />
        );
      })}

      {/* Books */}
      {books.map((entry) => (
        <BookRow
          key={`${entry.source}-${entry.id}`}
          entry={entry}
          sortableId={`book:${entry.id}`}
          selected={selectedIds.has(`book:${entry.id}`)}
          selectionActive={selectionActive}
          onToggleSelect={onToggleSelect}
          onMove={onMoveBook}
          onRemove={onRemoveBook}
          density={density}
        />
      ))}
    </div>
  );
}
