import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Folder,
  FolderOpen,
  ChevronRight,
  MoreVertical,
  Pencil,
  Trash2,
  FolderInput,
  FolderPlus,
  Upload,
  Tag,
  GripVertical,
  Share2,
  Info,
} from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, FloatingMenu, PromptModal, TagBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useTagStore, bookKey } from "@/stores/tag-store";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { bookIdSegment } from "@/lib/slugify";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { TagPickerDropdown } from "./TagPickerDropdown";
import { ShareBookModal } from "./ShareBookModal";
import { BookInfoModal } from "./BookInfoModal";
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function getFileSize(entry: UnifiedLibraryItem): string | null {
  if (entry.source === "uploaded" && entry.book.size_bytes) {
    return formatBytes(entry.book.size_bytes);
  }
  return null;
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
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
      {/* Portal-rendered so the menu can't be clipped by the list
          container's `overflow-x-auto` (the bug this whole detour
          fixes). Position is computed from the trigger's bounding
          rect so it still feels visually attached to the button. */}
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={onToggle}
        className="w-44"
      >
        {children}
      </FloatingMenu>
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
  /** Open the create-folder modal targeting this folder as parent.
   *  Wired to the "New subfolder" context-menu entry. */
  onCreateSubfolder?: (parentFolderId: string) => void;
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
  onCreateSubfolder,
  expandedFolders,
  selectedIds,
  density,
  sortableId,
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

  // Right-click + long-press menu. Items are computed lazily so they
  // capture fresh callbacks at the moment the menu opens.
  const contextHandlers = useContextMenu(
    (): ContextMenuEntry[] => {
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
    },
  );

  return (
    // Row-level content-visibility: cheap when there are hundreds
    // of rows — the browser skips paint/layout for offscreen ones.
    // 48px is an over-estimate for the densest layout so the
    // scrollbar is steady regardless of which density is active.
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
          // Subtle purple tint on folder rows so they read as
          // distinct containers in the mixed file/folder list
          // (Nextcloud-style — folders pop out without needing a
          // separate section). Selected/drop highlights override
          // the tint via Tailwind's later-wins rule.
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
            Sized smaller than the row so the top/bottom edges remain
            the outer sortable's drop target (used for sibling reorder
            on top-level rows). When the cursor is in the middle, this
            inner zone wins collision detection because it has the
            smaller bounding box, and we get a drop-into-folder action
            instead of a sibling-reorder. */}
        <div
          ref={nest.setNodeRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0"
          style={{ top: 6, bottom: 6 }}
        />
        {/* Drag handle — kept as a visual cue. The whole row is
            draggable; the icon is just an affordance. */}
        <div
          className="mr-1 shrink-0 text-text-muted/50"
          aria-hidden="true"
        >
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

        {/* Folder icon — wrapped in a chunky tinted square so the
            "this is a folder" affordance is unmistakable in a
            list of book rows. Box sizes off the density's icon
            metric so the row's overall height stays consistent
            across the three density variants. */}
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
                onCreateSubfolder={onCreateSubfolder}
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
  const { t } = useTranslation();
  const { openUploadedBook } = useOpenUploadedDocument();
  // Same in-progress check as the grid view; library-store hydrates
  // the set on Library mount.
  const isInProgress = useLibraryStore((s) =>
    s.inProgressDocIds.has(
      entry.source === "catalog" ? entry.catalog_book_id : entry.book.id,
    ),
  );

  const isTopLevel = depth === 0;
  // Top-level: sortable (sibling reorder + drag). Nested: draggable
  // only — same drag UX, just not part of any sortable list.
  const sortable = useSortable({
    id: sortableId ?? `book:${entry.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `book:${entry.id}`,
    disabled: isTopLevel,
  });
  const setNodeRef = isTopLevel ? sortable.setNodeRef : draggable.setNodeRef;
  const attributes = isTopLevel ? sortable.attributes : draggable.attributes;
  const listeners = isTopLevel ? sortable.listeners : draggable.listeners;
  const isDragging = isTopLevel ? sortable.isDragging : draggable.isDragging;
  const transform = isTopLevel ? sortable.transform : draggable.transform;
  const transition = isTopLevel ? sortable.transition : undefined;

  // Apply the drag transform regardless of nesting so the row visibly
  // follows the cursor while being dragged.
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Anchor for the tag picker. Wraps the ContextMenu's button area so
  // the picker pops near the 3-dots (which is the "Manage tags" entry
  // they just clicked from). The 3-dots button itself is owned by
  // ContextMenu so we can't ref it directly — wrapping is simpler.
  const tagAnchorRef = useRef<HTMLDivElement>(null);
  const tagKey = bookKey(entry);
  const tags = useTagStore((s) => s.bookTags.get(tagKey)) ?? [];
  const customTags = useTagStore((s) => s.customTagsByBook.get(tagKey)) ?? [];
  const selKey = `book:${entry.id}`;
  const title = getTitle(entry);
  const author = getAuthor(entry);
  const coverUrl =
    entry.source === "catalog"
      ? entry.catalog_book.cover_url
      : entry.book.cover_url;

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
    // Pre-bake slug — same reasoning as the grid card.
    if (entry.source === "catalog") {
      navigate(
        `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
      );
    } else {
      navigate(`/books/${bookIdSegment(entry.book.id, entry.book.title)}`);
    }
  };

  const indent = Math.min(depth * 20, 80);

  const contextHandlers = useContextMenu((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: "Open",
        icon: BookOpen,
        onClick: () => {
          if (entry.source === "catalog") {
            navigate(
              `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`,
            );
          } else {
            navigate(
              `/books/${bookIdSegment(entry.book.id, entry.book.title)}`,
            );
          }
        },
      },
      {
        id: "info",
        label: "File info",
        icon: Info,
        onClick: () => setInfoOpen(true),
      },
      {
        id: "tags",
        label: "Manage tags",
        icon: Tag,
        onClick: () => setTagPickerOpen(true),
      },
      {
        id: "move",
        label: "Move to folder…",
        icon: FolderInput,
        onClick: () => onMove(entry),
      },
    ];
    if (entry.source === "uploaded") {
      items.push({
        id: "share",
        label: "Share with community",
        icon: Share2,
        onClick: () => setShareOpen(true),
      });
    }
    items.push({ id: "div-1", divider: true });
    items.push({
      id: "remove",
      label: entry.source === "uploaded" ? "Delete" : "Remove from library",
      icon: Trash2,
      danger: true,
      onClick: () => onRemove(entry),
    });
    return items;
  });

  return (
    // Mirrors FolderRow's content-visibility wrapper — see the
    // comment there for the why.
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
          "group flex select-none items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent-purple/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* Drag handle — visual cue; the entire row is draggable. */}
        <div
          className="mr-1 shrink-0 text-text-muted/50"
          aria-hidden="true"
        >
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
            onChange={() => onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })}
          />
        </div>

        {/* Spacer matching chevron in folder rows */}
        <div className="mr-1 hidden w-[26px] sm:block" />

        {/* Cover thumbnail — 5:7 mini-cover. Falls back to a gradient
            tile with the first letter when no cover is available. */}
        <div className="mr-2.5 aspect-[5/7] h-8 shrink-0 overflow-hidden rounded-sm bg-glass-bg sm:h-9">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover object-top"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-purple/25 to-accent-blue/25">
              <span className="text-xs font-bold text-white/30">
                {title.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Title */}
        <span
          className={cn("min-w-0 flex-1 truncate text-text-primary", density.text)}
          title={`${title}${author ? " — " + author : ""}`}
        >
          {title}
        </span>

        {/* Tag badges */}
        {(tags.length > 0 || customTags.length > 0) && (
          <div className="mr-2 hidden shrink-0 items-center gap-1 sm:flex">
            {tags.slice(0, 2).map((tag) => (
              <TagBadge key={tag} tag={tag} size="sm" />
            ))}
            {customTags.slice(0, 2).map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border border-glass-border bg-glass-bg px-1.5 py-0.5 text-[10px] text-text-secondary"
                title={label}
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Reading pill — same data source as the grid view. Sits
            inline with the other small badges instead of overlaying
            anything, since the row layout has natural slots. */}
        {isInProgress && (
          <span className="mr-2 hidden items-center gap-1 rounded bg-accent-purple/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white sm:inline-flex">
            {t("library.reading")}
          </span>
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

        {/* Size */}
        <span className="mr-2 hidden w-16 shrink-0 text-xs text-text-muted lg:block">
          {getFileSize(entry) ?? "—"}
        </span>

        {/* Date */}
        <span className="mr-2 hidden w-20 shrink-0 text-xs text-text-muted lg:block">
          {formatDate(entry.added_at)}
        </span>

        {/* Quick "Open in reader" — uploaded books only. Lives just
            before the 3-dot menu so it's reachable in the same eye
            sweep as the rest of the per-row actions. */}
        {entry.source === "uploaded" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void openUploadedBook(entry);
            }}
            aria-label={t("library.actions.openInReader")}
            title={t("library.actions.openInReader")}
            className="mr-1.5 shrink-0 rounded-md bg-accent-purple/15 p-1.5 text-accent-purple transition-colors hover:bg-accent-purple/25 cursor-pointer"
          >
            <BookOpen size={14} />
          </button>
        )}

        {/* Menu */}
        <div ref={tagAnchorRef} className="relative">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={Info}
              label="File Info"
              onClick={() => {
                setMenuOpen(false);
                setInfoOpen(true);
              }}
            />
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
            {entry.source === "uploaded" && (
              <MenuItem
                icon={Share2}
                label="Share with community"
                onClick={() => {
                  setMenuOpen(false);
                  setShareOpen(true);
                }}
              />
            )}
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
              anchorRef={tagAnchorRef}
              onClose={() => setTagPickerOpen(false)}
            />
          )}
        </div>
      </div>
      {entry.source === "uploaded" && (
        <ShareBookModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          entry={entry}
        />
      )}
      <BookInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        entry={entry}
      />
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
  /** "New subfolder" — wired through to FolderRow's context menu. */
  onCreateSubfolder?: (parentFolderId: string) => void;
  /** "New folder" — fired by the empty-area right-click on the list
   *  container, creating a folder at the currently-viewed level. */
  onCreateRootFolder?: () => void;
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
  onCreateSubfolder,
  onCreateRootFolder,
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
    <LibraryListContainer onCreateRootFolder={onCreateRootFolder}>
      {/* Column headers */}
      <div className="flex items-center border-b border-glass-border bg-glass-bg px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted sm:px-3">
        <div className="mr-1 w-4 shrink-0" /> {/* drag handle spacer */}
        <div className="mr-1.5 w-7 shrink-0 sm:mr-2" />
        <div className="mr-1 hidden w-[26px] sm:block" />
        <div className="mr-2 w-4 shrink-0" />
        <div className="min-w-0 flex-1">Name</div>
        <div className="mr-4 hidden w-32 md:block">Author</div>
        <div className="mr-2 hidden w-16 shrink-0 lg:block">Size</div>
        <div className="mr-2 hidden w-20 lg:block">Added</div>
        <div className="w-7 shrink-0" />
      </div>

      {/* "+ New folder" row — sits at the head of the list as the
          inline create affordance, matching the dashed tile in the
          grid view. */}
      {onCreateRootFolder && <CreateFolderRow onClick={onCreateRootFolder} />}

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
            onCreateSubfolder={onCreateSubfolder}
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
    </LibraryListContainer>
  );
}

