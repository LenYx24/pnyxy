import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, FloatingMenu, PromptModal } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Folder as FolderType } from "@/types/database";

interface FolderCardProps {
  folder: FolderType;
  onNavigate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => void;
  sortableId?: string;
}

export function FolderCard({
  folder,
  onNavigate,
  onRename,
  onDelete,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  sortableId,
}: FolderCardProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId ?? folder.id, disabled: !sortableId });

  const style = sortableId
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selKey = `folder:${folder.id}`;
  // coverHeight is now only used as a hint for icon scaling — the
  // icon container itself is sized via aspect-[5/7] w-full to match
  // LibraryBookCard exactly. The actual rendered height comes from
  // the grid cell width × 1.4, same formula books use.
  const iconSize = Math.round(Math.min(Math.max(coverHeight * 0.35, 24), 48));
  const compact = coverHeight < 100;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    onNavigate(folder.id);
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {/* Outer layout mirrors LibraryBookCard: a bordered, 5:7
          aspect "cover" with metadata sitting below it (mt-2). This
          way folders and books occupy identical grid cells. */}
      <div
        className={cn(
          "group relative",
          selected && "ring-2 ring-accent-purple rounded-md",
          isDragging && "opacity-50",
        )}
      >
        <div
          onClick={handleClick}
          title={folder.name}
          className="cursor-pointer"
        >
          {/* Icon area — 5:7 aspect to match book covers. */}
          <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-bg-tertiary shadow-sm transition-shadow group-hover:shadow-md">
            <Folder
              size={iconSize}
              className="text-accent-purple/60 transition-transform group-hover:scale-[1.02]"
            />

            {/* Selection checkbox — sits on the cover so it shows
                cleanly on dark backgrounds, same as books. */}
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
                  onChange={() => onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })}
                />
              </div>
            )}
          </div>

          {/* Info — same mt-2 / mt-1.5 + truncate as LibraryBookCard
              so heights line up to the pixel. */}
          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-semibold leading-tight text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {folder.name}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-[10px]" : "text-xs",
              )}
            >
              {t("library.folderCard.folderLabel")}
            </p>
          </div>
        </div>

        {/* 3-dot menu — sits over the cover. */}
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
            className="w-40"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setRenameOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Pencil size={14} />
              {t("library.folderCard.rename")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(folder.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <Trash2 size={14} />
              {t("library.folderCard.delete")}
            </button>
          </FloatingMenu>
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
