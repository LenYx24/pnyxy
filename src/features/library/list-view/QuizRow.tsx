import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Download,
  FolderInput,
  GripVertical,
  ListChecks,
  Pencil,
  Trash2,
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import { useQuizStore } from "@/stores/quiz-store";
import { downloadQuizGift } from "@/lib/library/export-quiz";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { Quiz } from "@/types/quiz";
import type { ListColumnWidths } from "../useLibraryPrefs";
import { DEFAULT_LIST_COLUMN_WIDTHS } from "../useLibraryPrefs";
import { FolderPickerModal } from "../modals/FolderPickerModal";
import { ContextMenu, MenuItem } from "./MenuButton";
import { formatDate, type RowDensity } from "./helpers";

interface QuizRowProps {
  quiz: Quiz;
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

/** List-view row for a quiz. Same layout as BookRow/NoteRow; opens the
 *  quiz detail route, exports GIFT, moves/deletes self-contained. */
export function QuizRow({
  quiz,
  depth = 0,
  selected,
  selectionActive,
  onToggleSelect,
  density = { py: "py-2.5", text: "text-sm", icon: 16, gap: "gap-2" },
  sortableId,
  columnWidths = DEFAULT_LIST_COLUMN_WIDTHS,
}: QuizRowProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const deleteQuiz = useQuizStore((s) => s.deleteQuiz);
  const getQuiz = useQuizStore((s) => s.getQuiz);

  const isTopLevel = depth === 0;
  const sortable = useSortable({
    id: sortableId ?? `quiz:${quiz.id}`,
    disabled: !isTopLevel,
  });
  const draggable = useDraggable({
    id: `quiz:${quiz.id}`,
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

  const selKey = `quiz:${quiz.id}`;
  const title = quiz.title.trim() || t("library.allBooks.untitledQuiz");
  const indent = Math.min(depth * 20, 80);

  const open = () => navigate(`/quizzes/${quiz.id}`);

  const handleExport = async () => {
    try {
      const full = await getQuiz(quiz.id);
      if (full) downloadQuizGift(full.quiz, full.questions);
    } catch (err) {
      logError("library:exportQuizGift", err);
    }
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
      label: t("library.allBooks.openQuiz"),
      icon: ListChecks,
      onClick: open,
    },
    {
      id: "edit",
      label: t("library.actions.rename", { defaultValue: "Edit" }),
      icon: Pencil,
      onClick: () => navigate(`/quizzes/${quiz.id}/edit`),
    },
    {
      id: "move",
      label: t("library.actions.moveToFolder"),
      icon: FolderInput,
      onClick: () => setMoveOpen(true),
    },
    {
      id: "export",
      label: t("library.actions.exportGift"),
      icon: Download,
      onClick: () => void handleExport(),
    },
    { id: "div-1", divider: true },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () => void deleteQuiz(quiz.id),
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
          selected && "bg-accent/10",
          isDragging && "opacity-50",
        )}
        style={{ paddingLeft: 8 + indent }}
        onClick={handleClick}
      >
        <div className="mr-1 shrink-0 text-text-muted/50" aria-hidden="true">
          <GripVertical size={14} />
        </div>

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

        <div className="mr-1 hidden w-[26px] sm:block" />

        <div className="mr-2.5 flex aspect-[5/7] h-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-gradient-to-br from-warning/20 to-accent/20 sm:h-9">
          <ListChecks size={14} className="text-warning/80" />
        </div>

        <span
          className={cn("min-w-0 flex-1 truncate text-text-primary", density.text)}
          title={title}
        >
          {title}
        </span>

        <span className="mr-2 hidden items-center gap-1 rounded bg-warning/20 px-1.5 py-0.5 text-2xs font-semibold text-warning sm:inline-flex">
          <ListChecks size={9} />
          {t("library.allBooks.quizLabel")}
        </span>

        {/* Author column → question count for quizzes. */}
        <span
          className="mr-4 hidden shrink-0 truncate text-xs text-text-muted md:block"
          style={{ width: columnWidths.author }}
        >
          {t("library.allBooks.quizQuestionCount", { count: quiz.question_count })}
        </span>

        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.size }}
        >
          —
        </span>

        <span
          className="mr-2 hidden shrink-0 truncate text-xs text-text-muted lg:block"
          style={{ width: columnWidths.added }}
        >
          {formatDate(quiz.updated_at)}
        </span>

        <ContextMenu open={menuOpen} onToggle={() => setMenuOpen((v) => !v)}>
          <MenuItem
            icon={ListChecks}
            label={t("library.allBooks.openQuiz")}
            onClick={() => {
              setMenuOpen(false);
              open();
            }}
          />
          <MenuItem
            icon={Pencil}
            label={t("library.actions.rename", { defaultValue: "Edit" })}
            onClick={() => {
              setMenuOpen(false);
              navigate(`/quizzes/${quiz.id}/edit`);
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
            label={t("library.actions.exportGift")}
            onClick={() => {
              setMenuOpen(false);
              void handleExport();
            }}
          />
          <MenuItem
            icon={Trash2}
            label={t("common.delete")}
            danger
            onClick={() => {
              setMenuOpen(false);
              void deleteQuiz(quiz.id);
            }}
          />
        </ContextMenu>
      </div>

      <FolderPickerModal
        open={moveOpen}
        folders={folders}
        currentFolderId={quiz.folder_id}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          void moveQuizToFolder(quiz.id, folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
