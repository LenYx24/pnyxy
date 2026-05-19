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
import { useDraggable, useDroppable } from "@dnd-kit/core";
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

  return (
    <div className="flex flex-col gap-0.5">
      {/* Quick chats — virtual top-level folder grouping every loose
          (folder_id = null) conversation. Always pinned at the top
          and tinted with the accent color so it stays distinct from
          the user's organized folders. */}
      <div className="rounded-md bg-accent-purple/[0.06]">
        <div className="group flex items-stretch">
          <IndentGuides depth={0} />
          <div className="flex flex-1 items-center gap-1.5 py-1.5 pr-2 min-w-0">
            <button
              onClick={() => props.onToggleFolder(QUICK_CHATS_KEY)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-accent-purple/80 transition-colors hover:text-accent-purple cursor-pointer"
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
              className="shrink-0 text-accent-purple/80"
            />
            <button
              onClick={() => props.onToggleFolder(QUICK_CHATS_KEY)}
              className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-accent-purple/90 cursor-pointer"
            >
              {t("chat.sidebar.quickChats", { defaultValue: "Quick chats" })}
              {rootConvs.length > 0 && (
                <span className="ml-1.5 text-[10px] font-normal text-accent-purple/60">
                  {rootConvs.length}
                </span>
              )}
            </button>
          </div>
        </div>
        {!quickChatsCollapsed && (
          <>
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
                className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] text-accent-purple/70 transition-colors hover:bg-accent-purple/10 hover:text-accent-purple cursor-pointer"
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
                  className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] text-accent-purple/70 transition-colors hover:bg-accent-purple/10 hover:text-accent-purple cursor-pointer"
                  style={{ paddingLeft: 8 + 1 * 12 }}
                >
                  <ChevronDown size={12} className="rotate-180" />
                  {t("chat.sidebar.showFewerQuickChats", {
                    defaultValue: "Show fewer",
                  })}
                </button>
              )}
          </>
        )}
      </div>

      {/* Separator between Quick chats and the user's organized
          folder tree. Renders only when there's at least one folder. */}
      {(childFolders.get(null) ?? []).length > 0 && (
        <div className="my-1 h-px bg-glass-border" />
      )}

      {(childFolders.get(null) ?? []).map((f) => (
        <FolderRow
          key={f.id}
          folder={f}
          depth={0}
          childFolders={childFolders}
          folderConversations={folderConversations}
          {...props}
        />
      ))}
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
  const t = rest.t;
  // Drag a folder to reparent it; drop conversations / other folders
  // on the row body to nest them inside.
  const draggable = useDraggable({ id: `folder:${folder.id}` });
  const droppable = useDroppable({ id: `nest:${folder.id}` });
  // dnd-kit's `setNodeRef` is a callback ref, not a `.current`-bearing
  // ref; combining two hooks on one node is the documented pattern.
  const combineRef = (el: HTMLDivElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };
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
        ref={combineRef}
        {...draggable.attributes}
        {...draggable.listeners}
        {...ctxMenu}
        className={cn(
          "group flex items-stretch rounded-md text-text-secondary transition-colors cursor-grab active:cursor-grabbing",
          droppable.isOver
            ? "bg-accent-purple/20 ring-1 ring-accent-purple/60"
            : "hover:bg-glass-hover hover:text-text-primary",
          draggable.isDragging && "opacity-40",
        )}
      >
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
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-accent-purple group-hover:opacity-100 cursor-pointer"
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
            className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
            aria-label={t("chat.folders.delete")}
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
      {expanded && (
        <>
          {subConversations.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              depth={depth + 1}
              {...rest}
            />
          ))}
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
  // Conversations are draggable but not droppable — drop targets are
  // folders and the root strip. While editing the title we disable
  // the drag listener so the input doesn't get hijacked.
  const draggable = useDraggable({
    id: `conv:${conversation.id}`,
    disabled: isEditing,
  });

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
      ref={draggable.setNodeRef}
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
          ? "bg-accent-purple/20 text-accent-purple before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent-purple"
          : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
      )}
    >
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
              className="flex-1 min-w-0 rounded border border-glass-border bg-bg-primary/50 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent-purple"
            />
            <button
              onClick={() => onSaveTitle(conversation.id)}
              className="rounded p-1 text-green-400 hover:bg-glass-hover cursor-pointer"
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
            <button
              onClick={() => onOpen(conversation.id)}
              className="flex-1 min-w-0 truncate text-left text-xs cursor-pointer"
            >
              {conversation.title || t("chat.untitled")}
            </button>
            <button
              ref={moveBtnRef}
              onClick={() => setShowMove((v) => !v)}
              className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
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
              className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
              aria-label={t("chat.rename")}
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => onDelete(conversation.id)}
              className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-red-400 group-hover:opacity-100 cursor-pointer"
              aria-label={t("chat.delete")}
            >
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>
    </div>
  );
});

// Slim drop strip pinned to the top of the conversation list. Drop
// a conversation or folder onto it to send it back to the root
// (folder_id / parent_id = null). Only visually announces itself
// when there's an active drag — invisible the rest of the time so
// it doesn't take up sidebar space when no one's reaching for it.
export function RootDropZone({ label }: { label: string }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: "root" });
  const dragging = !!active;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-all",
        dragging
          ? "mb-1.5 flex items-center justify-center rounded-md border border-dashed py-1.5 text-[11px]"
          : "h-0 overflow-hidden",
        isOver
          ? "border-accent-purple bg-accent-purple/15 text-accent-purple"
          : "border-glass-border text-text-muted",
      )}
    >
      {dragging && label}
    </div>
  );
}
