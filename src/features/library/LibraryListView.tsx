import { useCallback, useState } from "react";
import type { Folder as FolderType } from "@/types/database";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { Note } from "@/stores/note-store";
import type { WhiteboardData } from "@/types/whiteboard";
import type { Quiz } from "@/types/quiz";
import type { ChatConversation } from "@/types/chat";
import {
  DEFAULT_LIST_COLUMN_WIDTHS,
  type ListColumnWidths,
} from "./useLibraryPrefs";
import { BookRow } from "./list-view/BookRow";
import { NoteRow } from "./list-view/NoteRow";
import { WhiteboardRow } from "./list-view/WhiteboardRow";
import { QuizRow } from "./list-view/QuizRow";
import { ChatRow } from "./list-view/ChatRow";
import { FolderRow } from "./list-view/FolderRow";
import { ResizableHeader } from "./list-view/ResizableHeader";
import { getRowDensity } from "./list-view/helpers";

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
  /** Interleaved render order, keys like `folder:<id>` / `book:<id>` /
   *  `note:<id>` / `whiteboard:<id>` / `quiz:<id>` / `chat:<id>`. When
   *  provided, rows render in this order instead of the default grouping,
   *  matching the SortableContext's order so DnD reorder works correctly. */
  orderedKeys?: string[];
  allFolders: FolderType[];
  allBooks: UnifiedLibraryItem[];
  /** All notes (any folder), used to populate expanded folders' children. */
  allNotes?: Note[];
  /** All whiteboards (any folder), for expanded folders' children. */
  allWhiteboards?: WhiteboardData[];
  /** All quizzes (any folder), for expanded folders' children. */
  allQuizzes?: Quiz[];
  /** All conversations (any folder), for expanded folders' children. */
  allChats?: ChatConversation[];
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
  cardSize?: number;
  /** Per-column widths in pixels for the resizable columns. Defaults
   *  to DEFAULT_LIST_COLUMN_WIDTHS when omitted (e.g. preview/test
   *  callers without a persisted store). */
  columnWidths?: ListColumnWidths;
  /** Fires while the user drags a column-header handle. Commits a
   *  single column's new width, the caller persists it. */
  setColumnWidth?: (key: keyof ListColumnWidths, width: number) => void;
}

