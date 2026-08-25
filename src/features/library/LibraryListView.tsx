import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Folder as FolderType } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { Note } from "@/stores/note-store";
import type { WhiteboardData } from "@/types/whiteboard";
import type { Quiz } from "@/types/quiz";
import type { ChatConversation } from "@/types/chat";
import type { Resource } from "@/types/resource";
import { BookRow } from "./list-view/BookRow";
import { NoteRow } from "./list-view/NoteRow";
import { WhiteboardRow } from "./list-view/WhiteboardRow";
import { QuizRow } from "./list-view/QuizRow";
import { ChatRow } from "./list-view/ChatRow";
import { ResourceRow } from "./list-view/ResourceRow";
import { FolderRow } from "./list-view/FolderRow";
import { LIST_GRID_CLASS, ROW_SEPARATOR_CLASS } from "./list-view/helpers";

interface LibraryListViewProps {
  folders: FolderType[];
  books: UnifiedLibraryItem[];
  /** Notes in the current folder, in render order. */
  notes?: Note[];
  /** Whiteboards in the current folder, in render order. */
  whiteboards?: WhiteboardData[];
  /** Quizzes in the current folder, in render order. */
  quizzes?: Quiz[];
  /** Conversations in the current folder, in render order. */
  chats?: ChatConversation[];
  /** Resources in the current folder, in render order. */
  resources?: Resource[];
  /** Interleaved render order, keys like `folder:<id>` / `book:<id>` /
   *  `note:<id>` / `whiteboard:<id>` / `quiz:<id>` / `chat:<id>` /
   *  `resource:<id>`. When
   *  provided, rows render in this order instead of the default grouping,
   *  matching the SortableContext's order so DnD reorder works correctly. */
  orderedKeys?: string[];
  /** Every folder / item (any folder), used for folder item counts. */
  allFolders: FolderType[];
  allBooks: UnifiedLibraryItem[];
  allNotes?: Note[];
  allWhiteboards?: WhiteboardData[];
  allQuizzes?: Quiz[];
  allChats?: ChatConversation[];
  allResources?: Resource[];
  selectedIds: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
  onNavigateFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
  /** "New subfolder", wired through to FolderRow's context menu. */
  onCreateSubfolder?: (parentFolderId: string) => void;
}

