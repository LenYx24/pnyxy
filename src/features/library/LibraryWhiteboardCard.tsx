import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MoreVertical,
  FolderInput,
  Trash2,
  Download,
  Shapes,
  PenLine,
} from "lucide-react";
import { Checkbox, FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { downloadWhiteboardJson } from "@/lib/library/export-whiteboard";
import type { WhiteboardData } from "@/types/whiteboard";
import { FolderPickerModal } from "./modals/FolderPickerModal";

interface LibraryWhiteboardCardProps {
  whiteboard: WhiteboardData;
  sortableId?: string;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
}

/**
 * Grid card for a whiteboard in the library filetree. Same shape as
 * LibraryNoteCard — icon-tile "cover", label, 3-dot menu — but opens
 * the existing `/whiteboards/:id` canvas route. Export is JSON (the
 * whiteboard's native portable form); move / delete are self-contained.
 */
export function LibraryWhiteboardCard({
  whiteboard,
  sortableId,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: LibraryWhiteboardCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveWhiteboardToFolder = useWhiteboardStore(
    (s) => s.moveWhiteboardToFolder,
  );
  const deleteWhiteboard = useWhiteboardStore((s) => s.deleteWhiteboard);

  const sortable = useSortable({
    id: sortableId ?? whiteboard.id,
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

  const title = whiteboard.title.trim() || t("library.allBooks.untitledWhiteboard");
  const selKey = `whiteboard:${whiteboard.id}`;
  const compact = coverHeight < 100;
  const intrinsicHeight = coverHeight + 80;

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    navigate(`/whiteboards/${whiteboard.id}`);
  };

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
        className={cn(
          "group relative",
          selected && "ring-2 ring-accent rounded-md",
          isDragging && "opacity-50",
        )}
      >
        <div onClick={handleClick} title={title} className="cursor-pointer">
          {/* Icon "cover" — a shapes glyph on a tinted tile, sized like
              the book covers so the grid stays even. */}
          <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-gradient-to-br from-success/20 to-accent-blue/20 shadow-sm transition-shadow group-hover:shadow-md">
            <Shapes
              size={Math.round(Math.min(Math.max(coverHeight * 0.32, 24), 48))}
              className="text-success/80"
            />

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
                    onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })
                  }
                />
              </div>
            )}

            <span
              className="absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 text-success backdrop-blur-sm"
              title={t("library.allBooks.whiteboardLabel")}
            >
              <PenLine size={10} />
            </span>
          </div>

          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-semibold leading-tight text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-2xs" : "text-xs",
              )}
            >
              {t("library.allBooks.whiteboardLabel")}
            </p>
          </div>
        </div>

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
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                navigate(`/whiteboards/${whiteboard.id}`);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Shapes size={14} />
              {t("library.allBooks.openWhiteboard")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setMoveOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderInput size={14} />
              {t("library.actions.moveToFolder")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                downloadWhiteboardJson(whiteboard);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Download size={14} />
              {t("library.actions.exportJson")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                deleteWhiteboard(whiteboard.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <Trash2 size={14} />
              {t("common.delete")}
            </button>
          </FloatingMenu>
        </div>
      </div>

      <FolderPickerModal
        open={moveOpen}
        folders={folders}
        currentFolderId={whiteboard.folderId ?? null}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          moveWhiteboardToFolder(whiteboard.id, folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
