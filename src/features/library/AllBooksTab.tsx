import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  ChevronRight,
  FolderPlus,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useLibraryStore } from "@/stores/library-store";
import { FolderCard } from "./FolderCard";
import { LibraryBookCard } from "./LibraryBookCard";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface AllBooksTabProps {
  onMoveBook: (entry: UnifiedLibraryItem) => void;
  onRemoveBook: (entry: UnifiedLibraryItem) => void;
}

export function AllBooksTab({ onMoveBook, onRemoveBook }: AllBooksTabProps) {
  const navigate = useNavigate();
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);
  const folderPath = useLibraryStore((s) => s.folderPath);
  const folders = useLibraryStore((s) => s.folders);
  const books = useLibraryStore((s) => s.books);
  const navigateToFolder = useLibraryStore((s) => s.navigateToFolder);
  const createFolder = useLibraryStore((s) => s.createFolder);
  const renameFolder = useLibraryStore((s) => s.renameFolder);
  const deleteFolder = useLibraryStore((s) => s.deleteFolder);
  const subfolders = useMemo(() => folders.filter((f) => f.parent_id === currentFolderId), [folders, currentFolderId]);
  const booksInFolder = useMemo(() => books.filter((b) => b.folder_id === currentFolderId), [books, currentFolderId]);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleCreateFolder = () => {
    const name = prompt("New folder name:");
    if (name && name.trim()) {
      createFolder(name.trim(), currentFolderId);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    setConfirmDelete(id);
  };

  const confirmDeleteFolder = async () => {
    if (!confirmDelete) return;
    await deleteFolder(confirmDelete);
    setConfirmDelete(null);
  };

  const isEmpty = subfolders.length === 0 && booksInFolder.length === 0;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-sm">
          <button
            onClick={() => navigateToFolder(null)}
            className="text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            Library
          </button>
          {folderPath.map((folder, i) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight size={14} className="text-text-muted" />
              {i === folderPath.length - 1 ? (
                <span className="font-medium text-text-primary">
                  {folder.name}
                </span>
              ) : (
                <button
                  onClick={() => navigateToFolder(folder.id)}
                  className="text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                >
                  {folder.name}
                </button>
              )}
            </span>
          ))}
        </nav>

        <Button variant="secondary" onClick={handleCreateFolder}>
          <FolderPlus size={16} />
          New Folder
        </Button>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <BookOpen size={48} className="text-text-muted/50" />
          <div>
            <p className="text-lg font-medium text-text-primary">
              This folder is empty
            </p>
            {!currentFolderId && (
              <p className="mt-1 text-sm text-text-muted">
                Browse the catalog to add books, or create a folder to organize
                them.
              </p>
            )}
          </div>
          {!currentFolderId && (
            <Button variant="secondary" onClick={() => navigate("/app/browse")}>
              Browse Catalog
            </Button>
          )}
        </div>
      )}

      {/* Grid: folders first, then books */}
      {!isEmpty && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {subfolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onNavigate={navigateToFolder}
              onRename={renameFolder}
              onDelete={handleDeleteFolder}
            />
          ))}
          {booksInFolder.map((entry) => (
            <LibraryBookCard
              key={`${entry.source}-${entry.id}`}
              entry={entry}
              onMove={onMoveBook}
              onRemove={onRemoveBook}
            />
          ))}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              Delete Folder
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              Are you sure? Books in this folder will be moved to the root level. Subfolders will also be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <button
                onClick={confirmDeleteFolder}
                className="rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
