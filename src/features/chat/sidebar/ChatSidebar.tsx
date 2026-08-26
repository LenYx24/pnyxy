/**
 * The conversation panel (desktop column / mobile drawer): toolbar, drill-in
 * breadcrumb, the folder tree (or the book-scoped lineage tree), root drop
 * zone (SidebarTreeList), streak footer and the resize handle. Owns sidebar-local state:
 * width, search, collapsed folders, inline rename, folder modals, DnD.
 * Publishes its callbacks to the tree rows through ChatSidebarContext.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Flame } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsMobile } from "@/hooks/use-media-query";
import { useChatStore } from "@/stores/chat-store";
import { useLibraryStore } from "@/stores/library-store";
import { useStreakStore } from "@/stores/streak-store";
import type { ChatConversation } from "@/types/chat";
import type {
  ChatPageScope,
  ConfirmFn,
  ScopeSource,
} from "../page/useChatPageState";
import { BookChatTree } from "./BookChatTree";
import { isQuickChatsFolder } from "./conversation-groups";
import { useChatSidebarView } from "./useChatSidebarView";
import { ChatSidebarProvider, type ChatSidebarActions } from "./ChatSidebarContext";
import { SidebarTreeList } from "./SidebarTreeList";
import { FolderActionModals, type FolderAction } from "./FolderActionModals";
import { MoveConversationModal } from "./MoveConversationModal";
import { SidebarToolbar } from "./SidebarToolbar";

// resizable sidebar (desktop only), width persisted in localStorage
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_STORAGE_KEY = "pnyxy-chat-sidebar-width";

interface ChatSidebarProps {
  scope?: ChatPageScope;
  scopeSource: ScopeSource;
  /** Conversations after scope filtering (all of them when unscoped). */
  visibleConversations: ChatConversation[];
  /** Drill-in root folder; the page owns it because new chats land there. */
  rootFolderId: string | null;
  onRootFolderChange: (id: string | null) => void;
  /** Mobile drawer visibility; the sheet header opens it. */
  mobileOpen: boolean;
  onMobileClose: () => void;
  onNew: () => void;
  confirm: ConfirmFn;
}

