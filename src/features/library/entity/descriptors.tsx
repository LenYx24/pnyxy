import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  Download,
  ExternalLink,
  FileText,
  Globe,
  ListChecks,
  MessageSquare,
  Pencil,
  PenLine,
  Shapes,
  Video,
} from "lucide-react";
import {
  conversationDisplayTitle,
  noteDisplayTitle,
  whiteboardDisplayTitle,
} from "@/lib/entity-title";
import { logError } from "@/lib/logger";
import { displayHost } from "@/lib/resource-url";
import { useNoteStore, type Note } from "@/stores/note-store";
import { useQuizStore } from "@/stores/quiz-store";
import { useChatStore } from "@/stores/chat-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useResourceStore } from "@/stores/resource-store";
import { downloadNoteMarkdown } from "@/lib/library/export-note";
import { downloadQuizGift } from "@/lib/library/export-quiz";
import { downloadConversationMarkdownById } from "@/lib/export-conversation";
import { downloadWhiteboardJson } from "@/lib/library/export-whiteboard";
import type { Quiz } from "@/types/quiz";
import type { ChatConversation } from "@/types/chat";
import type { WhiteboardData } from "@/types/whiteboard";
import type { Resource } from "@/types/resource";
import { WhiteboardThumbnail } from "../../whiteboard/WhiteboardThumbnail";
import { CardTypeBadge } from "./badges";
import type { RowTileKind } from "../list-view/RowTile";

export type EntityKind = "note" | "quiz" | "chat" | "whiteboard" | "resource";

export interface EntityAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

/**
 * Everything EntityCard / EntityRow need to render one library item.
 * Built per entity type by the use*Descriptor hooks below; the shared
 * move / delete menu entries are injected by the shell, so a descriptor
 * only lists what is specific to its type.
 */
export interface EntityDescriptor {
  kind: EntityKind;
  id: string;
  /** Selection / drag key, `${kind}:${id}`. */
  selKey: string;
  title: string;
  folderId: string | null;
  /** ISO timestamp for the list-view date column. */
  updatedAt: string;
  open: () => void;
  openLabel: string;
  /** Icon for the right-click "open" entry. */
  openIcon: LucideIcon;
  /** Icon for the 3-dot menu "open" entry (defaults to openIcon). */
  openMenuIcon?: LucideIcon;
  /** Optional entry between open and move (quiz "Edit"). */
  editAction?: EntityAction;
  /** Optional entry after move (export). */
  exportAction?: EntityAction;
  moveToFolder: (folderId: string | null) => void;
  remove: () => void;
  card: {
    tintClass: string;
    /** Cover content; `glyphSize` is the fallback icon size. */
    renderCover: (glyphSize: number) => ReactNode;
    badge: ReactNode;
    subtitle: string;
  };
  row: {
    /** Tile glyph kind for the shared RowTile. */
    tile: RowTileKind;
    /** Text for the type column ("Note", "Quiz", "Web"...). */
    typeLabel: string;
    /** Optional second line under the title. */
    subtitle?: string;
    /** Optional text for the progress column ("saved", "8 questions"). */
    progressText?: string;
  };
}

