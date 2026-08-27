import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useDndContext } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, PromptModal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { Folder as FolderType } from "@/types/database";
import { ContextMenu, MenuItem } from "./MenuButton";
import { RowTile } from "./RowTile";
import { NEST_TARGET_CLASS, useDropIntent } from "../drag-intent";
import { DropIndicator } from "../DropIndicator";
import {
  LIST_GRID_CLASS,
  ROW_ACTIVE_CLASS,
  ROW_BASE_CLASS,
  ROW_FOCUS_CLASS,
  ROW_SEPARATOR_CLASS,
  formatRelative,
  handleRowKeyDown,
} from "./helpers";

interface FolderRowProps {
  folder: FolderType;
  /** Number of direct children (folders + every item type). */
  itemCount: number;
  onNavigate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  selected: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  /** Open the create-folder modal with this folder as parent. */
  onCreateSubfolder?: (parentFolderId: string) => void;
  sortableId?: string;
}

/**
 * Folder row at the top of the list. Click navigates into the folder.
 * While dragging, the middle 50% of the row nests the item (highlight),
 * the top / bottom quarters reorder (insertion line); the zone is
 * decided in AllBooksTab from the pointer position.
 */
export function FolderRow({
  folder,
  itemCount,
  onNavigate,
  onRename,
  onDelete,
  selected,
  onToggleSelect,
  onCreateSubfolder,
  sortableId,
}: FolderRowProps) {
  const { t } = useTranslation();

  const {
    setNodeRef,
    attributes,
    listeners,
    isDragging,
    transform,
    transition,
  } = useSortable({ id: sortableId ?? `folder:${folder.id}` });
  // before / after: insertion line at the edge, inside: nest highlight
  const dropPosition = useDropIntent(sortableId ?? `folder:${folder.id}`);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // content-visibility:auto collapses offscreen rects, which breaks dnd-kit
  // collision detection mid-drag. Disable it while a drag is active.
  const dragActive = useDndContext().active != null;
  const cvStyle = dragActive
    ? null
    : { contentVisibility: "auto" as const, containIntrinsicSize: "auto 58px" };

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const selKey = `folder:${folder.id}`;
  const open = () => onNavigate(folder.id);
  const toggle = (e?: { ctrlKey: boolean; shiftKey: boolean }) =>
    onToggleSelect(selKey, e ?? { ctrlKey: false, shiftKey: false });

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggle({ ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    open();
  };

  // Items built lazily so they capture fresh callbacks when the menu opens.
  const contextHandlers = useContextMenu((): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      {
        id: "open",
        label: t("library.folderCard.open"),
        icon: FolderOpen,
        onClick: open,
      },
      {
        id: "rename",
        label: t("library.folderCard.rename"),
        icon: Pencil,
        onClick: () => setRenameOpen(true),
      },
    ];
    if (onCreateSubfolder) {
      items.push({
        id: "new-subfolder",
        label: t("library.folderCard.newSubfolder"),
        icon: FolderPlus,
        onClick: () => onCreateSubfolder(folder.id),
      });
    }
    items.push(
      { id: "div-1", divider: true },
      {
        id: "delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onClick: () => onDelete(folder.id),
      },
    );
    return items;
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...cvStyle,
      }}
      {...attributes}
      data-list-row=""
      onKeyDown={(e) =>
        handleRowKeyDown(e, { onOpen: open, onToggleSelect: () => toggle() })
      }
      className={ROW_FOCUS_CLASS}
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          LIST_GRID_CLASS,
          ROW_BASE_CLASS,
          ROW_SEPARATOR_CLASS,
          "relative",
          selected && ROW_ACTIVE_CLASS,
          isDragging && "opacity-40",
          dropPosition === "inside" && NEST_TARGET_CLASS,
        )}
        onClick={handleClick}
      >
        <DropIndicator position={dropPosition} orientation="row" />

        {/* Checkbox */}
        <div
          className={cn(
            "flex items-center transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox checked={selected} onChange={() => toggle()} />
        </div>

        {/* Name (inline glyph, one line) */}
        <div className="flex min-w-0 items-center gap-2.5">
          <RowTile kind="folder" />
          <span className="truncate font-medium text-text-primary">
            {folder.name}
          </span>
        </div>

        {/* Type */}
        <span className="hidden truncate text-text-muted md:block">
          {t("library.allBooks.folderLabel")}
        </span>

        {/* Item count in its own column (the progress slot) */}
        <span className="hidden truncate text-text-muted md:block">
          {t("library.list.itemCount", { count: itemCount })}
        </span>

        {/* Modified */}
        <span className="hidden truncate text-text-muted md:block">
          {formatRelative(folder.created_at, t)}
        </span>

        {/* Menu */}
        <div className="relative flex justify-end">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={Pencil}
              label={t("library.folderCard.rename")}
              onClick={() => {
                setMenuOpen(false);
                setRenameOpen(true);
              }}
            />
            {onCreateSubfolder && (
              <MenuItem
                icon={FolderPlus}
                label={t("library.folderCard.newSubfolder")}
                onClick={() => {
                  setMenuOpen(false);
                  onCreateSubfolder(folder.id);
                }}
              />
            )}
            <MenuItem
              icon={Trash2}
              label={t("common.delete")}
              danger
              onClick={() => {
                setMenuOpen(false);
                onDelete(folder.id);
              }}
            />
          </ContextMenu>
        </div>
      </div>

      <PromptModal
        open={renameOpen}
        title={t("library.folderCard.rename")}
        defaultValue={folder.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => onRename(folder.id, name)}
      />
    </div>
  );
}
