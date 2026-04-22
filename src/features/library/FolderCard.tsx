import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Folder, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, GlassCard } from "@/components/ui";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const selKey = `folder:${folder.id}`;
  const iconSize = Math.round(Math.min(Math.max(coverHeight * 0.35, 24), 48));
  // Mirror LibraryBookCard's compact threshold so both cards share
  // the exact same layout heights in the grid.
  const compact = coverHeight < 100;

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

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
      <GlassCard
        className={cn(
          "group relative cursor-pointer overflow-hidden",
          selected && "ring-2 ring-accent-purple bg-accent-purple/5",
          isDragging && "opacity-50",
        )}
      >
        <div onClick={handleClick}>
          {/* Selection checkbox */}
          {onToggleSelect && (
            <div
              className={cn(
                "absolute left-2 top-2 z-10 transition-opacity",
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

          {/* Icon area — same height as LibraryBookCard's cover. */}
          <div
            className="flex w-full items-center justify-center"
            style={{ height: coverHeight }}
          >
            <Folder size={iconSize} className="text-accent-purple/60" />
          </div>

          {/* Info section — mirrors LibraryBookCard so folder tiles and
              book tiles end up the same total height in the grid. */}
          <div className={cn("p-3", compact && "p-2")}>
            <h3
              className={cn(
                "mb-0.5 truncate font-semibold text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {folder.name}
            </h3>
            <p
              className={cn(
                "truncate text-text-muted",
                compact ? "text-[10px]" : "text-xs",
              )}
            >
              {t("library.folderCard.folderLabel")}
            </p>
          </div>
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} className="absolute right-2 top-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={cn(
              "rounded-lg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
              menuOpen
                ? "opacity-100"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
            )}
          >
            <MoreVertical size={16} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-lg backdrop-blur-xl">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  const name = prompt(
                    t("library.folderCard.renamePrompt"),
                    folder.name,
                  );
                  if (name && name.trim()) onRename(folder.id, name.trim());
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
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