/** Strip the markdown down to a plain-text snippet for the card
 *  preview, drops code/links/heading markers but keeps line breaks so
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

export function useNoteDescriptor(note: Note): EntityDescriptor {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const moveNoteToFolder = useNoteStore((s) => s.moveNoteToFolder);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const label = t("library.allBooks.noteLabel");
  const preview = note.content ? noteSnippet(note.content) : "";
  return {
    kind: "note",
    id: note.id,
    selKey: `note:${note.id}`,
    title: noteDisplayTitle(note, t),
    folderId: note.folderId,
    updatedAt: new Date(note.updatedAt).toISOString(),
    open: () => navigate(`/notes/${note.id}`),
    openLabel: t("library.allBooks.openNote"),
    openIcon: Pencil,
    exportAction: {
      id: "export",
      label: t("library.actions.exportMarkdown"),
      icon: Download,
      onClick: () => downloadNoteMarkdown(note),
    },
    moveToFolder: (folderId) => moveNoteToFolder(note.id, folderId),
    remove: () => deleteNote(note.id),
    card: {
      tintClass: "bg-accent-blue/10",
      renderCover: (size) =>
        preview ? (
          <p className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-2 text-left text-[8px] leading-snug text-text-secondary/70">
            {preview}
          </p>
        ) : (
          <FileText size={size} className="text-accent-blue/70" />
        ),
      badge: (
        <CardTypeBadge
          icon={Pencil}
          colorClass="text-accent-blue"
          title={label}
        />
      ),
      subtitle: label,
    },
    row: {
      tile: "note",
      typeLabel: label,
    },
  };
}

export function useQuizDescriptor(quiz: Quiz): EntityDescriptor {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const deleteQuiz = useQuizStore((s) => s.deleteQuiz);
  const getQuiz = useQuizStore((s) => s.getQuiz);
  const label = t("library.allBooks.quizLabel");
  const countText = t("library.allBooks.quizQuestionCount", {
    count: quiz.question_count,
  });
  const handleExport = async () => {
    try {
      const full = await getQuiz(quiz.id);
      if (full) downloadQuizGift(full.quiz, full.questions);
    } catch (err) {
      logError("library:exportQuizGift", err);
    }
  };
  return {
    kind: "quiz",
    id: quiz.id,
    selKey: `quiz:${quiz.id}`,
    title: quiz.title.trim() || t("library.allBooks.untitledQuiz"),
    folderId: quiz.folder_id,
    updatedAt: quiz.updated_at,
    open: () => navigate(`/quizzes/${quiz.id}`),
    openLabel: t("library.allBooks.openQuiz"),
    openIcon: ListChecks,
    editAction: {
      id: "edit",
      label: t("library.actions.rename"),
      icon: Pencil,
      onClick: () => navigate(`/quizzes/${quiz.id}/edit`),
    },
    exportAction: {
      id: "export",
      label: t("library.actions.exportGift"),
      icon: Download,
      onClick: () => void handleExport(),
    },
    moveToFolder: (folderId) => void moveQuizToFolder(quiz.id, folderId),
    remove: () => void deleteQuiz(quiz.id),
    card: {
      tintClass: "bg-warning/10",
      renderCover: (size) => (
        <ListChecks size={size} className="text-warning/80" />
      ),
      badge: (
        <CardTypeBadge
          icon={ListChecks}
          colorClass="text-warning"
          title={label}
        />
      ),
      subtitle: countText,
    },
    row: {
      tile: "quiz",
      typeLabel: label,
      progressText: countText,
    },
  };
}

export function useChatDescriptor(
  conversation: ChatConversation,
): EntityDescriptor {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const openConversation = useChatStore((s) => s.openConversation);
  const moveConversationToFolder = useChatStore(
    (s) => s.moveConversationToFolder,
  );
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const label = t("library.allBooks.chatLabel");
  return {
    kind: "chat",
    id: conversation.id,
    selKey: `chat:${conversation.id}`,
    title: conversationDisplayTitle(conversation, t),
    folderId: conversation.folder_id,
    updatedAt: conversation.updated_at,
    // openConversation sets activeConversationId synchronously (then
    // streams messages in); navigating to /chat picks it up and the
    // auto-open-most-recent effect is skipped because activeId is set.
    open: () => {
      void openConversation(conversation.id);
      // land drilled into the conversation's folder (sidebar ?folder=)
      navigate(
        conversation.folder_id
          ? `/chat?folder=${encodeURIComponent(conversation.folder_id)}`
          : "/chat",
      );
    },
    openLabel: t("library.allBooks.openChat"),
    openIcon: MessageSquare,
    exportAction: {
      id: "export",
      label: t("library.actions.exportMarkdown"),
      icon: Download,
      onClick: () =>
        void downloadConversationMarkdownById(conversation).catch((err) =>
          logError("library:exportChat", err),
        ),
    },
    moveToFolder: (folderId) =>
      void moveConversationToFolder(conversation.id, folderId),
    remove: () =>
      void deleteConversation(conversation.id).catch((err) =>
        logError("library:deleteChat", err),
      ),
    card: {
      tintClass: "bg-accent-blue/10",
      renderCover: (size) => (
        <MessageSquare size={size} className="text-accent-blue/80" />
      ),
      badge: (
        <CardTypeBadge
          icon={MessageSquare}
          colorClass="text-accent-blue"
          title={label}
        />
      ),
      subtitle: conversation.source_doc_title?.trim()
        ? t("library.allBooks.chatFromSource", {
            source: conversation.source_doc_title,
          })
        : label,
    },
    row: {
      tile: "chat",
      typeLabel: label,
      subtitle: conversation.source_doc_title?.trim() || undefined,
    },
  };
}

export function useWhiteboardDescriptor(
  whiteboard: WhiteboardData,
): EntityDescriptor {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const moveWhiteboardToFolder = useWhiteboardStore(
    (s) => s.moveWhiteboardToFolder,
  );
  const deleteWhiteboard = useWhiteboardStore((s) => s.deleteWhiteboard);
  const label = t("library.allBooks.whiteboardLabel");
  return {
    kind: "whiteboard",
    id: whiteboard.id,
    selKey: `whiteboard:${whiteboard.id}`,
    title: whiteboardDisplayTitle(whiteboard, t),
    folderId: whiteboard.folderId ?? null,
    updatedAt: new Date(whiteboard.updatedAt).toISOString(),
    open: () => navigate(`/whiteboards/${whiteboard.id}`),
    openLabel: t("library.allBooks.openWhiteboard"),
    openIcon: PenLine,
    openMenuIcon: Shapes,
    exportAction: {
      id: "export",
      label: t("library.actions.exportJson"),
      icon: Download,
      onClick: () => downloadWhiteboardJson(whiteboard),
    },
    moveToFolder: (folderId) => moveWhiteboardToFolder(whiteboard.id, folderId),
    remove: () => deleteWhiteboard(whiteboard.id),
    card: {
      tintClass: "bg-success/10",
      // Live mini-render of the board's own strokes when it has any,
      // falling back to a shapes glyph for an empty board.
      renderCover: (size) =>
        whiteboard.elements.length > 0 ? (
          <WhiteboardThumbnail
            elements={whiteboard.elements}
            className="absolute inset-0 h-full w-full p-2"
          />
        ) : (
          <Shapes size={size} className="text-success/80" />
        ),
      badge: (
        <CardTypeBadge icon={PenLine} colorClass="text-success" title={label} />
      ),
      subtitle: label,
    },
    row: {
      tile: "whiteboard",
      typeLabel: label,
    },
  };
}

export function useResourceDescriptor(resource: Resource): EntityDescriptor {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const moveResourceToFolder = useResourceStore((s) => s.moveResourceToFolder);
  const deleteResource = useResourceStore((s) => s.deleteResource);
  const isYoutube = resource.kind === "youtube";
  const Icon = isYoutube ? Video : Globe;
  const kindLabel = isYoutube
    ? t("library.resource.kindYoutube")
    : t("library.resource.kindWeb");
  const beta = t("library.resource.beta");
  const showThumb = isYoutube && !!resource.thumbnail_url;
  return {
    kind: "resource",
    id: resource.id,
    selKey: `resource:${resource.id}`,
    title: resource.title || displayHost(resource.url),
    folderId: resource.folder_id,
    updatedAt: resource.updated_at,
    open: () => navigate(`/resources/${resource.id}`),
    openLabel: t("library.resource.open"),
    openIcon: ExternalLink,
    moveToFolder: (folderId) =>
      void moveResourceToFolder(resource.id, folderId),
    remove: () =>
      void deleteResource(resource.id).catch((err) =>
        logError("library:deleteResource", err),
      ),
    card: {
      tintClass: "bg-accent-blue/10",
      renderCover: (size) =>
        showThumb ? (
          <img
            src={resource.thumbnail_url!}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon size={size} className="text-accent-blue/80" />
        ),
      badge: (
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
          <span
            className="flex items-center gap-0.5 rounded bg-bg-primary/80 px-1 py-0.5 text-2xs font-semibold text-accent-blue backdrop-blur-sm"
            title={kindLabel}
          >
            <Icon size={10} />
            {kindLabel}
          </span>
          <span className="rounded bg-bg-primary/80 px-1 py-0.5 text-2xs font-medium uppercase tracking-wide text-text-muted backdrop-blur-sm">
            {beta}
          </span>
        </span>
      ),
      subtitle: displayHost(resource.url),
    },
    row: {
      tile: isYoutube ? "youtube" : "resource",
      typeLabel: isYoutube ? kindLabel : t("library.list.type.article"),
      subtitle: displayHost(resource.url),
      progressText: t("library.list.saved"),
    },
  };
}
