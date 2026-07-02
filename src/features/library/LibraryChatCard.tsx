import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MoreVertical,
  FolderInput,
  Trash2,
  Download,
  MessageSquare,
} from "lucide-react";
import { Checkbox, FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";
import { conversationDisplayTitle } from "@/lib/entity-title";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import { useChatStore } from "@/stores/chat-store";
import { downloadConversationMarkdownById } from "@/lib/export-conversation";
import type { ChatConversation } from "@/types/chat";
import { FolderPickerModal } from "./modals/FolderPickerModal";

interface LibraryChatCardProps {
  conversation: ChatConversation;
  sortableId?: string;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
}

/**
 * Grid card for an LLM conversation in the library filetree. Opens the
 * chat at /chat with this conversation made active (there's no per-
 * conversation route; the store's activeConversationId drives ChatPage).
 * Export is a Markdown transcript of the active-leaf thread.
 */
export function LibraryChatCard({
  conversation,
  sortableId,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: LibraryChatCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const openConversation = useChatStore((s) => s.openConversation);
  const moveConversationToFolder = useChatStore(
    (s) => s.moveConversationToFolder,
  );
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const sortable = useSortable({
    id: sortableId ?? conversation.id,
    disabled: !sortableId,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const style = sortableId
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const title = conversationDisplayTitle(conversation, t);
  const subtitle = conversation.source_doc_title?.trim()
    ? t("library.allBooks.chatFromSource", {
        source: conversation.source_doc_title,
      })
    : t("library.allBooks.chatLabel");
  const selKey = `chat:${conversation.id}`;
  const compact = coverHeight < 100;
  const intrinsicHeight = coverHeight + 80;

  const open = () => {
    // openConversation sets activeConversationId synchronously (then
    // streams messages in); navigating to /chat picks it up and the
    // auto-open-most-recent effect is skipped because activeId is set.
    void openConversation(conversation.id);
    navigate("/chat");
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    open();
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${intrinsicHeight}px`,
      }}
      {...attributes}
      {...listeners}
    >
      <div
        className={cn(
          "group relative",
          selected && "ring-2 ring-accent rounded-md",
          isDragging && "opacity-50",
        )}
      >
        <div onClick={handleClick} title={title} className="cursor-pointer">
          <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-accent-blue/10 shadow-sm transition-shadow group-hover:shadow-md">
            <MessageSquare
              size={Math.round(Math.min(Math.max(coverHeight * 0.32, 24), 48))}
              className="text-accent-blue/80"
            />

            {onToggleSelect && (
              <div
                className={cn(
                  "absolute left-1.5 top-1.5 z-10 transition-opacity",
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
            )}

            <span
              className="absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 text-accent-blue backdrop-blur-sm"
              title={t("library.allBooks.chatLabel")}
            >
              <MessageSquare size={10} />
            </span>
          </div>

          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-semibold leading-tight text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-2xs" : "text-xs",
              )}
            >
              {subtitle}
            </p>
          </div>
        </div>

        <div className="absolute right-1.5 top-1.5">
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={cn(
              "rounded-lg p-1.5 transition-colors cursor-pointer",
              "bg-black/40 text-white/70 hover:bg-black/60 hover:text-white",
              menuOpen
                ? "opacity-100"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
            )}
          >
            <MoreVertical size={16} />
          </button>

          <FloatingMenu
            open={menuOpen}
            anchorRef={triggerRef}
            onClose={() => setMenuOpen(false)}
            className="w-48"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                open();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <MessageSquare size={14} />
              {t("library.allBooks.openChat")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setMoveOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderInput size={14} />
              {t("library.actions.moveToFolder")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                void downloadConversationMarkdownById(conversation).catch((err) =>
                  logError("library:exportChat", err),
                );
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Download size={14} />
              {t("library.actions.exportMarkdown")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                void deleteConversation(conversation.id).catch((err) =>
                  logError("library:deleteChat", err),
                );
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <Trash2 size={14} />
              {t("common.delete")}
            </button>
          </FloatingMenu>
        </div>
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
