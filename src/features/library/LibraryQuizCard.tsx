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
  ListChecks,
  Pencil,
} from "lucide-react";
import { Checkbox, FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import { useQuizStore } from "@/stores/quiz-store";
import { downloadQuizGift } from "@/lib/library/export-quiz";
import type { Quiz } from "@/types/quiz";
import { FolderPickerModal } from "./modals/FolderPickerModal";

interface LibraryQuizCardProps {
  quiz: Quiz;
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
 * Grid card for a quiz in the library filetree. Opens the quiz detail
 * route; export produces a GIFT (.gift) file — the questions are
 * fetched on demand since the card only holds the quiz row. Move /
 * delete are self-contained.
 */
export function LibraryQuizCard({
  quiz,
  sortableId,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: LibraryQuizCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const deleteQuiz = useQuizStore((s) => s.deleteQuiz);
  const getQuiz = useQuizStore((s) => s.getQuiz);

  const sortable = useSortable({
    id: sortableId ?? quiz.id,
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

  const title = quiz.title.trim() || t("library.allBooks.untitledQuiz");
  const selKey = `quiz:${quiz.id}`;
  const compact = coverHeight < 100;
  const intrinsicHeight = coverHeight + 80;

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
    navigate(`/quizzes/${quiz.id}`);
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
          <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-gradient-to-br from-warning/20 to-accent/20 shadow-sm transition-shadow group-hover:shadow-md">
            <ListChecks
              size={Math.round(Math.min(Math.max(coverHeight * 0.32, 24), 48))}
              className="text-warning/80"
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
              className="absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 text-warning backdrop-blur-sm"
              title={t("library.allBooks.quizLabel")}
            >
              <ListChecks size={10} />
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
              {t("library.allBooks.quizQuestionCount", {
                count: quiz.question_count,
              })}
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
                navigate(`/quizzes/${quiz.id}`);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ListChecks size={14} />
              {t("library.allBooks.openQuiz")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                navigate(`/quizzes/${quiz.id}/edit`);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Pencil size={14} />
              {t("library.actions.rename", { defaultValue: "Edit" })}
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
                void handleExport();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <Download size={14} />
              {t("library.actions.exportGift")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                void deleteQuiz(quiz.id);
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
