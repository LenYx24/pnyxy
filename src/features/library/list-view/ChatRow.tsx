import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Download,
  FolderInput,
  GripVertical,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import { useChatStore } from "@/stores/chat-store";
import { downloadConversationMarkdownById } from "@/lib/export-conversation";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { ChatConversation } from "@/types/chat";
import type { ListColumnWidths } from "../useLibraryPrefs";
import { DEFAULT_LIST_COLUMN_WIDTHS } from "../useLibraryPrefs";
import { FolderPickerModal } from "../modals/FolderPickerModal";
import { ContextMenu, MenuItem } from "./MenuButton";
import { formatDate, type RowDensity } from "./helpers";

interface ChatRowProps {
  conversation: ChatConversation;
  depth?: number;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  density?: RowDensity;
  sortableId?: string;
  columnWidths?: ListColumnWidths;
}

/** List-view row for an LLM conversation. Same layout as the other
 *  node rows; opens /chat with this conversation active. */
export function ChatRow({
  conversation,
  depth = 0,
  selected,
  selectionActive,
  onToggleSelect,
  density = { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" },
  sortableId,
  columnWidths = DEFAULT_LIST_COLUMN_WIDTHS,
}: ChatRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const openConversation = useChatStore((s) => s.openConversation);
  const moveConversationToFolder = useChatStore(
    (s) => s.moveConversationToFolder,
  );
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const isTopLevel = depth === 0;
  const sortable = useSortable({
    id: sortableId ?? `chat:${conversation.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `chat:${conversation.id}`,
    disabled: isTopLevel,
  });
  const setNodeRef = isTopLevel ? sortable.setNodeRef : draggable.setNodeRef;
  const attributes = isTopLevel ? sortable.attributes : draggable.attributes;
  const listeners = isTopLevel ? sortable.listeners : draggable.listeners;
  const isDragging = isTopLevel ? sortable.isDragging : draggable.isDragging;
  const transform = isTopLevel ? sortable.transform : draggable.transform;
  const transition = isTopLevel ? sortable.transition : undefined;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const selKey = `chat:${conversation.id}`;
  const title = conversation.title.trim() || t("library.allBooks.untitledChat");
  const indent = Math.min(depth * 20, 80);

  const open = () => {
    void openConversation(conversation.id);
    navigate("/chat");
  };

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
    open();
  };

  const contextHandlers = useContextMenu((): ContextMenuEntry[] => [
    {
      id: "open",
      label: t("library.allBooks.openChat"),
      icon: MessageSquare,
      onClick: open,
    },
    {
      id: "move",
      label: t("library.actions.moveToFolder"),
      icon: FolderInput,
      onClick: () => setMoveOpen(true),
    },
    {
      id: "export",
      label: t("library.actions.exportMarkdown"),
      icon: Download,
      onClick: () =>
        void downloadConversationMarkdownById(conversation).catch((err) =>
          logError("library:exportChat", err),
        ),
    },
    { id: "div-1", divider: true },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () =>
        void deleteConversation(conversation.id).catch((err) =>
          logError("library:deleteChat", err),
        ),
    },
  ]);

  return (
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
        <div className="mr-1 shrink-0 text-text-muted/50" aria-hidden="true">
          <GripVertical size={14} />
        </div>

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

        <div className="mr-1 hidden w-[26px] sm:block" />

        <div className="mr-2.5 flex aspect-[5/7] h-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-gradient-to-br from-sky-400/20 to-accent-purple/20 sm:h-9">
          <MessageSquare size={14} className="text-sky-400/80" />
        </div>

        <span
          className={cn("min-w-0 flex-1 truncate text-text-primary", density.text)}
          title={title}
        >
          {title}
        </span>

        <span className="mr-2 hidden items-center gap-1 rounded bg-sky-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400 sm:inline-flex">
          <MessageSquare size={9} />
          {t("library.allBooks.chatLabel")}
        </span>

        {/* Author column → source doc title for chats, when set. */}
        <span
          className="mr-4 hidden shrink-0 truncate text-xs text-text-muted md:block"
          style={{ width: columnWidths.author }}
          title={conversation.source_doc_title ?? undefined}
        >
          {conversation.source_doc_title ?? ""}
        </span>

        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.size }}
        >
          —
        </span>

        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(conversation.updated_at)}
        </span>

        <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
          <MenuItem
            icon={MessageSquare}
            label={t("library.allBooks.openChat")}
            onClick={() => {
              setMenuOpen(false);
              open();
            }}
          />
          <MenuItem
            icon={FolderInput}
            label={t("library.actions.moveToFolder")}
            onClick={() => {
              setMenuOpen(false);
              setMoveOpen(true);
            }}
          />
          <MenuItem
            icon={Download}
            label={t("library.actions.exportMarkdown")}
            onClick={() => {
              setMenuOpen(false);
              void downloadConversationMarkdownById(conversation).catch((err) =>
                logError("library:exportChat", err),
              );
            }}
          />
          <MenuItem
            icon={Trash2}
            label={t("common.delete")}
            danger
            onClick={() => {
              setMenuOpen(false);
              void deleteConversation(conversation.id).catch((err) =>
                logError("library:deleteChat", err),
              );
            }}
          />
        </ContextMenu>
      </div>

      <FolderPickerModal
        open={moveOpen}
        folders={folders}
        currentFolderId={conversation.folder_id}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          void moveConversationToFolder(conversation.id, folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