export function LibraryListView({
  folders,
  books,
  notes = [],
  whiteboards = [],
  quizzes = [],
  chats = [],
  orderedKeys,
  allFolders,
  allBooks,
  allNotes = [],
  allWhiteboards = [],
  allQuizzes = [],
  allChats = [],
  selectedIds,
  selectionActive,
  onToggleSelect,
  onNavigateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveBook,
  onRemoveBook,
  onCreateSubfolder,
  cardSize = 200,
  columnWidths = DEFAULT_LIST_COLUMN_WIDTHS,
  setColumnWidth,
}: LibraryListViewProps) {
  const density = getRowDensity(cardSize);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (
    folders.length === 0 &&
    books.length === 0 &&
    notes.length === 0 &&
    whiteboards.length === 0 &&
    quizzes.length === 0 &&
    chats.length === 0
  )
    return null;

  return (
    <LibraryListContainer>
      {/* Column headers — Size/Added carry a right-edge resize handle
          when `setColumnWidth` is wired. Mouse-only; mobile hides these
          columns anyway. No background fill so the header reads as part
          of the same surface as the rows (Nextcloud-style). */}
      <div className="flex items-center border-b border-glass-border px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-text-muted sm:px-3">
        <div className="mr-1.5 w-7 shrink-0 sm:mr-2" /> {/* checkbox spacer */}
        <div className="mr-2.5 w-7 shrink-0" /> {/* icon spacer */}
        <div className="min-w-0 flex-1">Name</div>
        <div className="mr-2 w-7 shrink-0" /> {/* actions (⋮) spacer */}
        <ResizableHeader
          label="Size"
          width={columnWidths.size}
          onResize={
            setColumnWidth ? (w) => setColumnWidth("size", w) : undefined
          }
          className="mr-2 hidden lg:flex"
        />
        <ResizableHeader
          label="Added"
          width={columnWidths.added}
          onResize={
            setColumnWidth ? (w) => setColumnWidth("added", w) : undefined
          }
          className="mr-2 hidden lg:flex"
        />
      </div>

      {/* Render rows in `orderedKeys` order when supplied — interleaved
          folders/books so SortableContext index positions match the
          visual order and DnD reorder works. Falls back to folders-
          then-books if no order was provided. */}
      {(() => {
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

        const renderOrder =
          orderedKeys ?? [
            ...folders.map((f) => `folder:${f.id}`),
            ...books.map((b) => `book:${b.id}`),
            ...notes.map((n) => `note:${n.id}`),
            ...whiteboards.map((w) => `whiteboard:${w.id}`),
            ...quizzes.map((q) => `quiz:${q.id}`),
            ...chats.map((c) => `chat:${c.id}`),
          ];

        return renderOrder.map((key) => {
          const folder = folderByKey.get(key);
          if (folder) {
            const childFolders = allFolders.filter(
              (f) => f.parent_id === folder.id,
            );
            const childBooks = allBooks.filter(
              (b) => b.folder_id === folder.id,
            );
            const childNotes = allNotes.filter(
              (n) => n.folderId === folder.id,
            );
            const childWhiteboards = allWhiteboards.filter(
              (w) => (w.folderId ?? null) === folder.id,
            );
            const childQuizzes = allQuizzes.filter(
              (q) => (q.folder_id ?? null) === folder.id,
            );
            const childChats = allChats.filter(
              (c) => (c.folder_id ?? null) === folder.id,
            );
            return (
              <FolderRow
                key={folder.id}
                folder={folder}
                sortableId={`folder:${folder.id}`}
                expanded={expandedFolders.has(folder.id)}
                onToggleExpand={toggleExpand}
                onNavigate={onNavigateFolder}
                onRename={onRenameFolder}
                onDelete={onDeleteFolder}
                selected={selectedIds.has(`folder:${folder.id}`)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                childFolders={childFolders}
                childBooks={childBooks}
                childNotes={childNotes}
                childWhiteboards={childWhiteboards}
                childQuizzes={childQuizzes}
                childChats={childChats}
                allFolders={allFolders}
                allBooks={allBooks}
                allNotes={allNotes}
                allWhiteboards={allWhiteboards}
                allQuizzes={allQuizzes}
                allChats={allChats}
                onMoveBook={onMoveBook}
                onRemoveBook={onRemoveBook}
                onCreateSubfolder={onCreateSubfolder}
                expandedFolders={expandedFolders}
                selectedIds={selectedIds}
                density={density}
                columnWidths={columnWidths}
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
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                onMove={onMoveBook}
                onRemove={onRemoveBook}
                density={density}
                columnWidths={columnWidths}
              />
            );
          }
          const note = noteByKey.get(key);
          if (note) {
            return (
              <NoteRow
                key={`note:${note.id}`}
                note={note}
                sortableId={`note:${note.id}`}
                selected={selectedIds.has(`note:${note.id}`)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                density={density}
                columnWidths={columnWidths}
              />
            );
          }
          const whiteboard = whiteboardByKey.get(key);
          if (whiteboard) {
            return (
              <WhiteboardRow
                key={`whiteboard:${whiteboard.id}`}
                whiteboard={whiteboard}
                sortableId={`whiteboard:${whiteboard.id}`}
                selected={selectedIds.has(`whiteboard:${whiteboard.id}`)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                density={density}
                columnWidths={columnWidths}
              />
            );
          }
          const quiz = quizByKey.get(key);
          if (quiz) {
            return (
              <QuizRow
                key={`quiz:${quiz.id}`}
                quiz={quiz}
                sortableId={`quiz:${quiz.id}`}
                selected={selectedIds.has(`quiz:${quiz.id}`)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                density={density}
                columnWidths={columnWidths}
              />
            );
          }
          const chat = chatByKey.get(key);
          if (chat) {
            return (
              <ChatRow
                key={`chat:${chat.id}`}
                conversation={chat}
                sortableId={`chat:${chat.id}`}
                selected={selectedIds.has(`chat:${chat.id}`)}
                selectionActive={selectionActive}
                onToggleSelect={onToggleSelect}
                density={density}
                columnWidths={columnWidths}
              />
            );
          }
          return null;
        });
      })()}
    </LibraryListContainer>
  );
}

// Wraps the list with the original styling. Folder-create + upload
// now live in the library-wide right-click menu (attached in
// AllBooksTab) and the header buttons, so this is a plain container.
function LibraryListContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-glass-border">
      {children}
    </div>
  );
}
