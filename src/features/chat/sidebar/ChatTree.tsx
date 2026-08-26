/**
 * Sidebar folder tree for /chat (and the flat "quick" list). Data-only
 * props; every callback and the inline-edit state come from
 * `useChatSidebar()` (see ChatSidebarContext.tsx).
 */
import { memo, useMemo } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderInput,
  FolderPlus,
  Library,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconButton, fieldSmClass } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { openMenuAtButton } from "../menu-anchor";
import { cn } from "@/lib/cn";
import type { ChatConversation, ChatFolder } from "@/types/chat";
import {
  captionClass,
  dateGroupLabel,
  folderNameById,
  groupConversationsByDate,
  quickChatsParentById,
} from "./conversation-groups";
import type { ChatSidebarView } from "./useChatSidebarView";
import { useChatSidebar } from "./ChatSidebarContext";

/** Indent per nesting step, in px. */
const INDENT_PX = 12;

export interface ChatTreeProps {
  folders: ChatFolder[];
  conversations: ChatConversation[];
  activeId: string | null;
  /** dnd-kit `active.id` for the in-flight drag. */
  activeDragId?: string | null;
  /** dnd-kit `over.id`. Rows matching it draw the insert line. */
  overDragId?: string | null;
  /** Collapsed folder ids (absence = expanded). */
  collapsedFolders: Set<string>;
  /** Drill-in root: when set, the tree renders this folder AS the root so
   *  the user can focus on one topic. null = the general (all) view. */
  rootFolderId?: string | null;
  /** "folders" = tree (default); "quick" = flat newest-first list with date
   *  captions only. Drag-and-drop is off in the quick view. */
  view?: ChatSidebarView;
}

/**
 * Sidebar tree. Folders come first as collapsible captions (nested folders
 * and their chats indented underneath), then the loose chats grouped by
 * date (Today / This week / Earlier). Drag-and-drop keeps working across
 * both halves: drop a chat on a folder caption to nest it, on the root
 * strip to move it back out.
 */
