import { memo, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Library,
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

// root-level chats shown in Quick chats before the "show more" toggle
const QUICK_CHATS_VISIBLE_LIMIT = 8;

export interface ChatTreeProps {
  folders: ChatFolder[];
  conversations: ChatConversation[];
  activeId: string | null;
  /** dnd-kit `active.id` for the in-flight drag. */
  activeDragId?: string | null;
  /** dnd-kit `over.id`. Rows matching it draw the insert line. */
  overDragId?: string | null;
  editingId: string | null;
  editTitle: string;
  /** Collapsed folder ids (absence = expanded). */
  collapsedFolders: Set<string>;
  onToggleFolder: (id: string) => void;
  /** New conversation directly inside this folder. */
  onNewInFolder: (folderId: string) => void;
  /** New folder nested under this one. */
  onNewSubfolder: (parentFolderId: string) => void;
  /** Chat folders share the library `folders` table, so the id maps over. */
  onOpenFolderInLibrary: (folderId: string) => void;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onSaveTitle: (id: string) => void;
  onEditTitleChange: (s: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  /** Drill-in root: when set, the tree renders this folder AS the root so
   *  the user can focus on one topic. null = the general (all) view. */
  rootFolderId?: string | null;
  /** Right-click "Enter folder" → drill into it (ChatPage owns the state). */
  onEnterFolder?: (id: string) => void;
  /** Confirm modal lives in ChatPage; rows just pass (id, name). */
  onRequestRenameFolder: (id: string, currentName: string) => void;
  onRequestDeleteFolder: (id: string, currentName: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Per-depth left indent (8px gutter + 12px/step) with a border per step for the guide line. */
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
  // whole tree is a root droppable so drops between rows land at root. collision
  // detection prefers the smallest match, so nested rows still win.
  const rootDroppable = useDroppable({ id: "root" });
  // index by parent_id, rendered recursively from parent_id === null
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

  const rootFolderId = props.rootFolderId ?? null;
  const isDrilled = rootFolderId !== null;
  // convs directly in the (drilled) root folder, loose root chats in the
  // general view, "promoted" chats of the folder in a drilled view
  const rootConvs = folderConversations.get(rootFolderId) ?? [];
  // The real "Quick chats" folder (auto-created by chat-store) keeps the
  // special accent group UI below instead of rendering as a plain folder, so
  // quick chats stay visually distinct while still living in a real library
  // folder. Its conversations (+ any still-loose ones) fill the group, and the
  // folder is filtered out of the plain folder tree.
  const quickChatsName = t("chat.sidebar.quickChats", {
    defaultValue: "Quick chats",
  })
    .trim()
    .toLowerCase();
  const quickChatsFolder = folders.find(
    (f) =>
      f.parent_id === rootFolderId &&
      f.name.trim().toLowerCase() === quickChatsName,
  );
  const quickChatsConvs = [
    ...(quickChatsFolder
      ? folderConversations.get(quickChatsFolder.id) ?? []
      : []),
    // general view: loose root chats live in Quick chats. Drilled view: the
    // folder's direct chats are "promoted", shown separately below instead.
    ...(isDrilled ? [] : rootConvs),
  ];
  const promotedConvs = isDrilled ? rootConvs : [];
  const otherRootFolders = (childFolders.get(rootFolderId) ?? []).filter(
    (f) => f.id !== quickChatsFolder?.id,
  );
  // Synthetic folder id for the Quick chats section in collapsedFolders.
  const QUICK_CHATS_KEY = "__quick_chats__";
  const quickChatsCollapsed = props.collapsedFolders.has(QUICK_CHATS_KEY);
  const [quickChatsShowAll, setQuickChatsShowAll] = useState(false);
  const visibleRootConvs = quickChatsShowAll
    ? quickChatsConvs
    : quickChatsConvs.slice(0, QUICK_CHATS_VISIBLE_LIMIT);
  const hiddenRootCount = quickChatsConvs.length - visibleRootConvs.length;
  // Sortable ids for the Quick chats SortableContext (small list, no memo).
  const rootConvIds = quickChatsConvs.map((c) => `conv:${c.id}`);

  return (
    <div
      ref={rootDroppable.setNodeRef}
      className={cn(
        "flex flex-col gap-0.5 transition-colors rounded-md",
        // faint outline hint when a drop will land at root
        rootDroppable.isOver && "ring-1 ring-accent/30",
      )}
    >
      {/* Quick chats: the accent-highlighted group at the top. Renders the real
          "Quick chats" folder's conversations (+ any still-loose ones) with a
          distinct look; the folder itself is filtered out of the plain tree. */}
      {quickChatsConvs.length > 0 && (
      <div className="rounded-md bg-accent/[0.06]">
        <div className="group flex items-stretch">
          <IndentGuides depth={0} />
          <div className="flex flex-1 items-center gap-1.5 py-2 pr-2 min-w-0">
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
              className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-accent/90 cursor-pointer"
            >
              {t("chat.sidebar.quickChats", { defaultValue: "Quick chats" })}
              {quickChatsConvs.length > 0 && (
                <span className="ml-1.5 text-2xs font-normal text-accent/60">
                  {quickChatsConvs.length}
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
              quickChatsConvs.length > QUICK_CHATS_VISIBLE_LIMIT && (
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
      )}

      {/* Drilled view: the folder's own "promoted" chats, shown as a flat
          list above its subfolders. */}
      {promotedConvs.length > 0 && (
        <SortableContext
          items={promotedConvs.map((c) => `conv:${c.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {promotedConvs.map((c) => (
            <ConversationRow key={c.id} conversation={c} depth={0} {...props} />
          ))}
        </SortableContext>
      )}

      {/* Separator, only when there's at least one (non-Quick-chats) folder. */}
      {otherRootFolders.length > 0 && (
        <div className="my-1 h-px bg-glass-border" />
      )}

      {(() => {
        const rootFolders = otherRootFolders;
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

// memo so the tree doesn't re-render on every composer keystroke
const FolderRow = memo(function FolderRow({
  folder,
  depth,
  childFolders,
  folderConversations,
  ...rest
}: FolderRowProps) {
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
  // drag source + drop target on one node. drag-end reads parent:
  // same-parent = reorder, different-parent = nest.
  const sortable = useSortable({ id: `folder:${folder.id}` });
  const draggable = sortable;

  // a row can mean two things at once (reorder vs nest-into), pick one indicator
  const activeDragId = rest.activeDragId ?? null;
  const overDragId = rest.overDragId ?? null;
  const isOver = overDragId === `folder:${folder.id}`;
  // is the active drag a sibling folder?
  const activeFolderParentId = useMemo(() => {
    if (!activeDragId?.startsWith("folder:")) return undefined;
    const id = activeDragId.slice("folder:".length);
    return rest.folders.find((f) => f.id === id)?.parent_id;
  }, [activeDragId, rest.folders]);
  const isActiveSibling =
    activeFolderParentId !== undefined &&
    activeFolderParentId === folder.parent_id;
  const showDropLine = isOver && isActiveSibling && activeDragId !== `folder:${folder.id}`;
  // nest highlight for conv drags and non-sibling folder drags, not while dragging self
  const showNestHighlight =
    isOver &&
    !sortable.isDragging &&
    !isActiveSibling;
  // right-click / long-press menu for touch + trackpad
  const ctxMenu = useContextMenu(() => [
    ...(rest.onEnterFolder
      ? [
          {
            id: "enter",
            label: rest.t("chat.folders.enter", {
              defaultValue: "Enter folder",
            }),
            icon: FolderInput,
            onClick: () => rest.onEnterFolder?.(folder.id),
          },
          { id: "div-enter", divider: true } as const,
        ]
      : []),
    {
      id: "new",
      label: rest.t("chat.sidebar.newInFolder", {
        defaultValue: "New conversation here",
      }),
      icon: FilePlus2,
      onClick: () => rest.onNewInFolder(folder.id),
    },
    {
      id: "new-subfolder",
      label: rest.t("chat.folders.newSubfolder"),
      icon: FolderPlus,
      onClick: () => rest.onNewSubfolder(folder.id),
    },
    {
      id: "open-in-library",
      label: rest.t("chat.folders.openInLibrary"),
      icon: Library,
      onClick: () => rest.onOpenFolderInLibrary(folder.id),
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
        {/* Sibling-reorder drop line, mutually exclusive with showNestHighlight. */}
        {showDropLine && (
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 rounded-full bg-accent"
            aria-hidden="true"
          />
        )}
        <IndentGuides depth={depth} />
        <div className="flex flex-1 items-center gap-1.5 py-2 pr-2 min-w-0">
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
            className="min-w-0 flex-1 truncate text-left text-sm font-medium cursor-pointer"
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
            onClick={(e) => {
              e.stopPropagation();
              rest.onNewSubfolder(folder.id);
            }}
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-accent group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.folders.newSubfolder")}
            title={t("chat.folders.newSubfolder")}
          >
            <FolderPlus size={11} />
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
  // sortable: drag source + drop target for sibling reordering
  const sortableId = `conv:${conversation.id}`;
  const sortable = useSortable({
    id: sortableId,
    disabled: isEditing,
  });
  const draggable = sortable;

  // top-edge drop line while hovered, not on self, conv drags only (folders nest instead)
  const showDropLine =
    !!activeDragId &&
    activeDragId !== sortableId &&
    overDragId === sortableId &&
    activeDragId.startsWith("conv:");

  // "Move to" entries: root (unless already there) plus every other folder
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
    // a context menu mid-edit would steal focus from the inline input
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
        // apply the sortable transform so siblings slide to make room
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
        // active row: stronger fill + left accent bar
        isActive
          ? "bg-accent/20 text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      {/* drop line at the top edge = "will land above here". z-10 so it stays
          visible over the active row's highlight. */}
      {showDropLine && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 rounded-full bg-accent"
          aria-hidden="true"
        />
      )}
      <IndentGuides depth={depth} />
      <div className="flex flex-1 items-center gap-1.5 py-2 pr-2 min-w-0">
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
              className="flex-1 min-w-0 rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-sm text-text-primary outline-none focus:border-accent"
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
            {/* title claims the full row width; action icons are an absolute
                overlay (below) so they reserve no layout space. */}
            <button
              onClick={() => onOpen(conversation.id)}
              className="flex-1 min-w-0 truncate text-left text-sm font-medium cursor-pointer"
            >
              {conversation.title || t("chat.untitled")}
            </button>
          </>
        )}
      </div>

      {/* hover/focus action overlay, absolutely positioned so it takes no
          layout space. solid bg chip covers the title's tail. */}
      {!isEditing && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] flex items-center gap-0.5 rounded-r-md bg-gradient-to-l from-bg-secondary via-bg-secondary/95 to-transparent pl-5 pr-1.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
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

// Slim drop strip at the top of the list: drop a conv/folder onto it to send it
// back to root (folder_id / parent_id = null). Only visible during an active drag.
// id="root-pin" not "root" (the ChatTree wrapper owns "root"); drag-end treats both alike.
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
