/**
 * The scrollable folder tree for the global /chat sidebar, wrapped in its
 * DndContext: drill-in breadcrumb, the root drop strip, ChatTree, and the
 * drag ghost portaled to <body>. Owns the drag state via useSidebarDnd.
 */
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  Folder as FolderIcon,
  MessagesSquare,
} from "lucide-react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { restrictToWindowEdges } from "@/lib/dnd-modifiers";
import type { ChatConversation, ChatFolder } from "@/types/chat";
import { ChatTree, RootDropZone } from "./ChatTree";
import { useSidebarDnd } from "./useSidebarDnd";
import type { ChatSidebarView } from "./useChatSidebarView";

interface SidebarTreeListProps {
  /** Every conversation / folder (emptiness check + drag handling). */
  conversations: ChatConversation[];
  folders: ChatFolder[];
  /** Search-filtered data that is actually rendered. */
  filtered: { conversations: ChatConversation[]; folders: ChatFolder[] };
  activeId: string | null;
  collapsedFolders: Set<string>;
  rootFolderId: string | null;
  drilledFolder: ChatFolder | null;
  onRootFolderChange: (id: string | null) => void;
  sidebarView: ChatSidebarView;
}

export function SidebarTreeList({
  conversations,
  folders,
  filtered: filteredConversationData,
  activeId,
  collapsedFolders,
  rootFolderId,
  drilledFolder,
  onRootFolderChange,
  sidebarView,
}: SidebarTreeListProps) {
  const { t } = useTranslation();
  const quickView = sidebarView === "quick";
  const dnd = useSidebarDnd({ folders, conversations, rootFolderId });

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      modifiers={[restrictToWindowEdges]}
      onDragStart={dnd.handleDragStart}
      onDragOver={dnd.handleDragOver}
      onDragEnd={dnd.handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 && folders.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-text-muted">
            {t("chat.sidebar.empty")}
          </p>
        ) : filteredConversationData.conversations.length === 0 &&
          filteredConversationData.folders.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-text-muted">
            {t("chat.searchNoResults")}
          </p>
        ) : (
          <>
            {drilledFolder && !quickView && (
              <button
                type="button"
                onClick={() => onRootFolderChange(null)}
                className="mb-1 flex w-full items-center gap-1.5 rounded-control px-3 py-2 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-bg-tertiary/60 hover:text-text-primary cursor-pointer"
              >
                <ChevronLeft size={16} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">
                  {t("chat.folders.backToAll")}
                </span>
                <span className="mx-1 text-text-muted-2">/</span>
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  {drilledFolder.name}
                </span>
              </button>
            )}
            {!quickView && (
              <RootDropZone label={t("chat.folders.dropToRoot")} />
            )}
            <ChatTree
              view={sidebarView}
              folders={filteredConversationData.folders}
              conversations={filteredConversationData.conversations}
              activeId={activeId}
              activeDragId={dnd.activeDragId}
              overDragId={dnd.overDragId}
              collapsedFolders={collapsedFolders}
              rootFolderId={rootFolderId}
            />
          </>
        )}
      </div>
      {/* drag preview that follows the cursor, empty when nothing is
          dragging. Portaled to <body> so a transformed ancestor can't
          become its containing block. */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {dnd.activeDragConv && (
            <div className="pointer-events-none flex items-center gap-2 rounded-control bg-surface-3 px-3 py-2 text-xs text-text-primary shadow-page">
              <MessagesSquare
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-text-muted"
              />
              <span className="max-w-[200px] truncate">
                {dnd.activeDragConv.title || t("chat.untitled")}
              </span>
            </div>
          )}
          {dnd.activeDragFolder && (
            <div className="pointer-events-none flex items-center gap-2 rounded-control bg-surface-3 px-3 py-2 text-xs text-text-primary shadow-page">
              <FolderIcon
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-text-muted"
              />
              <span className="max-w-[200px] truncate">
                {dnd.activeDragFolder.name}
              </span>
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
