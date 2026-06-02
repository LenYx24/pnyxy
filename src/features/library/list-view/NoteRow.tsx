import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Download,
  FileText,
  FolderInput,
  GripVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore, type Note } from "@/stores/note-store";
import { downloadNoteMarkdown } from "@/lib/library/export-note";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { ListColumnWidths } from "../useLibraryPrefs";
import { DEFAULT_LIST_COLUMN_WIDTHS } from "../useLibraryPrefs";
import { FolderPickerModal } from "../modals/FolderPickerModal";
import { ContextMenu, MenuItem } from "./MenuButton";
import { formatDate, type RowDensity } from "./helpers";

interface NoteRowProps {
  note: Note;
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

/**
 * List-view row for a note. Mirrors BookRow's layout (drag handle,
 * checkbox, chevron spacer, icon, title, the Author/Size/Date columns,
 * 3-dot menu) so notes line up with books in the mixed file list. The
 * "cover" is a document glyph and the row opens the standalone
 * `/notes/:id` editor; move / export / delete are self-contained.
 */
export function NoteRow({
  note,
  depth = 0,
  selected,
  selectionActive,
  onToggleSelect,
  density = { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" },
  sortableId,
  columnWidths = DEFAULT_LIST_COLUMN_WIDTHS,
}: NoteRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveNoteToFolder = useNoteStore((s) => s.moveNoteToFolder);
  const deleteNote = useNoteStore((s) => s.deleteNote);

  const isTopLevel = depth === 0;
  // Top-level: sortable (sibling reorder). Nested: draggable only —
  // identical drag UX without joining a sortable list. Mirrors BookRow.
  const sortable = useSortable({
    id: sortableId ?? `note:${note.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `note:${note.id}`,
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

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const selKey = `note:${note.id}`;
  const title = note.title.trim() || t("library.allBooks.untitledNote");
  const indent = Math.min(depth * 20, 80);

  const open = () => navigate(`/notes/${note.id}`);

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
    { id: "open", label: t("library.allBooks.openNote"), icon: Pencil, onClick: open },
    {
      id: "move",
      label: t("library.actions.moveToFolder"),
      icon: FolderInput,
      onClick: () => setMoveOpen(true),
    },
    {
      id: "export",
      label: t("library.actions.exportMarkdown"),
      icon: Download,
      onClick: () => downloadNoteMarkdown(note),
    },
    { id: "div-1", divider: true },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () => deleteNote(note.id),
    },
  ]);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 48px",
      }}
      {...attributes}
    >
      <div
        {...contextHandlers}
        {...listeners}
        className={cn(
          "group flex select-none items-center border-b border-glass-border/30 px-2 transition-colors hover:bg-glass-hover cursor-pointer sm:px-3",
          density.py,
          selected && "bg-accent-purple/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        {/* Drag handle */}
        <div className="mr-1 shrink-0 text-text-muted/50" aria-hidden="true">
          <GripVertical size={14} />
        </div>

        {/* Checkbox */}
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

        {/* Spacer matching the chevron column in folder rows */}
        <div className="mr-1 hidden w-[26px] sm:block" />

        {/* Icon "cover" — note glyph in a tinted 5:7 tile, same footprint
            as BookRow's mini-cover so titles align across row types. */}
        <div className="mr-2.5 flex aspect-[5/7] h-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-gradient-to-br from-accent-blue/20 to-accent-purple/20 sm:h-9">
          <FileText size={14} className="text-accent-blue/70" />
        </div>

        {/* Title */}
        <span
          className={cn("min-w-0 flex-1 truncate text-text-primary", density.text)}
          title={title}
        >
          {title}
        </span>

        {/* "Note" type tag, mirroring BookRow's Uploaded pill. */}
        <span className="mr-2 hidden items-center gap-1 rounded bg-accent-blue/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-blue sm:inline-flex">
          <Pencil size={9} />
          {t("library.allBooks.noteLabel")}
        </span>

        {/* Author column — notes have no author. */}
        <span
          className="mr-4 hidden shrink-0 truncate text-xs text-text-muted md:block"
          style={{ width: columnWidths.author }}
          aria-hidden="true"
        />

        {/* Size column — n/a for notes. */}
        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.size }}
        >
          —
        </span>

        {/* Date — last updated. */}
        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(new Date(note.updatedAt).toISOString())}
        </span>

        {/* Menu */}
        <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
          <MenuItem
            icon={Pencil}
            label={t("library.allBooks.openNote")}
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
            icon={Download}
            label={t("library.actions.exportMarkdown")}
            onClick={() => {
              setMenuOpen(false);
              downloadNoteMarkdown(note);
            }}
          />
          <MenuItem
            icon={Trash2}
            label={t("common.delete")}
            danger
            onClick={() => {
              setMenuOpen(false);
              deleteNote(note.id);
            }}
          />
        </ContextMenu>
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
