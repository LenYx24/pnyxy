import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDndContext, useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useContextMenu } from "@/hooks/use-context-menu";
import { FolderPickerModal } from "../modals/FolderPickerModal";
import { ContextMenu, MenuItem } from "../list-view/MenuButton";
import { RowTile } from "../list-view/RowTile";
import { useDropIntent } from "../drag-intent";
import { DropIndicator } from "../DropIndicator";
import {
  LIST_GRID_CLASS,
  ROW_ACTIVE_CLASS,
  ROW_BASE_CLASS,
  ROW_FOCUS_CLASS,
  ROW_SEPARATOR_CLASS,
  formatRelative,
  handleRowKeyDown,
} from "../list-view/helpers";
import type { EntityDescriptor } from "./descriptors";
import { buildMenuActions, toContextEntries, type ToggleSelect } from "./shell";

export interface EntityRowProps {
  depth?: number;
  selected: boolean;
  selectionActive: boolean;
  onToggleSelect: ToggleSelect;
  sortableId?: string;
}

/**
 * List-view row shared by every non-book library entity. Same column
 * grid as BookRow / FolderRow (checkbox, tile, name, type, progress,
 * modified, menu); the per-type bits come from the descriptor.
 */
export function EntityRow({
  descriptor: d,
  depth = 0,
  selected,
  onToggleSelect,
  sortableId,
}: EntityRowProps & { descriptor: EntityDescriptor }) {
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);

  const isTopLevel = depth === 0;
  // Top-level: sortable (sibling reorder). Nested: draggable only -
  // identical drag UX without joining a sortable list. Mirrors BookRow.
  const sortable = useSortable({
    id: sortableId ?? d.selKey,
    disabled: !isTopLevel,
  });
  // Namespaced id while disabled: a registered-but-unattached node
  // under the sortable's id would clobber its entry (see BookRow).
  const draggable = useDraggable({
    id: isTopLevel ? `unused:${d.selKey}` : d.selKey,
    disabled: isTopLevel,
  });
  const setNodeRef = isTopLevel ? sortable.setNodeRef : draggable.setNodeRef;
  const attributes = isTopLevel ? sortable.attributes : draggable.attributes;
  const listeners = isTopLevel ? sortable.listeners : draggable.listeners;
  const isDragging = isTopLevel ? sortable.isDragging : draggable.isDragging;
  const transform = isTopLevel ? sortable.transform : draggable.transform;
  const transition = isTopLevel ? sortable.transition : undefined;
  const dropPosition = useDropIntent(
    isTopLevel ? (sortableId ?? d.selKey) : undefined,
  );
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // content-visibility:auto skips off-screen rows for scroll perf, but
  // it collapses their measured rects, which breaks dnd-kit's collision
  // detection during a drag (the drop target resolves to the dragged row
  // itself, so nothing reorders). Disable it while any drag is in flight.
  const dragActive = useDndContext().active != null;
  const cvStyle = dragActive
    ? null
    : { contentVisibility: "auto" as const, containIntrinsicSize: "auto 58px" };

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const toggle = (e?: { ctrlKey: boolean; shiftKey: boolean }) =>
    onToggleSelect(d.selKey, e ?? { ctrlKey: false, shiftKey: false });

  // Modifier-click toggles selection, a plain click opens. Checkboxes
  // handle multi-select, so selection mode no longer hijacks plain clicks.
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggle({ ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    d.open();
  };

  const openMove = () => setMoveOpen(true);
  const contextHandlers = useContextMenu(() =>
    toContextEntries(buildMenuActions(d, t, openMove, d.openIcon)),
  );
  const menuActions = buildMenuActions(
    d,
    t,
    openMove,
    d.openMenuIcon ?? d.openIcon,
  );

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
        handleRowKeyDown(e, { onOpen: d.open, onToggleSelect: () => toggle() })
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

        <RowTile kind={d.row.tile} />

        {/* Name + subtitle */}
        <div className="flex min-w-0 flex-col gap-0.5" title={d.title}>
          <span className="truncate font-medium text-text-primary">
            {d.title}
          </span>
          {d.row.subtitle && (
            <span className="truncate text-xs text-text-muted">
              {d.row.subtitle}
            </span>
          )}
        </div>

        {/* Type */}
        <span className="hidden truncate text-text-muted md:block">
          {d.row.typeLabel}
        </span>

        {/* Progress column: free text for entities ("saved", counts). */}
        <span className="hidden truncate text-xs text-text-muted md:block">
          {d.row.progressText ?? ""}
        </span>

        {/* Modified */}
        <span className="hidden truncate text-text-muted md:block">
          {formatRelative(d.updatedAt, t)}
        </span>

        {/* Menu */}
        <div className="relative flex justify-end">
          <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
            {menuActions.map((a) => (
              <MenuItem
                key={a.id}
                icon={a.icon}
                label={a.label}
                danger={a.danger}
                onClick={() => {
                  setMenuOpen(false);
                  a.onClick();
                }}
              />
            ))}
          </ContextMenu>
        </div>
      </div>

      <FolderPickerModal
        open={moveOpen}
        folders={folders}
        currentFolderId={d.folderId}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          d.moveToFolder(folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