export function LibraryListView({
  folders,
  books,
  notes = [],
  whiteboards = [],
  quizzes = [],
  chats = [],
  resources = [],
  orderedKeys,
  allFolders,
  allBooks,
  allNotes = [],
  allWhiteboards = [],
  allQuizzes = [],
  allChats = [],
  allResources = [],
  selectedIds,
  selectionActive,
  onToggleSelect,
  onNavigateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveBook,
  onRemoveBook,
  onCreateSubfolder,
}: LibraryListViewProps) {
  const { t } = useTranslation();

  // One inline detail panel at a time; a plain click on the open row
  // (or Escape) closes it.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const handleActivate = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);
  useEffect(() => {
    if (!expandedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedKey]);

  if (
    folders.length === 0 &&
    books.length === 0 &&
    notes.length === 0 &&
    whiteboards.length === 0 &&
    quizzes.length === 0 &&
    chats.length === 0 &&
    resources.length === 0
  )
    return null;

  const folderByKey = new Map<string, FolderType>();
  for (const f of folders) folderByKey.set(`folder:${f.id}`, f);
  const bookByKey = new Map<string, UnifiedLibraryItem>();
  for (const b of books) bookByKey.set(`book:${b.id}`, b);
  const noteByKey = new Map<string, Note>();
  for (const n of notes) noteByKey.set(`note:${n.id}`, n);
  const whiteboardByKey = new Map<string, WhiteboardData>();
  for (const w of whiteboards) whiteboardByKey.set(`whiteboard:${w.id}`, w);
  const quizByKey = new Map<string, Quiz>();
  for (const q of quizzes) quizByKey.set(`quiz:${q.id}`, q);
  const chatByKey = new Map<string, ChatConversation>();
  for (const c of chats) chatByKey.set(`chat:${c.id}`, c);
  const resourceByKey = new Map<string, Resource>();
  for (const r of resources) resourceByKey.set(`resource:${r.id}`, r);

  // Render rows in `orderedKeys` order when supplied: interleaved
  // folders/books so SortableContext index positions match the visual
  // order and DnD reorder works. Falls back to folders-then-items.
  const renderOrder =
    orderedKeys ?? [
      ...folders.map((f) => `folder:${f.id}`),
      ...books.map((b) => `book:${b.id}`),
      ...notes.map((n) => `note:${n.id}`),
      ...whiteboards.map((w) => `whiteboard:${w.id}`),
      ...quizzes.map((q) => `quiz:${q.id}`),
      ...chats.map((c) => `chat:${c.id}`),
      ...resources.map((r) => `resource:${r.id}`),
    ];

  const folderItemCount = (folderId: string) =>
    allFolders.filter((f) => f.parent_id === folderId).length +
    allBooks.filter((b) => b.folder_id === folderId).length +
    allNotes.filter((n) => n.folderId === folderId).length +
    allWhiteboards.filter((w) => (w.folderId ?? null) === folderId).length +
    allQuizzes.filter((q) => (q.folder_id ?? null) === folderId).length +
    allChats.filter((c) => (c.folder_id ?? null) === folderId).length +
    allResources.filter((r) => (r.folder_id ?? null) === folderId).length;

  const shared = { selectionActive, onToggleSelect };

  return (
    <div data-list-root="">
      {/* Column headers. Same grid as the rows, no background fill so
          the header reads as part of the list surface. */}
      <div
        className={`${LIST_GRID_CLASS} ${ROW_SEPARATOR_CLASS} py-2 text-2xs font-semibold uppercase tracking-wider text-text-muted-2`}
      >
        <span />
        <span />
        <span>{t("library.list.columns.name")}</span>
        <span className="hidden md:block">{t("library.list.columns.type")}</span>
        <span className="hidden md:block">{t("library.list.columns.progress")}</span>
        <span className="hidden md:block">{t("library.list.columns.modified")}</span>
        <span />
      </div>

      {renderOrder.map((key) => {
        const folder = folderByKey.get(key);
        if (folder) {
          return (
            <FolderRow
              key={folder.id}
              folder={folder}
              itemCount={folderItemCount(folder.id)}
              sortableId={`folder:${folder.id}`}
              onNavigate={onNavigateFolder}
              onRename={onRenameFolder}
              onDelete={onDeleteFolder}
              selected={selectedIds.has(`folder:${folder.id}`)}
              onToggleSelect={onToggleSelect}
              onCreateSubfolder={onCreateSubfolder}
            />
          );
        }
        const entry = bookByKey.get(key);
        if (entry) {
          return (
            <BookRow
              key={`${entry.source}-${entry.id}`}
              entry={entry}
              sortableId={`book:${entry.id}`}
              selected={selectedIds.has(`book:${entry.id}`)}
              onToggleSelect={onToggleSelect}
              onMove={onMoveBook}
              onRemove={onRemoveBook}
              expanded={expandedKey === `book:${entry.id}`}
              onActivate={handleActivate}
            />
          );
        }
        const note = noteByKey.get(key);
        if (note) {
          return (
            <NoteRow
              key={key}
              note={note}
              sortableId={key}
              selected={selectedIds.has(key)}
              {...shared}
            />
          );
        }
        const whiteboard = whiteboardByKey.get(key);
        if (whiteboard) {
          return (
            <WhiteboardRow
              key={key}
              whiteboard={whiteboard}
              sortableId={key}
              selected={selectedIds.has(key)}
              {...shared}
            />
          );
        }
        const quiz = quizByKey.get(key);
        if (quiz) {
          return (
            <QuizRow
              key={key}
              quiz={quiz}
              sortableId={key}
              selected={selectedIds.has(key)}
              {...shared}
            />
          );
        }
        const chat = chatByKey.get(key);
        if (chat) {
          return (
            <ChatRow
              key={key}
              conversation={chat}
              sortableId={key}
              selected={selectedIds.has(key)}
              {...shared}
            />
          );
        }
        const resource = resourceByKey.get(key);
        if (resource) {
          return (
            <ResourceRow
              key={key}
              resource={resource}
              sortableId={key}
              selected={selectedIds.has(key)}
              {...shared}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