export function ChatTree(props: ChatTreeProps) {
  const { folders, conversations } = props;
  const { t } = useChatSidebar();
  const view = props.view ?? "folders";
  const quickView = view === "quick";
  // whole tree is a root droppable so drops between rows land at root. collision
  // detection prefers the smallest match, so nested rows still win.
  const rootDroppable = useDroppable({ id: "root", disabled: quickView });
  // The auto-created "Quick chats" folder(s) are never drawn: their chats
  // count as loose chats of the parent they sit under.
  const quickParents = useMemo(
    () => quickChatsParentById(folders, t),
    [folders, t],
  );
  // index by parent_id, rendered recursively from parent_id === null
  const childFolders = useMemo(() => {
    const m = new Map<string | null, typeof folders>();
    for (const f of folders) {
      if (quickParents.has(f.id)) continue;
      const arr = m.get(f.parent_id) ?? [];
      arr.push(f);
      m.set(f.parent_id, arr);
    }
    return m;
  }, [folders, quickParents]);
  const folderConversations = useMemo(() => {
    const m = new Map<string | null, typeof conversations>();
    for (const c of conversations) {
      const key =
        c.folder_id !== null && quickParents.has(c.folder_id)
          ? (quickParents.get(c.folder_id) ?? null)
          : c.folder_id;
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return m;
  }, [conversations, quickParents]);

  const rootFolderId = props.rootFolderId ?? null;
  const looseConvs = useMemo(
    () => folderConversations.get(rootFolderId) ?? [],
    [folderConversations, rootFolderId],
  );
  const dateGroups = useMemo(
    () => groupConversationsByDate(looseConvs),
    [looseConvs],
  );
  const rootFolders = childFolders.get(rootFolderId) ?? [];
  const rootFolderIds = rootFolders.map((f) => `folder:${f.id}`);
  const looseConvIds = looseConvs.map((c) => `conv:${c.id}`);

  // quick view: every conversation, newest first, date captions only; the
  // folder name (if any) rides along as a subtitle
  const folderNames = useMemo(() => folderNameById(folders, t), [folders, t]);
  const flatGroups = useMemo(
    () => (quickView ? groupConversationsByDate(conversations) : []),
    [quickView, conversations],
  );

  if (quickView) {
    return (
      <div className="flex flex-col gap-0.5">
        {flatGroups.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            <div className={cn("px-3 pb-1 pt-3", captionClass)}>
              {dateGroupLabel(group.key, t)}
            </div>
            {group.items.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                depth={0}
                subtitle={
                  c.folder_id !== null
                    ? (folderNames.get(c.folder_id) ?? null)
                    : null
                }
                dndDisabled
                {...props}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={rootDroppable.setNodeRef}
      className={cn(
        "flex flex-col gap-0.5 rounded-control transition-colors",
        // faint tone hint when a drop will land at root
        rootDroppable.isOver && "bg-bg-tertiary/40",
      )}
    >
      {/* folders first, as collapsible captions */}
      {rootFolders.length > 0 && (
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
      )}

      {/* loose chats at the bottom under one caption, then grouped by date */}
      {looseConvs.length > 0 && (
        <div
          className={cn(
            "flex items-center gap-1.5 px-3 pb-0.5 pt-3",
            captionClass,
          )}
        >
          <Zap size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">{t("chat.sidebar.looseChats")}</span>
          <span className="shrink-0 font-normal tabular-nums">
            {looseConvs.length}
          </span>
        </div>
      )}
      <SortableContext items={looseConvIds} strategy={verticalListSortingStrategy}>
        {dateGroups.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            <div className={cn("px-3 pb-1 pt-2", captionClass, "font-normal")}>
              {dateGroupLabel(group.key, t)}
            </div>
            {group.items.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                depth={0}
                {...props}
              />
            ))}
          </div>
        ))}
      </SortableContext>
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
  const sidebar = useChatSidebar();
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
  const t = sidebar.t;
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
  const showDropLine =
    isOver && isActiveSibling && activeDragId !== `folder:${folder.id}`;
  // nest highlight for conv drags and non-sibling folder drags, not while dragging self
  const showNestHighlight = isOver && !draggable.isDragging && !isActiveSibling;

  // one item list for both the right-click menu and the hover kebab
  const menuItems = (): ContextMenuEntry[] => [
    ...(sidebar.onEnterFolder
      ? [
          {
            id: "enter",
            label: t("chat.folders.enter", { defaultValue: "Enter folder" }),
            icon: FolderInput,
            onClick: () => sidebar.onEnterFolder?.(folder.id),
          },
          { id: "div-enter", divider: true } as const,
        ]
      : []),
    {
      id: "new",
      label: t("chat.sidebar.newInFolder", {
        defaultValue: "New conversation here",
      }),
      icon: FilePlus2,
      onClick: () => sidebar.onNewInFolder(folder.id),
    },
    {
      id: "new-subfolder",
      label: t("chat.folders.newSubfolder"),
      icon: FolderPlus,
      onClick: () => sidebar.onNewSubfolder(folder.id),
    },
    {
      id: "open-in-library",
      label: t("chat.folders.openInLibrary"),
      icon: Library,
      onClick: () => sidebar.onOpenFolderInLibrary(folder.id),
    },
    { id: "div-1", divider: true } as const,
    {
      id: "rename",
      label: t("chat.folders.rename"),
      icon: Pencil,
      onClick: () => sidebar.onRequestRenameFolder(folder.id, folder.name),
    },
    {
      id: "delete",
      label: t("chat.folders.delete"),
      icon: Trash2,
      onClick: () => sidebar.onRequestDeleteFolder(folder.id, folder.name),
      danger: true,
    },
  ];
  const ctxMenu = useContextMenu(menuItems);
  const count = subConversations.length + subFolders.length;

  return (
    <>
      <div
        ref={sortable.setNodeRef}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
          paddingLeft: depth * INDENT_PX,
        }}
        {...draggable.attributes}
        {...draggable.listeners}
        {...ctxMenu}
        className={cn(
          "group relative flex items-center rounded-control transition-colors cursor-grab active:cursor-grabbing",
          showNestHighlight ? "bg-surface-3" : "hover:bg-bg-tertiary/60",
          draggable.isDragging && "opacity-40",
        )}
      >
        {/* Sibling-reorder drop line, mutually exclusive with showNestHighlight. */}
        {showDropLine && (
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 rounded-full bg-text-primary/60"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          onClick={() => sidebar.onToggleFolder(folder.id)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left cursor-pointer",
            captionClass,
            "hover:text-text-secondary",
          )}
          title={folder.name}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronRight size={12} className="shrink-0" />
          )}
          <span className="truncate">{folder.name}</span>
          {count > 0 && (
            <span className="shrink-0 font-normal tabular-nums">{count}</span>
          )}
        </button>
        <IconButton
          size="sm"
          onClick={(e) => openMenuAtButton(e, menuItems())}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={t("chat.folders.actions")}
          title={t("chat.folders.actions")}
          className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </IconButton>
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
  /** 11 px muted line under the title (quick view: the folder name). */
  subtitle?: string | null;
  /** Quick view: no drag source, no drop target. */
  dndDisabled?: boolean;
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  depth,
  subtitle = null,
  dndDisabled = false,
  activeId,
  activeDragId,
  overDragId,
}: ConversationRowProps) {
  const {
    editingId,
    editTitle,
    onOpen,
    onStartEdit,
    onCancelEdit,
    onSaveTitle,
    onEditTitleChange,
    onDelete,
    onRequestMove,
    t,
  } = useChatSidebar();
  const isActive = conversation.id === activeId;
  const isEditing = editingId === conversation.id;
  // sortable: drag source + drop target for sibling reordering
  const sortableId = `conv:${conversation.id}`;
  const sortable = useSortable({
    id: sortableId,
    disabled: isEditing || dndDisabled,
  });
  const draggable = sortable;

  // top-edge drop line while hovered, not on self, conv drags only (folders nest instead)
  const showDropLine =
    !!activeDragId &&
    activeDragId !== sortableId &&
    overDragId === sortableId &&
    activeDragId.startsWith("conv:");

  const menuItems = (): ContextMenuEntry[] => {
    // a context menu mid-edit would steal focus from the inline input
    if (isEditing) return [];
    const items: ContextMenuEntry[] = [
      {
        id: "rename",
        label: t("chat.rename"),
        icon: Pencil,
        onClick: () => onStartEdit(conversation.id, conversation.title),
      },
      {
        id: "move",
        label: t("chat.folders.moveTo", { defaultValue: "Move to folder…" }),
        icon: FolderInput,
        onClick: () => onRequestMove(conversation.id, conversation.folder_id),
      },
    ];
    items.push(
      { id: "div-delete", divider: true },
      {
        id: "delete",
        label: t("chat.delete"),
        icon: Trash2,
        onClick: () => onDelete(conversation.id),
        danger: true,
      },
    );
    return items;
  };
  const ctxMenu = useContextMenu(menuItems);

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        // apply the sortable transform so siblings slide to make room
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        paddingLeft: depth * INDENT_PX,
      }}
      {...(isEditing || dndDisabled ? {} : draggable.attributes)}
      {...(isEditing || dndDisabled ? {} : draggable.listeners)}
      {...ctxMenu}
      className={cn(
        "group relative flex items-center rounded-control transition-colors",
        !isEditing && !dndDisabled && "cursor-grab active:cursor-grabbing",
        draggable.isDragging && "opacity-40",
        // active row = surface-2, the rest hover one tone step up
        isActive
          ? "bg-bg-tertiary text-text-primary"
          : "text-text-secondary hover:bg-bg-tertiary/60",
      )}
    >
      {/* drop line at the top edge = "will land above here". */}
      {showDropLine && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 rounded-full bg-text-primary/60"
          aria-hidden="true"
        />
      )}
      {isEditing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1">
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveTitle(conversation.id);
              if (e.key === "Escape") onCancelEdit();
            }}
            aria-label={t("chat.rename")}
            className={cn(fieldSmClass, "min-w-0 flex-1")}
          />
          <IconButton
            size="sm"
            onClick={() => onSaveTitle(conversation.id)}
            aria-label={t("common.save")}
            className="text-success"
          >
            <Check size={16} strokeWidth={1.5} />
          </IconButton>
          <IconButton
            size="sm"
            onClick={onCancelEdit}
            aria-label={t("common.cancel")}
          >
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onOpen(conversation.id)}
            className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-[9px] text-left cursor-pointer"
            title={conversation.title || t("chat.untitled")}
          >
            <span className="w-full truncate text-[13px] leading-4">
              {conversation.title || t("chat.untitled")}
            </span>
            {(subtitle || conversation.source_doc_title) && (
              <span className="w-full truncate text-2xs leading-[14px] text-text-muted">
                {subtitle || conversation.source_doc_title}
              </span>
            )}
          </button>
          <IconButton
            size="sm"
            onClick={(e) => openMenuAtButton(e, menuItems())}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={t("chat.rowActions")}
            title={t("chat.rowActions")}
            // width-collapse, not display:none: stays in the a11y tree
            // (keyboard focus + tests), the title gets the full row width
            // until hover
            className="mr-1 w-0! overflow-hidden opacity-0 group-hover:w-7! group-hover:opacity-100 focus-visible:w-7! focus-visible:opacity-100"
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </IconButton>
        </>
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
          ? "mb-1.5 flex items-center justify-center rounded-control py-1.5 text-2xs"
          : "h-0 overflow-hidden",
        isOver
          ? "bg-surface-3 text-text-primary"
          : "bg-bg-tertiary text-text-muted",
      )}
    >
      {dragging && label}
    </div>
  );
}
