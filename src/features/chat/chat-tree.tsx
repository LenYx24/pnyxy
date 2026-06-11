import { memo, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder as FolderIcon,
  FolderInput,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FloatingMenu } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { cn } from "@/lib/cn";
import type { ChatConversation, ChatFolder } from "@/types/chat";

// Cap on root-level conversations rendered inside Quick chats before
// the user has to click "show more". Tuned for the median case: most
// people accumulate dozens of loose chats; surfacing the latest 8
// keeps the sidebar legible while still putting the recently-touched
// ones in view.
const QUICK_CHATS_VISIBLE_LIMIT = 8;

export interface ChatTreeProps {
  folders: ChatFolder[];
  conversations: ChatConversation[];
  activeId: string | null;
  /** dnd-kit's `active.id` for the in-flight drag, if any. Used by
   *  conversation rows to know whether to draw a drop-line. */
  activeDragId?: string | null;
  /** dnd-kit's `over.id` for the in-flight drag. Conversation rows
   *  whose id matches this draw a 2px accent line at their top edge
   *  as an explicit "insert here" indicator on top of the natural
   *  shift the sortable strategy already provides. */
  overDragId?: string | null;
  editingId: string | null;
  editTitle: string;
  /** Folder ids that are currently collapsed. Absence = expanded.
   *  Lifted to ChatPage so the toolbar's Collapse-all / Expand-all
   *  button can mutate every folder in one click. */
  collapsedFolders: Set<string>;
  onToggleFolder: (id: string) => void;
  /** Create a new conversation directly inside this folder. Skips
   *  the old "create at root, then drag-drop" two-step. */
  onNewInFolder: (folderId: string) => void;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onSaveTitle: (id: string) => void;
  onEditTitleChange: (s: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  /** Bubble rename/delete intents up to ChatPage, where the actual
   *  modal lives. The folder rows just gather (id, currentName) and
   *  let the parent decide how to confirm. */
  onRequestRenameFolder: (id: string, currentName: string) => void;
  onRequestDeleteFolder: (id: string, currentName: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/**
 * Per-depth left indent for sidebar rows. Renders one fixed-width
 * span per depth level (8px base gutter + 12px per step), each step
 * carrying a thin left border so the user sees a vertical guide line
 * from a folder header down to its children — same trick Obsidian's
 * file explorer uses.
 */
function IndentGuides({ depth }: { depth: number }) {
  return (
    <div className="flex shrink-0 self-stretch" aria-hidden="true">
      <span className="w-2" />
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="w-3 border-l border-glass-border/40" />
      ))}
    </div>
  );
}