export function ChatSidebar({
  scope,
  scopeSource,
  visibleConversations,
  rootFolderId,
  onRootFolderChange,
  mobileOpen,
  onMobileClose,
  onNew,
  confirm,
}: ChatSidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // sidebar footer streak line
  const streakDays = useStreakStore((s) => s.getCurrentStreak());
  const {
    conversations,
    folders,
    activeId,
    openConversation,
    createConversation,
    deleteConversation,
    renameConversation,
    moveConversationToFolder,
  } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      folders: s.folders,
      activeId: s.activeConversationId,
      openConversation: s.openConversation,
      createConversation: s.createConversation,
      deleteConversation: s.deleteConversation,
      renameConversation: s.renameConversation,
      moveConversationToFolder: s.moveConversationToFolder,
    })),
  );
  // chat folders live in the shared library folders table
  const navigateToLibraryFolder = useLibraryStore((s) => s.navigateToFolder);

  const drilledFolder = rootFolderId
    ? folders.find((f) => f.id === rootFolderId) ?? null
    : null;
  // already sorted by sort_order in the store
  const sortedConversations = visibleConversations;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // collapsed folder ids (absence = expanded), lifted so collapse-all can write all at once
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  // one folder-action modal at a time, dispatched by `kind`
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
  // conversation waiting in the "move to folder" picker modal
  const [moveRequest, setMoveRequest] = useState<{
    id: string;
    folderId: string | null;
  } | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      const n = stored ? parseInt(stored, 10) : SIDEBAR_DEFAULT;
      if (Number.isFinite(n)) {
        return Math.min(Math.max(n, SIDEBAR_MIN), SIDEBAR_MAX);
      }
    } catch {
      // localStorage can be blocked in private mode
    }
    return SIDEBAR_DEFAULT;
  });
  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      // don't select text while dragging
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      let lastWidth = startWidth;
      const onMove = (mv: MouseEvent) => {
        const next = Math.min(
          Math.max(startWidth + (mv.clientX - startX), SIDEBAR_MIN),
          SIDEBAR_MAX,
        );
        lastWidth = next;
        setSidebarWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try {
          localStorage.setItem(SIDEBAR_STORAGE_KEY, String(lastWidth));
        } catch {
          // ignore
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  // title-only case-insensitive substring match
  const [conversationSearch, setConversationSearch] = useState("");
  const filteredConversationData = useMemo(() => {
    const q = conversationSearch.trim().toLowerCase();
    if (!q) {
      return { conversations: sortedConversations, folders };
    }
    const folderById = new Map(folders.map((f) => [f.id, f]));
    const matched = sortedConversations.filter((c) =>
      (c.title || "").toLowerCase().includes(q),
    );
    // keep every ancestor folder of a match so nested hits aren't orphaned
    const keptFolderIds = new Set<string>();
    for (const c of matched) {
      let fid = c.folder_id;
      while (fid && !keptFolderIds.has(fid)) {
        keptFolderIds.add(fid);
        const f = folderById.get(fid);
        fid = f?.parent_id ?? null;
      }
    }
    return {
      conversations: matched,
      folders: folders.filter((f) => keptFolderIds.has(f.id)),
    };
  }, [sortedConversations, folders, conversationSearch]);

  const handleCollapseAll = useCallback(() => {
    setCollapsedFolders(new Set(folders.map((f) => f.id)));
  }, [folders]);
  const handleExpandAll = useCallback(() => {
    setCollapsedFolders(new Set());
  }, []);
  // flips the toolbar button between collapse-all and expand-all. The
  // auto-created "Quick chats" folder is not drawn as a folder, so it does
  // not count toward "are there folders to collapse".
  const visibleFolderCount = folders.filter(
    (f) => !isQuickChatsFolder(f, t),
  ).length;
  // folder tree vs flat newest-first list, persisted in localStorage
  const [sidebarView, setSidebarView] = useChatSidebarView();
  const quickView = sidebarView === "quick";
  const allFoldersCollapsed =
    folders.length > 0 && folders.every((f) => collapsedFolders.has(f.id));

  // ---- callbacks published to the tree rows (stable identities so
  // ChatTree's memoized rows don't re-render on every keystroke) ----
  const handleToggleFolder = useCallback((id: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const handleStartEdit = useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  }, []);
  const handleCancelEdit = useCallback(() => setEditingId(null), []);
  const handleSaveTitle = useCallback(
    async (id: string) => {
      await renameConversation(id, editTitle.trim() || t("chat.untitled"));
      setEditingId(null);
    },
    [renameConversation, editTitle, t],
  );
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: t("chat.deleteConfirmTitle"),
        body: t("chat.deleteConfirmBody"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (ok) void deleteConversation(id);
    },
    [confirm, deleteConversation, t],
  );
  const handleRequestRenameFolder = useCallback(
    (id: string, currentName: string) => {
      setFolderAction({ kind: "rename", id, name: currentName });
    },
    [],
  );
  const handleRequestDeleteFolder = useCallback(
    (id: string, currentName: string) => {
      setFolderAction({ kind: "delete", id, name: currentName });
    },
    [],
  );
  const handleRequestCreateSubfolder = useCallback((parentId: string) => {
    setFolderAction({ kind: "create", parentId });
  }, []);
  const handleRequestMove = useCallback(
    (id: string, currentFolderId: string | null) => {
      setMoveRequest({ id, folderId: currentFolderId });
    },
    [],
  );
  const handleOpenFolderInLibrary = useCallback(
    (folderId: string) => {
      navigateToLibraryFolder(folderId);
      navigate("/library");
    },
    [navigateToLibraryFolder, navigate],
  );
  const handleNewInFolder = useCallback(
    async (folderId: string) => {
      onMobileClose();
      await createConversation("", folderId, scopeSource);
    },
    [onMobileClose, createConversation, scopeSource],
  );
  // opening a thread from the mobile drawer closes it
  const handleOpenFromDrawer = useCallback(
    (id: string) => {
      onMobileClose();
      void openConversation(id);
    },
    [onMobileClose, openConversation],
  );

  const sidebarActions = useMemo<ChatSidebarActions>(
    () => ({
      editingId,
      editTitle,
      onOpen: handleOpenFromDrawer,
      onStartEdit: handleStartEdit,
      onCancelEdit: handleCancelEdit,
      onSaveTitle: handleSaveTitle,
      onEditTitleChange: setEditTitle,
      onDelete: handleDeleteConversation,
      onMove: moveConversationToFolder,
      onRequestMove: handleRequestMove,
      onToggleFolder: handleToggleFolder,
      onNewInFolder: handleNewInFolder,
      onNewSubfolder: handleRequestCreateSubfolder,
      onOpenFolderInLibrary: handleOpenFolderInLibrary,
      onEnterFolder: onRootFolderChange,
      onRequestRenameFolder: handleRequestRenameFolder,
      onRequestDeleteFolder: handleRequestDeleteFolder,
      t,
    }),
    [
      editingId,
      editTitle,
      handleOpenFromDrawer,
      handleStartEdit,
      handleCancelEdit,
      handleSaveTitle,
      handleDeleteConversation,
      moveConversationToFolder,
      handleRequestMove,
      handleToggleFolder,
      handleNewInFolder,
      handleRequestCreateSubfolder,
      handleOpenFolderInLibrary,
      onRootFolderChange,
      handleRequestRenameFolder,
      handleRequestDeleteFolder,
      t,
    ],
  );

  return (
    <>
      {/* mobile backdrop, tap to close the drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 sm:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      {/* conversation panel: sits on the desk color, no border. column on
          desktop, drawer on mobile */}
      <aside
        // resizable width on desktop only; mobile is a fixed w-72 drawer
        style={!isMobile ? { width: sidebarWidth } : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 max-w-[80vw] shrink-0 flex-col gap-1.5 bg-bg-primary px-2.5 py-3.5 transition-transform duration-200",
          "sm:relative sm:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <SidebarToolbar
          scope={scope}
          sidebarView={sidebarView}
          onSidebarViewChange={setSidebarView}
          onCreateFolder={() => setFolderAction({ kind: "create", parentId: null })}
          showCollapseToggle={!scope && !quickView && visibleFolderCount > 0}
          allFoldersCollapsed={allFoldersCollapsed}
          onCollapseAll={handleCollapseAll}
          onExpandAll={handleExpandAll}
          onNew={onNew}
          showSearch={conversations.length > 0}
          search={conversationSearch}
          onSearchChange={setConversationSearch}
        />

        <ChatSidebarProvider value={sidebarActions}>
          {scope ? (
            <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
              {visibleConversations.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-text-muted">
                  {t("chat.book.empty", {
                    defaultValue: "No chats about this book yet.",
                  })}
                </p>
              ) : filteredConversationData.conversations.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-text-muted">
                  {t("chat.searchNoResults")}
                </p>
              ) : (
                <BookChatTree
                  conversations={filteredConversationData.conversations}
                  folders={folders}
                  activeId={activeId}
                  editingId={editingId}
                  editTitle={editTitle}
                  onOpen={handleOpenFromDrawer}
                  onStartEdit={handleStartEdit}
                  onCancelEdit={handleCancelEdit}
                  onSaveTitle={handleSaveTitle}
                  onEditTitleChange={setEditTitle}
                  onDelete={handleDeleteConversation}
                  onMove={moveConversationToFolder}
                  onRequestMove={handleRequestMove}
                  onNewInFolder={handleNewInFolder}
                  onRequestRenameFolder={handleRequestRenameFolder}
                  onRequestDeleteFolder={handleRequestDeleteFolder}
                  onOpenFolderInLibrary={handleOpenFolderInLibrary}
                  t={t}
                />
              )}
            </div>
          ) : (
            <SidebarTreeList
              conversations={conversations}
              folders={folders}
              filtered={filteredConversationData}
              activeId={activeId}
              collapsedFolders={collapsedFolders}
              rootFolderId={rootFolderId}
              drilledFolder={drilledFolder}
              onRootFolderChange={onRootFolderChange}
              sidebarView={sidebarView}
            />
          )}
        </ChatSidebarProvider>

        {/* footer: reading streak */}
        {streakDays > 0 && (
          <Link
            to="/streaks"
            className="mt-auto flex items-center gap-2 rounded-control px-3 py-2.5 text-xs text-text-muted transition-colors hover:bg-bg-tertiary/60 hover:text-text-primary"
          >
            <Flame size={16} strokeWidth={1.5} className="shrink-0 text-streak" />
            <span>{t("chat.sidebar.streak", { count: streakDays })}</span>
          </Link>
        )}

        {/* resize handle, desktop only (mobile drawer is fixed width). invisible. */}
        {!isMobile && (
          <div
            onMouseDown={handleSidebarResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("chat.sidebar.resize")}
            className="absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize bg-transparent sm:block"
          />
        )}
      </aside>

      {/* folder action modals, one at a time by folderAction.kind */}
      <FolderActionModals
        action={folderAction}
        onClose={() => setFolderAction(null)}
      />

      {/* "Move to folder…" picker, opened from a conversation's menu */}
      <MoveConversationModal
        open={moveRequest !== null}
        currentFolderId={moveRequest?.folderId ?? null}
        folders={folders}
        onClose={() => setMoveRequest(null)}
        onSelect={(folderId) => {
          if (moveRequest) void moveConversationToFolder(moveRequest.id, folderId);
        }}
      />
    </>
  );
}
