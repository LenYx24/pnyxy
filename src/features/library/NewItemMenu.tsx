import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Plus,
  FolderPlus,
  FileText,
  Shapes,
  ListChecks,
  MessageSquare,
} from "lucide-react";
import { Button, FloatingMenu } from "@/components/ui";
import { logError } from "@/lib/logger";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useQuizStore } from "@/stores/quiz-store";
import { useChatStore } from "@/stores/chat-store";

interface NewItemMenuProps {
  /** Folder the new item is created into (null = library root). */
  currentFolderId: string | null;
  /** Opens the create-folder modal (owned by AllBooksTab). */
  onNewFolder?: () => void;
}

/**
 * "New ▸" menu in the library toolbar. Creates a note / whiteboard /
 * quiz / chat directly into the folder the user is currently viewing,
 * then opens its editor — so items can be born where they live instead
 * of created elsewhere and dragged in. Folder creation is included for
 * completeness (delegated to AllBooksTab's modal).
 */
export function NewItemMenu({ currentFolderId, onNewFolder }: NewItemMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // FloatingMenu anchors to this span — the Button component doesn't
  // forward refs, so we wrap it (same pattern as LibraryAddMenu).
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const createNote = useNoteStore((s) => s.createNote);
  const createWhiteboard = useWhiteboardStore((s) => s.createWhiteboard);
  const createQuiz = useQuizStore((s) => s.createQuiz);
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const createConversation = useChatStore((s) => s.createConversation);

  const close = () => setOpen(false);

  const newNote = () => {
    close();
    const id = createNote(currentFolderId);
    navigate(`/notes/${id}`);
  };

  const newWhiteboard = () => {
    close();
    const id = createWhiteboard({ folderId: currentFolderId });
    navigate(`/whiteboards/${id}`);
  };

  const newChat = () => {
    close();
    void (async () => {
      try {
        const id = await createConversation("", currentFolderId);
        if (id) navigate("/chat");
      } catch (err) {
        logError("library:newChat", err);
      }
    })();
  };

  const newQuiz = () => {
    close();
    void (async () => {
      try {
        // createQuiz can't set a folder directly, so create the (empty)
        // quiz then move it into the current folder before opening the
        // editor. Title is a placeholder the editor immediately lets
        // the user replace.
        const id = await createQuiz({
          title: t("library.allBooks.untitledQuiz"),
          description: null,
          visibility: "private",
          uploaded_book_id: null,
          catalog_book_id: null,
          questions: [],
        });
        if (!id) return;
        if (currentFolderId) await moveQuizToFolder(id, currentFolderId);
        navigate(`/quizzes/${id}/edit`);
      } catch (err) {
        logError("library:newQuiz", err);
      }
    })();
  };

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Button
          variant="secondary"
          className="gap-1 px-2 py-1.5 text-xs"
          onClick={() => setOpen((v) => !v)}
          title={t("library.allBooks.new")}
        >
          <Plus size={14} />
          <span className="hidden sm:inline">{t("library.allBooks.new")}</span>
        </Button>
      </span>
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        className="w-44"
      >
        {onNewFolder && (
          <NewMenuItem
            icon={FolderPlus}
            label={t("library.allBooks.newFolder")}
            onClick={() => {
              close();
              onNewFolder();
            }}
          />
        )}
        <NewMenuItem
          icon={FileText}
          label={t("library.allBooks.noteLabel")}
          onClick={newNote}
        />
        <NewMenuItem
          icon={Shapes}
          label={t("library.allBooks.whiteboardLabel")}
          onClick={newWhiteboard}
        />
        <NewMenuItem
          icon={ListChecks}
          label={t("library.allBooks.quizLabel")}
          onClick={newQuiz}
        />
        <NewMenuItem
          icon={MessageSquare}
          label={t("library.allBooks.chatLabel")}
          onClick={newChat}
        />
      </FloatingMenu>
    </>
  );
}

function NewMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      <Icon size={14} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}