// Wraps the list with the original styling + the empty-area context
// menu. Using a sub-component because `useContextMenu` is a hook and
// has to live inside its own component to keep call-order stable.
function LibraryListContainer({
  children,
  onCreateRootFolder,
}: {
  children: React.ReactNode;
  onCreateRootFolder?: () => void;
}) {
  // The hook spreads `onContextMenu` (which calls stopPropagation),
  // so right-clicks on rows that already have their own menu won't
  // bubble up to this container — only clicks on empty space do.
  const containerCtx = useContextMenu((): ContextMenuEntry[] =>
    onCreateRootFolder
      ? [
          {
            id: "new-folder-here",
            label: "New folder",
            icon: FolderPlus,
            onClick: () => onCreateRootFolder(),
          },
        ]
      : [],
  );
  return (
    <div
      {...containerCtx}
      className="overflow-x-auto overflow-y-hidden rounded-lg border border-glass-border"
    >
      {children}
    </div>
  );
}

/**
 * Inline "create folder" row — the list-view counterpart to the
 * dashed tile in the grid view. Same affordance, different layout.
 */
function CreateFolderRow({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("library.allBooks.newFolder")}
      className={cn(
        "group flex w-full items-center gap-2 border-b border-dashed border-glass-border px-2 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer sm:px-3",
      )}
    >
      <FolderPlus
        size={16}
        className="text-text-muted group-hover:text-accent-purple"
      />
      <span>{t("library.allBooks.newFolder")}</span>
    </button>
  );
}
