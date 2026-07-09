import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ExternalLink,
  FolderInput,
  Globe,
  Video,
  Trash2,
} from "lucide-react";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import { useResourceStore } from "@/stores/resource-store";
import { displayHost } from "@/lib/resource-url";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { Resource } from "@/types/resource";
import type { ListColumnWidths } from "../useLibraryPrefs";
import { DEFAULT_LIST_COLUMN_WIDTHS } from "../useLibraryPrefs";
import { FolderPickerModal } from "../modals/FolderPickerModal";
import { ContextMenu, MenuItem } from "./MenuButton";
import { formatDate, type RowDensity } from "./helpers";

interface ResourceRowProps {
  resource: Resource;
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

/** List-view row for a saved web page / YouTube link (beta). Same layout as
 *  the other node rows; opens the resource viewer at /resources/:id. */
export function ResourceRow({
  resource,
  depth = 0,
  selected,
  selectionActive,
  onToggleSelect,
  density = { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" },
  sortableId,
  columnWidths = DEFAULT_LIST_COLUMN_WIDTHS,
}: ResourceRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveResourceToFolder = useResourceStore((s) => s.moveResourceToFolder);
  const deleteResource = useResourceStore((s) => s.deleteResource);

  const isTopLevel = depth === 0;
  const sortable = useSortable({
    id: sortableId ?? `resource:${resource.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `resource:${resource.id}`,
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

  const dragActive = useDndContext().active != null;
  const cvStyle = dragActive
    ? null
    : { contentVisibility: "auto" as const, containIntrinsicSize: "auto 48px" };

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const isYoutube = resource.kind === "youtube";
  const Icon = isYoutube ? Video : Globe;
  const selKey = `resource:${resource.id}`;
  const title = resource.title || displayHost(resource.url);
  const kindLabel = isYoutube
    ? t("library.resource.kindYoutube", { defaultValue: "YouTube" })
    : t("library.resource.kindWeb", { defaultValue: "Web" });
  const indent = Math.min(depth * 20, 80);

  const open = () => {
    navigate(`/resources/${resource.id}`);
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
      label: t("library.resource.open", { defaultValue: "Open resource" }),
      icon: ExternalLink,
      onClick: open,
    },
    {
      id: "move",
      label: t("library.actions.moveToFolder"),
      icon: FolderInput,
      onClick: () => setMoveOpen(true),
    },
    { id: "div-1", divider: true },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () =>
        void deleteResource(resource.id).catch((err) =>
          logError("library:deleteResource", err),
        ),
    },
  ]);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...cvStyle,
      }}
      {...attributes}
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          "group flex select-none items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
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

        {/* Icon — web globe / youtube glyph. */}
        <div className="mr-2.5 flex h-8 w-7 shrink-0 items-center justify-center sm:h-9">
          <Icon size={density.icon + 4} className="text-sky-400" />
        </div>

        <span
          className={cn("min-w-0 flex-1 truncate font-medium text-text-primary", density.text)}
          title={title}
        >
          {title}
        </span>

        <span className="mr-2 hidden items-center gap-1 rounded bg-sky-400/20 px-1.5 py-0.5 text-2xs font-semibold text-sky-400 sm:inline-flex">
          <Icon size={9} />
          {kindLabel}
        </span>
        <span className="mr-2 hidden rounded bg-glass-bg px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-text-muted sm:inline-flex">
          {t("library.resource.beta", { defaultValue: "Beta" })}
        </span>

        {/* Menu — placed right after the name. */}
        <div className="relative mr-2 shrink-0">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            <MenuItem
              icon={ExternalLink}
              label={t("library.resource.open", { defaultValue: "Open resource" })}
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
              icon={Trash2}
              label={t("common.delete")}
              danger
              onClick={() => {
                setMenuOpen(false);
                void deleteResource(resource.id).catch((err) =>
                  logError("library:deleteResource", err),
                );
              }}
            />
          </ContextMenu>
        </div>

        {/* Size — n/a for resources. */}
        <span
          className="mr-2 hidden shrink-0 truncate text-sm text-text-secondary lg:block"
          style={{ width: columnWidths.size }}
        >
          —
        </span>

        {/* Date */}
        <span
          className="mr-2 hidden shrink-0 truncate text-sm text-text-secondary lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(resource.updated_at)}
        </span>
      </div>

      <FolderPickerModal
        open={moveOpen}
        folders={folders}
        currentFolderId={resource.folder_id}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          void moveResourceToFolder(resource.id, folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
