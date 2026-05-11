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
  // Folder cards visually break from the book-cover ratio: a
  // square icon container (aspect-square, not 5:7) reads as a
  // proper "folder" rather than a placeholder for a missing book
  // cover. The icon scales to roughly half the square's width so
  // it has comfortable padding on all sides and centers cleanly.
  const iconSize = Math.round(Math.min(Math.max(coverHeight * 0.55, 40), 72));
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

  // Matches LibraryBookCard's content-visibility setup so the
  // grid skips layout/paint for offscreen folder tiles. Folder
  // cards are SQUARE now (icon area = card width), so the
  // intrinsic height is one card-width plus the ~56px label
  // block underneath. Books still use the 5:7 height; CSS Grid
  // rows align to whichever cell is tallest, so a mixed row
  // leaves a small gap under each folder — visually fine since
  // folders read as distinct items anyway.
  const intrinsicHeight = coverHeight + 56;
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
      {/* Outer layout: a square icon container (not 5:7 like book
          covers — folders look weird stretched into book shape) +
          a label block underneath. Grid rows that mix folders and
          books will have folders sitting taller-than-content, with
          a small gap below the label; visually fine since the
          shape difference makes folders read as distinct items.  */}
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
          {/* Square icon area, vertically centering the Folder SVG.
              Padding-y inside the square gives the icon breathing
              room so it never visually crowds the border. */}
          <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-bg-tertiary shadow-sm transition-shadow group-hover:shadow-md">
            <Folder
              size={iconSize}
              className="text-accent-purple/70 transition-transform group-hover:scale-[1.02]"
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
