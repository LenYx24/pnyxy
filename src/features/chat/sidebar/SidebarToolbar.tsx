/**
 * Top of the sidebar: the mobile-only nav row (hamburger + logo), the
 * book-scoped "back to book" banner, the panel header (title, folders/quick
 * view switch, new folder, collapse/expand all, new chat) and the search
 * field. Stateless; ChatSidebar owns the values.
 */
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  FolderTree,
  Menu,
  Search,
  MessageSquareDashed,
  SquarePen,
  X,
  Zap,
} from "lucide-react";
import {
  IconButton,
  Tooltip,
  chipClass,
  fieldClass,
  segmentedGroupClass,
  segmentedItemActiveClass,
  segmentedItemClass,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import type { ChatPageScope } from "../page/useChatPageState";
import type { ChatSidebarView } from "./useChatSidebarView";

interface SidebarToolbarProps {
  scope?: ChatPageScope;
  sidebarView: ChatSidebarView;
  onSidebarViewChange: (view: ChatSidebarView) => void;
  onCreateFolder: () => void;
  /** Collapse/expand-all button is shown only when there is something to fold. */
  showCollapseToggle: boolean;
  allFoldersCollapsed: boolean;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onNew: () => void;
  onNewTemporary?: () => void;
  /** Search is hidden when there is nothing to search. */
  showSearch: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}

export function SidebarToolbar({
  scope,
  sidebarView,
  onSidebarViewChange,
  onCreateFolder,
  showCollapseToggle,
  allFoldersCollapsed,
  onCollapseAll,
  onExpandAll,
  onNew,
  onNewTemporary,
  showSearch,
  search,
  onSearchChange,
}: SidebarToolbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // opens the global nav overlay
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const sidebarViewOptions: {
    key: ChatSidebarView;
    label: string;
    Icon: typeof FolderTree;
  }[] = [
    { key: "folders", label: t("chat.sidebar.viewFolders"), Icon: FolderTree },
    { key: "quick", label: t("chat.sidebar.viewQuick"), Icon: Zap },
  ];

  return (
    <>
      {/* mobile drawer header: global MobileTopBar is hidden on /chat, so
          this keeps the nav trigger and home link reachable. mobile-only. */}
      <div
        className="flex items-center gap-1.5 sm:hidden"
        style={{ marginTop: "var(--spacing-safe-top, 0px)" }}
      >
        <IconButton
          size="sm"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label={t("sidebar.openNav")}
        >
          <Menu size={20} strokeWidth={1.5} />
        </IconButton>
        <Link to="/" aria-label="Pnyxy home" className="flex items-center">
          <img src="/logo.svg" alt="Pnyxy" className="h-6 w-auto" />
        </Link>
      </div>

      {/* book-scoped banner: back to the book + which book these chats are about */}
      {scope && (
        <div className="flex flex-col gap-1.5 px-2 pb-1">
          <button
            type="button"
            onClick={() =>
              scope.backTo ? navigate(scope.backTo) : navigate(-1)
            }
            className="flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <ArrowLeft size={16} strokeWidth={1.5} />
            {scope.backLabel || t("chat.book.backToBook")}
          </button>
          <span className={cn(chipClass, "max-w-full")} title={scope.docTitle}>
            <BookOpen size={14} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{scope.docTitle}</span>
          </span>
        </div>
      )}

      {/* panel header: title + icon actions (new folder, collapse, new chat) */}
      <div className="flex items-center justify-between gap-1 px-2 pb-1.5 pt-1">
        <span className="min-w-0 truncate font-display text-[15px] font-semibold text-text-primary">
          {t("chat.sidebar.title")}
        </span>
        <div className="flex shrink-0 items-center text-text-muted">
          {!scope && (
            <div
              role="group"
              aria-label={t("chat.sidebar.viewLabel")}
              className={cn(segmentedGroupClass, "mr-0.5")}
            >
              {sidebarViewOptions.map(({ key, label, Icon }) => (
                <Tooltip key={key} label={label} side="bottom">
                  <button
                    type="button"
                    onClick={() => onSidebarViewChange(key)}
                    className={cn(
                      segmentedItemClass,
                      "flex items-center px-[5px] py-[3px]",
                      sidebarView === key && segmentedItemActiveClass,
                    )}
                    aria-label={label}
                    aria-pressed={sidebarView === key}
                  >
                    <Icon size={14} strokeWidth={1.5} />
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
          {!scope && (
            <IconButton
              size="sm"
              onClick={onCreateFolder}
              title={t("chat.folders.create")}
              aria-label={t("chat.folders.create")}
            >
              <FolderPlus size={18} strokeWidth={1.5} />
            </IconButton>
          )}
          {showCollapseToggle && (
            <IconButton
              size="sm"
              onClick={allFoldersCollapsed ? onExpandAll : onCollapseAll}
              title={
                allFoldersCollapsed
                  ? t("chat.sidebar.expandAll")
                  : t("chat.sidebar.collapseAll")
              }
              aria-label={
                allFoldersCollapsed
                  ? t("chat.sidebar.expandAll")
                  : t("chat.sidebar.collapseAll")
              }
            >
              {allFoldersCollapsed ? (
                <ChevronsUpDown size={18} strokeWidth={1.5} />
              ) : (
                <ChevronsDownUp size={18} strokeWidth={1.5} />
              )}
            </IconButton>
          )}
        </div>
      </div>

      {/* new chat: the primary action gets a full-width button above the
          search; the dashed twin next to it starts an incognito chat */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <Tooltip
          label={t("chat.newConversation")}
          shortcut="chat:new"
          side="bottom"
        >
          <button
            type="button"
            onClick={onNew}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control bg-bg-tertiary px-3 py-2 text-[13px] font-medium text-text-primary transition-colors cursor-pointer hover:bg-surface-3"
          >
            <SquarePen size={16} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{t("chat.newConversation")}</span>
          </button>
        </Tooltip>
        {onNewTemporary && (
          <Tooltip label={t("chat.temporary.new")} side="bottom">
            <button
              type="button"
              onClick={onNewTemporary}
              aria-label={t("chat.temporary.new")}
              className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-control bg-bg-tertiary text-text-muted transition-colors cursor-pointer hover:bg-surface-3 hover:text-text-primary"
            >
              <MessageSquareDashed size={16} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* conversation search, hidden when there's nothing to search */}
      {showSearch && (
        <div className="relative">
          <Search
            size={15}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted-2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("chat.searchPlaceholder")}
            aria-label={t("chat.searchPlaceholder")}
            className={cn(fieldClass, "pl-9 pr-8 text-[13px]")}
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label={t("common.cancel")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
