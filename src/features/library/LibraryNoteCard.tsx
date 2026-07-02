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
  FileText,
  Pencil,
} from "lucide-react";
import { Checkbox, FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";
import { noteDisplayTitle } from "@/lib/entity-title";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore, type Note } from "@/stores/note-store";
import { downloadNoteMarkdown } from "@/lib/library/export-note";
import { FolderPickerModal } from "./modals/FolderPickerModal";

/** Strip the markdown down to a plain-text snippet for the card
 *  preview — drops code/links/heading markers but keeps line breaks so
 *  the thumbnail reads like a page of text. */
function noteSnippet(md: string, max = 300): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\s|-]+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

interface LibraryNoteCardProps {
  note: Note;
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
 * Grid card for a note in the library filetree. Mirrors LibraryBookCard's
 * cover + label + 3-dot-menu structure, but the "cover" is an icon tile
 * (notes have no artwork) and the click target is the standalone
 * `/notes/:id` editor route. Move / export / delete are self-contained
 * so the card can drop into the grid without threading new handlers
 * through LibraryPage.
 */
export function LibraryNoteCard({
  note,
  sortableId,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: LibraryNoteCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveNoteToFolder = useNoteStore((s) => s.moveNoteToFolder);
  const deleteNote = useNoteStore((s) => s.deleteNote);

  const sortable = useSortable({
    id: sortableId ?? note.id,
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

  const title = noteDisplayTitle(note, t);
  const notePreview = note.content ? noteSnippet(note.content) : "";
  const selKey = `note:${note.id}`;
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
    navigate(`/notes/${note.id}`);
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
          {/* Cover — a faint snippet of the note's own text reads as a
              document preview when there's content, falling back to a
              small glyph for an empty note. The corner badge below
              still marks the item type. */}
          <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-accent-blue/10 shadow-sm transition-shadow group-hover:shadow-md">
            {notePreview ? (
              <p className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-2 text-left text-[8px] leading-snug text-text-secondary/70">
                {notePreview}
              </p>
            ) : (
              <FileText
                size={Math.round(Math.min(Math.max(coverHeight * 0.32, 24), 48))}
                className="text-accent-blue/70"
              />
            )}

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

            {/* Corner glyph marking this tile as a note, mirroring the
                uploaded-book indicator on book cards. */}
            <span
              className="absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 text-accent-blue backdrop-blur-sm"
              title={t("library.allBooks.noteLabel")}
            >
              <Pencil size={10} />
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
              {t("library.allBooks.noteLabel")}
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                navigate(`/notes/${note.id}`);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Pencil size={14} />
              {t("library.allBooks.openNote")}
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
                downloadNoteMarkdown(note);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Download size={14} />
              {t("library.actions.exportMarkdown")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                deleteNote(note.id);
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
        currentFolderId={note.folderId}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          moveNoteToFolder(note.id, folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
