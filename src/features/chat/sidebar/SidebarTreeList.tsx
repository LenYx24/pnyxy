/**
 * The scrollable folder tree for the global /chat sidebar, wrapped in its
 * DndContext: drill-in breadcrumb, the root drop strip, ChatTree, and the
 * drag ghost portaled to <body>. Owns the drag state via useSidebarDnd.
 */
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import i18next from "i18next";
import {
  AlertTriangle,
  ChevronLeft,
  FilePlus2,
  Folder as FolderIcon,
  FolderPlus,
  Library,
  MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useChatStore } from "@/stores/chat-store";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { useChatSidebar } from "./ChatSidebarContext";
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
  const sidebar = useChatSidebar();
  const conversationsError = useChatStore((s) => s.conversationsError);
  const fetchConversations = useChatStore((s) => s.fetchConversations);

  // Right-click on the empty area below the rows while drilled into a
  // folder: the same folder actions as on the folder row itself, so the
  // user does not have to go back up to act on the folder they are in.
  // Row handlers stopPropagation, so this only fires on blank space.
  const blankMenuItems = (): ContextMenuEntry[] => {
    if (!drilledFolder || quickView) return [];
    const id = drilledFolder.id;
    return [
      {
        id: "new",
        label: t("chat.sidebar.newInFolder"),
        icon: FilePlus2,
        onClick: () => sidebar.onNewInFolder(id),
      },
      {
        id: "new-subfolder",
        label: t("chat.folders.newSubfolder"),
        icon: FolderPlus,
        onClick: () => sidebar.onNewSubfolder(id),
      },
      {
        id: "open-in-library",
        label: t("chat.folders.openInLibrary"),
        icon: Library,
        onClick: () => sidebar.onOpenFolderInLibrary(id),
      },
      { id: "div-back", divider: true },
      {
        id: "back",
        label: t("chat.folders.backToAll"),
        icon: ChevronLeft,
        onClick: () => onRootFolderChange(null),
      },
    ];
  };
  const blankCtxMenu = useContextMenu(blankMenuItems);

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
      <div
        className="chat-scroll min-h-0 flex-1 overflow-y-auto"
        {...blankCtxMenu}
      >
        {conversations.length === 0 && folders.length === 0 && conversationsError ? (
          <div className="flex flex-col items-center gap-2 px-2 py-4 text-center">
            <AlertTriangle size={20} strokeWidth={1.5} className="text-warning" />
            <p className="text-xs text-text-muted">
              {t("chat.errors.loadConversationsFailed")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchConversations()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : conversations.length === 0 && folders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-4 text-center">
            <MessagesSquare
              size={20}
              strokeWidth={1.5}
              className="text-text-muted"
            />
            <p className="text-xs text-text-muted">
              {t("chat.sidebar.empty")}
            </p>
          </div>
        ) : filteredConversationData.conversations.length === 0 &&
          filteredConversationData.folders.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-text-muted">
            {t("chat.searchNoResults")}
          </p>
        ) : (
          <>
            {drilledFolder && !quickView && (
              <nav
                aria-label={t("chat.folders.breadcrumb")}
                className="mb-1 flex items-center gap-0.5 px-1 py-1 text-xs"
              >
                {/* back = one level up, not straight to the root */}
                <button
                  type="button"
                  onClick={() =>
                    onRootFolderChange(drilledFolder.parent_id ?? null)
                  }
                  className="flex shrink-0 items-center rounded-control p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary/60 hover:text-text-primary cursor-pointer"
                  aria-label={t("chat.folders.up")}
                  title={t("chat.folders.up")}
                >
                  <ChevronLeft size={16} strokeWidth={1.5} />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                  {folderTrail(folders, drilledFolder).map((crumb, i, arr) => {
                    const last = i === arr.length - 1;
                    return (
                      <span
                        key={crumb.id ?? "root"}
                        className="flex min-w-0 items-center gap-0.5"
                      >
                        {i > 0 && <span className="text-text-muted-2">/</span>}
                        {last ? (
                          <span className="truncate px-1 font-medium text-text-primary">
                            {crumb.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRootFolderChange(crumb.id)}
                            className="truncate rounded-control px-1 py-0.5 text-text-secondary transition-colors hover:bg-bg-tertiary/60 hover:text-text-primary cursor-pointer"
                          >
                            {crumb.name}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </nav>
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

/** Root-first trail for the breadcrumb: "All chats" + every ancestor + the folder itself. */
function folderTrail(
  folders: ChatFolder[],
  folder: ChatFolder,
): { id: string | null; name: string }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: { id: string | null; name: string }[] = [];
  let cur: ChatFolder | undefined = folder;
  for (let depth = 0; cur && depth < 16; depth++) {
    chain.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  chain.unshift({ id: null, name: i18next.t("chat.folders.backToAll") });
  return chain;
}
