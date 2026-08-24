import { memo, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Folder as FolderIcon,
  FolderInput,
  GitBranch,
  Library,
  MessagesSquare,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { FloatingMenu } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { cn } from "@/lib/cn";
import type { ChatConversation, ChatFolder } from "@/types/chat";

/**
 * Sidebar tree for the book-scoped chat page. Unlike the main /chat tree
 * (drag-and-drop folders), this one's primary structure is the *fork
 * lineage*: a conversation that was branched into A/B forks renders as an
 * expandable parent with its children nested underneath, "the main
 * conversation is a folder, A and B are its children". Explicit library
 * folders still group root conversations on top of that. No DnD here, the
 * global /chat page owns reordering; this view is about the book's threads.
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

  // Bucket root conversations: loose ones first, then one section per explicit
  // (non-Quick-chats) folder that actually holds a root.
  const looseRoots = roots.filter(isLoose);
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
        <p className="px-2 py-4 text-center text-xs text-text-muted">
          {t("chat.sidebar.empty")}
        </p>
      )}

      {renderForest(looseRoots, 0)}

      {[...folderBuckets.entries()].map(([folderId, bucketRoots]) => {
        const folder = folderById.get(folderId);
        if (!folder) return null;
        const open = !collapsed.has(`folder:${folderId}`);
        return (
          <div key={folderId} className="mt-1">
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
  const ctxMenu = useContextMenu(() => [
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
  ]);
  return (
    <div
      {...ctxMenu}
      className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
    >
      <button
        onClick={onToggle}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        aria-label={expanded ? t("common.collapse") : t("common.expand")}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      <FolderIcon size={12} className="shrink-0 text-text-muted" />
      <button
        onClick={onToggle}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium cursor-pointer"
        title={folder.name}
      >
        {folder.name}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onNewInFolder(folder.id);
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
  const moveBtnRef = useRef<HTMLButtonElement>(null);
  const [showMove, setShowMove] = useState(false);

  const ctxMenu = useContextMenu(() => {
    if (isEditing) return [];
    const items: ContextMenuEntry[] = [];
    if (conversation.folder_id !== null) {
      items.push({
        id: "move-root",
        label: t("chat.folders.moveToRoot", { defaultValue: "Move to root" }),
        icon: FolderIcon,
        onClick: () => onMove(conversation.id, null),
      });
    }
    for (const f of folders) {
      if (f.id === conversation.folder_id) continue;
      items.push({
        id: `move-${f.id}`,
        label: t("chat.folders.moveToFolder", {
          defaultValue: "Move to {{name}}",
          name: f.name,
        }),
        icon: FolderInput,
        onClick: () => onMove(conversation.id, f.id),
      });
    }
    if (items.length > 0) items.push({ id: "div-move", divider: true });
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
        danger: true,
        onClick: () => onDelete(conversation.id),
      },
    );
    return items;
  });

  return (
    <div
      {...(isEditing ? {} : ctxMenu)}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        "group relative flex items-center gap-1.5 rounded-md pr-1.5 transition-colors",
        isActive
          ? "bg-accent/20 text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      {/* fork toggle when this conversation has branched children, else spacer */}
      {hasChildren ? (
        <button
          onClick={onToggleExpand}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors cursor-pointer",
            isActive
              ? "text-accent/80 hover:text-accent"
              : "text-text-muted hover:text-text-primary",
          )}
          aria-label={expanded ? t("common.collapse") : t("common.expand")}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}
      {hasChildren ? (
        <GitBranch
          size={12}
          className={cn("shrink-0", isActive ? "text-accent/80" : "text-text-muted")}
        />
      ) : (
        <MessagesSquare
          size={12}
          className={cn("shrink-0", isActive ? "text-accent/80" : "text-text-muted")}
        />
      )}

      {isEditing ? (
        <div className="flex flex-1 items-center gap-1 py-1.5 min-w-0">
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
        </div>
      ) : (
        <>
          <button
            onClick={() => onOpen(conversation.id)}
            className="flex-1 min-w-0 truncate py-2 text-left text-sm font-medium cursor-pointer"
            title={conversation.title || t("chat.untitled")}
          >
            {conversation.title || t("chat.untitled")}
          </button>
          {hasChildren && (
            <span
              className={cn(
                "shrink-0 rounded px-1 text-2xs tabular-nums",
                isActive ? "text-accent/70" : "text-text-muted",
              )}
              title={t("chat.book.forkCount", {
                defaultValue: "{{count}} branch",
                count: childCount,
              })}
            >
              {childCount}
            </span>
          )}
          {/* hover actions */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
        </>
      )}
    </div>
  );
});
