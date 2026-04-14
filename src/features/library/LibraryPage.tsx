import { useEffect, useState } from "react";
import { FilePlus, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useOpenPdf } from "@/hooks/use-open-pdf";
import { useLibraryStore } from "@/stores/library-store";
import { HomeTab } from "./HomeTab";
import { AllBooksTab } from "./AllBooksTab";
import { FolderPickerModal } from "./FolderPickerModal";
import { UploadPdfModal } from "./UploadPdfModal";
import type { UnifiedLibraryItem } from "@/types/catalog";

const STORAGE_KEY = "pnyxy-library-tab";

const tabs = [
  { key: "home", label: "Home" },
  { key: "all", label: "All Books" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function LibraryPage() {
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenPdf();

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "home" || saved === "all" ? saved : "home";
  });

  const books = useLibraryStore((s) => s.books);
  const folders = useLibraryStore((s) => s.folders);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const moveBookToFolder = useLibraryStore((s) => s.moveBookToFolder);
  const removeFromLibrary = useLibraryStore((s) => s.removeFromLibrary);

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Move-to-folder modal state
  const [moveEntry, setMoveEntry] = useState<UnifiedLibraryItem | null>(null);

  // Remove confirmation state
  const [removeEntry, setRemoveEntry] = useState<UnifiedLibraryItem | null>(null);

  useEffect(() => {
    fetchLibrary();
    fetchFolders();
  }, [fetchLibrary, fetchFolders]);

  const handleTabChange = (key: TabKey) => {
    setActiveTab(key);
    localStorage.setItem(STORAGE_KEY, key);
  };

  const handleMoveBook = (entry: UnifiedLibraryItem) => {
    setMoveEntry(entry);
  };

  const handleRemoveBook = (entry: UnifiedLibraryItem) => {
    setRemoveEntry(entry);
  };

  const confirmRemove = async () => {
    if (!removeEntry) return;
    await removeFromLibrary(removeEntry);
    setRemoveEntry(null);
  };

  const handleMoveSelect = async (folderId: string | null) => {
    if (!moveEntry) return;
    await moveBookToFolder(moveEntry, folderId);
    setMoveEntry(null);
  };

  if (isLoading && books.length === 0) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="animate-spin text-accent-purple" />
      </div>
    );
  }

  const isUploaded = removeEntry?.source === "uploaded";

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Your Library</h2>
          <p className="text-sm text-text-secondary">
            {books.length} {books.length === 1 ? "book" : "books"} in your collection
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setUploadModalOpen(true)}>
            <Upload size={18} />
            Upload PDF
          </Button>
          <Button variant="secondary" onClick={triggerFilePicker}>
            <FilePlus size={18} />
            Open PDF
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 rounded-lg border border-glass-border bg-glass-bg p-1 backdrop-blur-md">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={cn(
              "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
              activeTab === key
                ? "bg-accent-purple/15 text-accent-purple"
                : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "home" && (
        <HomeTab onMoveBook={handleMoveBook} onRemoveBook={handleRemoveBook} />
      )}
      {activeTab === "all" && (
        <AllBooksTab onMoveBook={handleMoveBook} onRemoveBook={handleRemoveBook} />
      )}

      {/* Upload PDF modal */}
      <UploadPdfModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
      />

      {/* Move to folder modal */}
      <FolderPickerModal
        open={!!moveEntry}
        folders={folders}
        currentFolderId={moveEntry?.folder_id ?? null}
        onClose={() => setMoveEntry(null)}
        onSelect={handleMoveSelect}
      />

      {/* Remove confirmation dialog */}
      {removeEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setRemoveEntry(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              {isUploaded ? "Delete Book" : "Remove from Library"}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {isUploaded
                ? "Are you sure you want to delete this book? The file will be permanently removed from storage."
                : "Are you sure you want to remove this book from your library?"}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setRemoveEntry(null)}
              >
                Cancel
              </Button>
              <button
                onClick={confirmRemove}
                className="rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 cursor-pointer"
              >
                {isUploaded ? "Delete" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