export function ChatTree(props: ChatTreeProps) {
  const { folders, conversations, t } = props;
  // The whole tree is a "root" droppable so any drop that misses a
  // folder or conv lands at root — fixes the prior bug where the
  // thin RootDropZone strip was the only valid root target and was
  // easy to miss. The collision detector prefers the smallest
  // matching droppable, so nested folders/convs still win when the
  // pointer is over them; this large wrapper just catches drops in
  // the empty space between rows.
  const rootDroppable = useDroppable({ id: "root" });
  // Index conversations and child folders by parent for cheap lookup.
  // Folder tree is flat-with-parent_id; we render recursively from
  // the roots (parent_id === null) downward.
  const childFolders = useMemo(() => {
    const m = new Map<string | null, typeof folders>();
    for (const f of folders) {
      const arr = m.get(f.parent_id) ?? [];
      arr.push(f);
      m.set(f.parent_id, arr);
    }
    return m;
  }, [folders]);
  const folderConversations = useMemo(() => {
    const m = new Map<string | null, typeof conversations>();
    for (const c of conversations) {
      const arr = m.get(c.folder_id) ?? [];
      arr.push(c);
      m.set(c.folder_id, arr);
    }
    return m;
  }, [conversations]);

  const rootConvs = folderConversations.get(null) ?? [];
  // Synthetic folder id used for the Quick chats section in the
  // collapsedFolders set + the show-all toggle. Kept consistent
  // between renders so the user's collapse state survives across
  // reorderings.
  const QUICK_CHATS_KEY = "__quick_chats__";
  const quickChatsCollapsed = props.collapsedFolders.has(QUICK_CHATS_KEY);
  const [quickChatsShowAll, setQuickChatsShowAll] = useState(false);
  const visibleRootConvs = quickChatsShowAll
    ? rootConvs
    : rootConvs.slice(0, QUICK_CHATS_VISIBLE_LIMIT);
  const hiddenRootCount = rootConvs.length - visibleRootConvs.length;
  // Sortable item ids for the Quick chats context — used by the
  // SortableContext wrapper so drag-over-sibling produces the
  // standard "items shift to make room" feedback.
  const rootConvIds = useMemo(
    () => rootConvs.map((c) => `conv:${c.id}`),
    [rootConvs],
  );

  return (
    <div
      ref={rootDroppable.setNodeRef}
      className={cn(
        "flex flex-col gap-0.5 transition-colors rounded-md",
        // Faint outline when the pointer is in tree-root catchment
        // and nothing more specific is matched — gives the user a
        // "this drop will go to root" hint without a giant banner.
        rootDroppable.isOver && "ring-1 ring-accent/30",
      )}
    >
      {/* Quick chats — virtual top-level folder grouping every loose
          (folder_id = null) conversation. Always pinned at the top
          and tinted with the accent color so it stays distinct from
          the user's organized folders. */}
      <div className="rounded-md bg-accent/[0.06]">
        <div className="group flex items-stretch">
          <IndentGuides depth={0} />
          <div className="flex flex-1 items-center gap-1.5 py-1.5 pr-2 min-w-0">
            <button
              onClick={() => props.onToggleFolder(QUICK_CHATS_KEY)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent/80 transition-colors hover:text-accent cursor-pointer"
              aria-label={
                quickChatsCollapsed
                  ? t("common.expand")
                  : t("common.collapse")
              }
            >
              {quickChatsCollapsed ? (
                <ChevronRight size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
            </button>
            <MessagesSquare
              size={12}
              className="shrink-0 text-accent/80"
            />
            <button
              onClick={() => props.onToggleFolder(QUICK_CHATS_KEY)}
              className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-accent/90 cursor-pointer"
            >
              {t("chat.sidebar.quickChats", { defaultValue: "Quick chats" })}
              {rootConvs.length > 0 && (
                <span className="ml-1.5 text-2xs font-normal text-accent/60">
                  {rootConvs.length}
                </span>
              )}
            </button>
          </div>
        </div>
        {!quickChatsCollapsed && (
          <SortableContext
            items={rootConvIds}
            strategy={verticalListSortingStrategy}
          >
            {visibleRootConvs.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                depth={1}
                {...props}
              />
            ))}
            {hiddenRootCount > 0 && (
              <button
                onClick={() => setQuickChatsShowAll((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-2xs text-accent/70 transition-colors hover:bg-accent/10 hover:text-accent cursor-pointer"
                style={{ paddingLeft: 8 + 1 * 12 }}
              >
                <MoreHorizontal size={12} />
                {t("chat.sidebar.showAllQuickChats", {
                  defaultValue: "Show {{count}} more",
                  count: hiddenRootCount,
                })}
              </button>
            )}
            {quickChatsShowAll &&
              rootConvs.length > QUICK_CHATS_VISIBLE_LIMIT && (
                <button
                  onClick={() => setQuickChatsShowAll(false)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-2xs text-accent/70 transition-colors hover:bg-accent/10 hover:text-accent cursor-pointer"
                  style={{ paddingLeft: 8 + 1 * 12 }}
                >
                  <ChevronDown size={12} className="rotate-180" />
                  {t("chat.sidebar.showFewerQuickChats", {
                    defaultValue: "Show fewer",
                  })}
                </button>
              )}
          </SortableContext>
        )}
      </div>

      {/* Separator between Quick chats and the user's organized
          folder tree. Renders only when there's at least one folder. */}
      {(childFolders.get(null) ?? []).length > 0 && (
        <div className="my-1 h-px bg-glass-border" />
      )}

      {(() => {
        const rootFolders = childFolders.get(null) ?? [];
        const rootFolderIds = rootFolders.map((f) => `folder:${f.id}`);
        return (
          <SortableContext
            items={rootFolderIds}
            strategy={verticalListSortingStrategy}
          >
            {rootFolders.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                depth={0}
                childFolders={childFolders}
                folderConversations={folderConversations}
                {...props}
              />
            ))}
          </SortableContext>
        );
      })()}
    </div>
  );
}

interface FolderRowProps extends ChatTreeProps {
  folder: ChatFolder;
  depth: number;
  childFolders: Map<string | null, ChatFolder[]>;
  folderConversations: Map<string | null, ChatConversation[]>;
}

// React.memo so the entire sidebar tree doesn't re-render every
// time the user types a character into the composer below.
const FolderRow = memo(function FolderRow({
  folder,
  depth,
  childFolders,
  folderConversations,
  ...rest
}: FolderRowProps) {
  // Expanded state lifted to ChatPage so "Collapse all / Expand all"
  // can write to every folder at once.
  const expanded = !rest.collapsedFolders.has(folder.id);
  const subFolders = childFolders.get(folder.id) ?? [];
  const subConversations = folderConversations.get(folder.id) ?? [];
  const subFolderIds = useMemo(
    () => subFolders.map((f) => `folder:${f.id}`),
    [subFolders],
  );
  const subConvIds = useMemo(
    () => subConversations.map((c) => `conv:${c.id}`),
    [subConversations],
  );
  const t = rest.t;
  // Folders are now sortable: a single useSortable call gives us
  // drag-source + drop-target on the same node, with the
  // `folder:<id>` id used for both. The drag-end handler in ChatPage
  // disambiguates "drop on folder" semantics by parent comparison —
  // same-parent → reorder, different-parent → nest.
  const sortable = useSortable({ id: `folder:${folder.id}` });
  // Aliased back to the prior name so the rest of the function body
  // (which referenced `draggable.*`) keeps working without churn.
  // useSortable is a superset of the draggable + droppable hooks.
  const draggable = sortable;

  // Visual feedback split. The folder row can be on the receiving
  // end of two different intents at the same time:
  //   - sibling reorder (active folder shares this folder's parent)
  //   - nest into (active is a conv, or a folder from a different
  //     parent — drop-into is the explicit "go inside" intent)
  // The drop-line and the purple nest highlight should not BOTH
  // fire on the same row, so we pick one based on the active drag's
  // source. activeFolderParentId comes through rest because the row
  // doesn't have direct access to the folders list.
  const activeDragId = rest.activeDragId ?? null;
  const overDragId = rest.overDragId ?? null;
  const isOver = overDragId === `folder:${folder.id}`;
  // Identify whether the active drag is a sibling folder. We look it
  // up in the rest.folders list rather than threading another prop.
  const activeFolderParentId = useMemo(() => {
    if (!activeDragId?.startsWith("folder:")) return undefined;
    const id = activeDragId.slice("folder:".length);
    return rest.folders.find((f) => f.id === id)?.parent_id;
  }, [activeDragId, rest.folders]);
  const isActiveSibling =
    activeFolderParentId !== undefined &&
    activeFolderParentId === folder.parent_id;
  const showDropLine = isOver && isActiveSibling && activeDragId !== `folder:${folder.id}`;
  // Nest highlight stays on for conv drags and for non-sibling
  // folder drags. Suppressed while THIS folder is being dragged so
  // the source doesn't paint itself as a target.
  const showNestHighlight =
    isOver &&
    !sortable.isDragging &&
    !isActiveSibling;
  // Right-click on desktop, 500ms long-press on touch. Mirrors the
  // hover icons so mobile users (no hover state) and trackpad users
  // (no exposed hover) can still reach folder actions.
  const ctxMenu = useContextMenu(() => [
    {
      id: "new",
      label: rest.t("chat.sidebar.newInFolder", {
        defaultValue: "New conversation here",
      }),
      icon: FilePlus2,
      onClick: () => rest.onNewInFolder(folder.id),
    },
    { id: "div-1", divider: true } as const,
    {
      id: "rename",
      label: rest.t("chat.folders.rename"),
      icon: Pencil,
      onClick: () => rest.onRequestRenameFolder(folder.id, folder.name),
    },
    {
      id: "delete",
      label: rest.t("chat.folders.delete"),
      icon: Trash2,
      onClick: () => rest.onRequestDeleteFolder(folder.id, folder.name),
      danger: true,
    },
  ]);
  return (
    <>
      <div
        ref={sortable.setNodeRef}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }}
        {...draggable.attributes}
        {...draggable.listeners}
        {...ctxMenu}
        className={cn(
          "group relative flex items-stretch rounded-md text-text-secondary transition-colors cursor-grab active:cursor-grabbing",
          showNestHighlight
            ? "bg-accent/20 ring-1 ring-accent/60"
            : "hover:bg-glass-hover hover:text-text-primary",
          sortable.isDragging && "opacity-40",
        )}
      >
        {/* Sibling-reorder drop line — only renders when the active
            drag is a folder sharing this folder's parent (i.e. a
            sibling drop, not a nest-into). Mutually exclusive with
            showNestHighlight above. */}
        {showDropLine && (
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 rounded-full bg-accent"
            aria-hidden="true"
          />
        )}
        <IndentGuides depth={depth} />
        <div className="flex flex-1 items-center gap-1.5 py-1.5 pr-2 min-w-0">
          <button
            onClick={() => rest.onToggleFolder(folder.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={expanded ? t("common.collapse") : t("common.expand")}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <FolderIcon size={12} className="shrink-0 text-text-muted" />
          <button
            onClick={() => rest.onToggleFolder(folder.id)}
            className="min-w-0 flex-1 truncate text-left text-xs font-medium cursor-pointer"
            title={folder.name}
          >
            {folder.name}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void rest.onNewInFolder(folder.id);
            }}
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-accent group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.sidebar.newInFolder", {
              defaultValue: "New conversation here",
            })}
            title={t("chat.sidebar.newInFolder", {
              defaultValue: "New conversation here",
            })}
          >
            <FilePlus2 size={11} />
          </button>
          <button
            onClick={() => rest.onRequestRenameFolder(folder.id, folder.name)}
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.folders.rename")}
          >
            <Pencil size={10} />
          </button>
          <button
            onClick={() => rest.onRequestDeleteFolder(folder.id, folder.name)}
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-danger group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.folders.delete")}
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <SortableContext
            items={subConvIds}
            strategy={verticalListSortingStrategy}
          >
            {subConversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                depth={depth + 1}
                {...rest}
              />
            ))}
          </SortableContext>
          <SortableContext
            items={subFolderIds}
            strategy={verticalListSortingStrategy}
          >
            {subFolders.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                depth={depth + 1}
                childFolders={childFolders}
                folderConversations={folderConversations}
                {...rest}
              />
            ))}
          </SortableContext>
        </>
      )}
    </>
  );
});

