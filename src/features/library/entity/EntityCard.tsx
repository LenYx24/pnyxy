import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreVertical } from "lucide-react";
import { Checkbox, FloatingMenu } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { FolderPickerModal } from "../modals/FolderPickerModal";
import type { EntityDescriptor } from "./descriptors";
import {
  buildMenuActions,
  makeSelectAwareClick,
  toContextEntries,
  type ToggleSelect,
} from "./shell";

export interface EntityCardProps {
  sortableId?: string;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: ToggleSelect;
}

/**
 * Grid card shared by every non-book library entity (note, quiz, chat,
 * whiteboard, resource). Mirrors LibraryBookCard's cover + label +
 * 3-dot-menu structure; what differs per type comes from the descriptor
 * (cover content, badge, subtitle, open route, extra menu actions).
 * Move / delete are self-contained so the card can drop into the grid
 * without threading handlers through LibraryPage.
 */
export function EntityCard({
  descriptor: d,
  sortableId,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: EntityCardProps & { descriptor: EntityDescriptor }) {
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);

  const sortable = useSortable({
    id: sortableId ?? d.id,
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

  const compact = coverHeight < 100;
  const intrinsicHeight = coverHeight + 80;
  const glyphSize = Math.round(Math.min(Math.max(coverHeight * 0.32, 24), 48));

  const handleClick = makeSelectAwareClick(
    d.selKey,
    selectionActive,
    onToggleSelect,
    d.open,
  );

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
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${intrinsicHeight}px`,
      }}
      {...attributes}
      {...listeners}
    >
      <div
        {...contextHandlers}
        className={cn(
          "group relative",
          selected && "ring-2 ring-accent rounded-md",
          isDragging && "opacity-50",
        )}
      >
        <div onClick={handleClick} title={d.title} className="cursor-pointer">
          <div
            className={cn(
              "relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border shadow-sm transition-shadow group-hover:shadow-md",
              d.card.tintClass,
            )}
          >
            {d.card.renderCover(glyphSize)}

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
                    onToggleSelect(d.selKey, { ctrlKey: false, shiftKey: false })
                  }
                />
              </div>
            )}

            {d.card.badge}
          </div>

          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-semibold leading-tight text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {d.title}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-2xs" : "text-xs",
              )}
            >
              {d.card.subtitle}
            </p>
          </div>
        </div>

        {/* 3-dot menu */}
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
            {menuActions.map((a) => (
              <button
                key={a.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  a.onClick();
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-glass-hover cursor-pointer",
                  a.danger
                    ? "text-danger"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <a.icon size={14} />
                {a.label}
              </button>
            ))}
          </FloatingMenu>
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
