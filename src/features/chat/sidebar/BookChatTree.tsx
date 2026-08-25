import { memo, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder as FolderIcon,
  FolderInput,
  GitBranch,
  Library,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { IconButton, fieldSmClass } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { cn } from "@/lib/cn";
import type { ChatConversation, ChatFolder } from "@/types/chat";
import {
  captionClass,
  dateGroupLabel,
  groupConversationsByDate,
} from "./conversation-groups";
import { openMenuAtButton } from "../menu-anchor";

/**
 * Sidebar tree for the book-scoped chat page. Unlike the main /chat tree
 * (drag-and-drop folders), this one's primary structure is the *fork
 * lineage*: a conversation that was branched into A/B forks renders as an
 * expandable parent with its children nested underneath, "the main
 * conversation is a folder, A and B are its children". Explicit library
 * folders still group root conversations as captions on top of that, and
 * the loose roots are grouped by date. No DnD here, the global /chat page
 * owns reordering; this view is about the book's threads.
 */
export interface BookChatTreeProps {
  /** Already filtered to the book's conversations (source_doc_id === docId). */
  conversations: ChatConversation[];
  folders: ChatFolder[];
  activeId: string | null;
  editingId: string | null;
  editTitle: string;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onSaveTitle: (id: string) => void;
  onEditTitleChange: (s: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onNewInFolder: (folderId: string) => void;
  onRequestRenameFolder: (id: string, currentName: string) => void;
  onRequestDeleteFolder: (id: string, currentName: string) => void;
  onOpenFolderInLibrary: (folderId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

const INDENT_PX = 12;

export function BookChatTree(props: BookChatTreeProps) {
  const { conversations, folders, t } = props;

  // Fork lineage: index children by parent conversation. A parent only counts
  // if it's also one of THIS book's conversations, otherwise the child is a
  // root here (its real parent lives in another book / was deleted).
  const bookIds = useMemo(
    () => new Set(conversations.map((c) => c.id)),
    [conversations],
  );
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, ChatConversation[]>();
    for (const c of conversations) {
      const parent =
        c.parent_conversation_id && bookIds.has(c.parent_conversation_id)
          ? c.parent_conversation_id
          : null;
      const arr = m.get(parent) ?? [];
      arr.push(c);
      m.set(parent, arr);
    }
    return m;
  }, [conversations, bookIds]);

  // The auto-created "Quick chats" folder is treated as "loose" here: book
  // chats created loose land in it, but on a book page we don't want a
  // "Quick chats" wrapper, those threads are the book's main threads.
  const quickChatsName = t("chat.sidebar.quickChats", {
    defaultValue: "Quick chats",
  })
    .trim()
    .toLowerCase();
  const quickChatsFolderId = useMemo(
    () =>
      folders.find(
        (f) =>
          f.parent_id === null &&
          f.name.trim().toLowerCase() === quickChatsName,
      )?.id ?? null,
    [folders, quickChatsName],
  );

  const roots = childrenByParent.get(null) ?? [];
  const isLoose = (c: ChatConversation) =>
    c.folder_id === null || c.folder_id === quickChatsFolderId;

  // Bucket root conversations: one section per explicit (non-Quick-chats)
  // folder that actually holds a root, then the loose ones by date.
  const looseRoots = roots.filter(isLoose);
  const looseGroups = useMemo(
    () => groupConversationsByDate(looseRoots),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, quickChatsFolderId],
  );
  const folderBuckets = useMemo(() => {
    const m = new Map<string, ChatConversation[]>();
    for (const r of roots) {
      if (isLoose(r) || !r.folder_id) continue;
      const arr = m.get(r.folder_id) ?? [];
      arr.push(r);
      m.set(r.folder_id, arr);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, quickChatsFolderId]);
  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders],
  );

  // Lineage-node collapse (which forked parents are folded); folders too.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderForest = (list: ChatConversation[], depth: number) =>
    list.map((c) => {
      const children = childrenByParent.get(c.id) ?? [];
      const expanded = !collapsed.has(c.id);
      return (
        <div key={c.id}>
          <BookConvRow
            conversation={c}
            depth={depth}
            childCount={children.length}
            expanded={expanded}
            onToggleExpand={() => toggle(c.id)}
            {...props}
          />
          {children.length > 0 && expanded && renderForest(children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="flex flex-col gap-0.5">
      {roots.length === 0 && (
        <p className="px-3 py-4 text-center text-xs text-text-muted">
          {t("chat.sidebar.empty")}
        </p>
      )}

      {[...folderBuckets.entries()].map(([folderId, bucketRoots]) => {
        const folder = folderById.get(folderId);
        if (!folder) return null;
        const open = !collapsed.has(`folder:${folderId}`);
        return (
          <div key={folderId}>
            <BookFolderHeader
              folder={folder}
              expanded={open}
              onToggle={() => toggle(`folder:${folderId}`)}
              onNewInFolder={props.onNewInFolder}
              onOpenInLibrary={props.onOpenFolderInLibrary}
              onRename={props.onRequestRenameFolder}
              onDelete={props.onRequestDeleteFolder}
              t={t}
            />
            {open && renderForest(bucketRoots, 1)}
          </div>
        );
      })}

      {looseGroups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          <div className={cn("px-3 pb-1 pt-3", captionClass)}>
            {dateGroupLabel(group.key, t)}
          </div>
          {renderForest(group.items, 0)}
        </div>
      ))}
    </div>
  );
}

function BookFolderHeader({
  folder,
  expanded,
  onToggle,
  onNewInFolder,
  onOpenInLibrary,
  onRename,
  onDelete,
  t,
}: {
  folder: ChatFolder;
  expanded: boolean;
  onToggle: () => void;
  onNewInFolder: (id: string) => void;
  onOpenInLibrary: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  t: BookChatTreeProps["t"];
}) {
  const menuItems = (): ContextMenuEntry[] => [
    {
      id: "new",
      label: t("chat.sidebar.newInFolder", {
        defaultValue: "New conversation here",
      }),
      icon: FilePlus2,
      onClick: () => onNewInFolder(folder.id),
    },
    {
      id: "open-in-library",
      label: t("chat.folders.openInLibrary"),
      icon: Library,
      onClick: () => onOpenInLibrary(folder.id),
    },
    { id: "div-1", divider: true } as const,
    {
      id: "rename",
      label: t("chat.folders.rename"),
      icon: Pencil,
      onClick: () => onRename(folder.id, folder.name),
    },
    {
      id: "delete",
      label: t("chat.folders.delete"),
      icon: Trash2,
      danger: true,
      onClick: () => onDelete(folder.id, folder.name),
    },
  ];
  const ctxMenu = useContextMenu(menuItems);
  return (
    <div
      {...ctxMenu}
      className="group flex items-center rounded-control transition-colors hover:bg-bg-tertiary/60"
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2 text-left cursor-pointer hover:text-text-secondary",
          captionClass,
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
      </button>
      <IconButton
        size="sm"
        onClick={(e) => openMenuAtButton(e, menuItems())}
        aria-label={t("chat.folders.actions")}
        title={t("chat.folders.actions")}
        className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

interface BookConvRowProps extends BookChatTreeProps {
  conversation: ChatConversation;
  depth: number;
  childCount: number;
  expanded: boolean;
  onToggleExpand: () => void;
}

const BookConvRow = memo(function BookConvRow({
  conversation,
  depth,
  childCount,
  expanded,
  onToggleExpand,
  folders,
  activeId,
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
}: BookConvRowProps) {
  const isActive = conversation.id === activeId;
  const isEditing = editingId === conversation.id;
  const hasChildren = childCount > 0;

  const menuItems = (): ContextMenuEntry[] => {
    if (isEditing) return [];
    const items: ContextMenuEntry[] = [
      {
        id: "rename",
        label: t("chat.rename"),
        icon: Pencil,
        onClick: () => onStartEdit(conversation.id, conversation.title),
      },
    ];
    const moves: ContextMenuEntry[] = [];
    if (conversation.folder_id !== null) {
      moves.push({
        id: "move-root",
        label: t("chat.folders.moveToRoot", { defaultValue: "Move to root" }),
        icon: FolderIcon,
        onClick: () => onMove(conversation.id, null),
      });
    }
    for (const f of folders) {
      if (f.id === conversation.folder_id) continue;
      moves.push({
        id: `move-${f.id}`,
        label: t("chat.folders.moveToFolder", {
          defaultValue: "Move to {{name}}",
          name: f.name,
        }),
        icon: FolderInput,
        onClick: () => onMove(conversation.id, f.id),
      });
    }
    if (moves.length > 0) items.push({ id: "div-move", divider: true }, ...moves);
    items.push(
      { id: "div-delete", divider: true },
      {
        id: "delete",
        label: t("chat.delete"),
        icon: Trash2,
        danger: true,
        onClick: () => onDelete(conversation.id),
      },
    );
    return items;
  };
  const ctxMenu = useContextMenu(menuItems);

  return (
    <div
      {...(isEditing ? {} : ctxMenu)}
      style={{ paddingLeft: depth * INDENT_PX }}
      className={cn(
        "group relative flex items-center rounded-control transition-colors",
        isActive
          ? "bg-bg-tertiary text-text-primary"
          : "text-text-secondary hover:bg-bg-tertiary/60",
      )}
    >
      {/* fork toggle when this conversation has branched children */}
      {hasChildren && (
        <IconButton
          size="sm"
          onClick={onToggleExpand}
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
          className="ml-1 -mr-1"
        >
          {expanded ? (
            <ChevronDown size={16} strokeWidth={1.5} />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} />
          )}
        </IconButton>
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
            <span className="flex w-full items-center gap-1.5">
              <span className="min-w-0 truncate text-[13px] leading-4">
                {conversation.title || t("chat.untitled")}
              </span>
              {hasChildren && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 text-2xs tabular-nums text-text-muted"
                  title={t("chat.book.forkCount", {
                    defaultValue: "{{count}} branch",
                    count: childCount,
                  })}
                >
                  <GitBranch size={11} strokeWidth={1.5} />
                  {childCount}
                </span>
              )}
            </span>
            {conversation.source_doc_title && (
              <span className="w-full truncate text-2xs leading-[14px] text-text-muted">
                {conversation.source_doc_title}
              </span>
            )}
          </button>
          <IconButton
            size="sm"
            onClick={(e) => openMenuAtButton(e, menuItems())}
            aria-label={t("chat.rowActions")}
            title={t("chat.rowActions")}
            className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </IconButton>
        </>
      )}
    </div>
  );
});