interface ConversationRowProps extends ChatTreeProps {
  conversation: ChatConversation;
  depth: number;
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  depth,
  folders,
  activeId,
  activeDragId,
  overDragId,
  editingId,
  editTitle,
  onOpen,
  onStartEdit,
  onCancelEdit,
  onSaveTitle,
  onEditTitleChange,
  onDelete,
  onMove,
  t,
}: ConversationRowProps) {
  const isActive = conversation.id === activeId;
  const isEditing = editingId === conversation.id;
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const [showMove, setShowMove] = useState(false);
  // Conversations are sortable: they're both drag sources and drop
  // targets for sibling reordering. useSortable combines useDraggable
  // + useDroppable, registers the row in the surrounding
  // SortableContext, and gives back a transform that makes sibling
  // rows slide to create a gap at the insertion point — that gap is
  // the natural "where it lands" feedback; the explicit purple line
  // below is layered on top.
  const sortableId = `conv:${conversation.id}`;
  const sortable = useSortable({
    id: sortableId,
    disabled: isEditing,
  });
  // Aliased back to `draggable` so the rest of the function (which
  // previously used useDraggable) reads unchanged. useSortable's
  // surface is a superset.
  const draggable = sortable;

  // Drop-line indicator: purple 2px line at the top edge of this row
  // when the active drag is hovering over it. Suppressed when the
  // row is itself the drag source (you can't drop on yourself), and
  // suppressed for non-conversation drag sources (folder drags go
  // INTO folders, not between conversations).
  const showDropLine =
    !!activeDragId &&
    activeDragId !== sortableId &&
    overDragId === sortableId &&
    activeDragId.startsWith("conv:");

  // Build "Move to" entries: root (when the conversation isn't already
  // at root) plus every folder except the one this conversation
  // currently lives in. Inline rather than nested so the menu stays
  // single-level — context-menu UI doesn't support submenus today.
  const moveEntries = useMemo<ContextMenuEntry[]>(() => {
    const entries: ContextMenuEntry[] = [];
    if (conversation.folder_id !== null) {
      entries.push({
        id: "move-root",
        label: t("chat.folders.moveToRoot", { defaultValue: "Move to root" }),
        icon: FolderIcon,
        onClick: () => onMove(conversation.id, null),
      });
    }
    for (const f of folders) {
      if (f.id === conversation.folder_id) continue;
      entries.push({
        id: `move-${f.id}`,
        label: t("chat.folders.moveToFolder", {
          defaultValue: "Move to {{name}}",
          name: f.name,
        }),
        icon: FolderIcon,
        onClick: () => onMove(conversation.id, f.id),
      });
    }
    return entries;
  }, [conversation.folder_id, conversation.id, folders, onMove, t]);

  const ctxMenu = useContextMenu(() => {
    // Editing the title is a focused interaction — opening a context
    // menu mid-edit would steal focus from the inline input.
    if (isEditing) return [];
    const items: ContextMenuEntry[] = [];
    if (moveEntries.length > 0) {
      items.push(...moveEntries, { id: "div-move", divider: true });
    }
    items.push(
      {
        id: "rename",
        label: t("chat.rename"),
        icon: Pencil,
        onClick: () => onStartEdit(conversation.id, conversation.title),
      },
      {
        id: "delete",
        label: t("chat.delete"),
        icon: Trash2,
        onClick: () => onDelete(conversation.id),
        danger: true,
      },
    );
    return items;
  });

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        // useSortable's transform + transition produce the
        // "siblings slide to make room" feedback. Without applying
        // them here the rows stay stuck while dragging and the user
        // can't see where the drop will land.
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      {...(isEditing ? {} : draggable.attributes)}
      {...(isEditing ? {} : draggable.listeners)}
      {...ctxMenu}
      className={cn(
        "group relative flex items-stretch rounded-md transition-colors",
        !isEditing && "cursor-grab active:cursor-grabbing",
        draggable.isDragging && "opacity-40",
        // Active row gets a stronger fill + left accent bar so the
        // current conversation pops at a glance.
        isActive
          ? "bg-accent/20 text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      {/* Drop-line indicator. Sits flush against the top edge of the
          row so it reads as "the dragged item will land ABOVE here".
          Layered above the row content via z-10 so the accent stays
          visible even on the active (highlighted) row. */}
      {showDropLine && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 rounded-full bg-accent"
          aria-hidden="true"
        />
      )}
      <IndentGuides depth={depth} />
      <div className="flex flex-1 items-center gap-1.5 py-1.5 pr-2 min-w-0">
        {isEditing ? (
          <>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => onEditTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveTitle(conversation.id);
                if (e.key === "Escape") onCancelEdit();
              }}
              className="flex-1 min-w-0 rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent"
            />
            <button
              onClick={() => onSaveTitle(conversation.id)}
              className="rounded p-1 text-success hover:bg-glass-hover cursor-pointer"
            >
              <Check size={12} />
            </button>
            <button
              onClick={onCancelEdit}
              className="rounded p-1 text-text-muted hover:bg-glass-hover cursor-pointer"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            <span className="w-5 shrink-0" aria-hidden="true" />
            {/* The title claims the FULL row width and only truncates
                against the row edge — the action icons no longer
                reserve layout space, so short titles read in full and
                long ones use every available pixel. The icons live in
                an absolutely-positioned overlay (below) that fades in
                on hover/focus, sliding over the title's tail. */}
            <button
              onClick={() => onOpen(conversation.id)}
              className="flex-1 min-w-0 truncate text-left text-xs cursor-pointer"
            >
              {conversation.title || t("chat.untitled")}
            </button>
          </>
        )}
      </div>

      {/* Hover/focus action overlay. Pinned to the right edge and
          absolutely positioned so it takes no layout space — that's
          what lets the title above fill the whole row until the user
          actually reaches for an action. A solid chip behind the icons
          cleanly covers the title's tail (no gradient fade).
          `group-focus-within` keeps it keyboard-reachable. */}
      {!isEditing && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] flex items-center gap-0.5 rounded-r-md bg-bg-secondary pl-2 pr-1.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <button
            ref={moveBtnRef}
            onClick={() => setShowMove((v) => !v)}
            className="rounded p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.folders.moveTo")}
            title={t("chat.folders.moveTo")}
          >
            <FolderInput size={10} />
          </button>
          <FloatingMenu
            open={showMove}
            anchorRef={moveBtnRef}
            onClose={() => setShowMove(false)}
            className="w-48"
          >
            <button
              onClick={() => {
                onMove(conversation.id, null);
                setShowMove(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderIcon size={12} className="text-text-muted" />
              {t("chat.folders.root")}
            </button>
            {folders.length > 0 && (
              <div className="my-0.5 h-px bg-glass-border" />
            )}
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  onMove(conversation.id, f.id);
                  setShowMove(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <FolderIcon size={12} className="text-text-muted" />
                {f.name}
              </button>
            ))}
          </FloatingMenu>
          <button
            onClick={() => onStartEdit(conversation.id, conversation.title)}
            className="rounded p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            aria-label={t("chat.rename")}
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={() => onDelete(conversation.id)}
            className="rounded p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer"
            aria-label={t("chat.delete")}
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
});

// Slim drop strip pinned to the top of the conversation list. Drop
// a conversation or folder onto it to send it back to the root
// (folder_id / parent_id = null). Only visually announces itself
// when there's an active drag — invisible the rest of the time so
// it doesn't take up sidebar space when no one's reaching for it.
//
// Uses id="root-pin" rather than "root" because the outer ChatTree
// wrapper now claims "root" as a catchall droppable. handleDragEnd
// treats both ids the same way.
export function RootDropZone({ label }: { label: string }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: "root-pin" });
  const dragging = !!active;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-all",
        dragging
          ? "mb-1.5 flex items-center justify-center rounded-md border border-dashed py-1.5 text-2xs"
          : "h-0 overflow-hidden",
        isOver
          ? "border-accent bg-accent/15 text-accent"
          : "border-glass-border text-text-muted",
      )}
    >
      {dragging && label}
    </div>
  );
}
