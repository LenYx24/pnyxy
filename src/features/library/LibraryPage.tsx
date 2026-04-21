import { useEffect, useState, useCallback, useRef } from "react";
import { FilePlus, FolderSearch, Upload, UploadCloud, Loader2 } from "lucide-react";
import { Button, Kbd } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { formatShortcut } from "@/lib/keyboard-shortcuts";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { useUploadStore } from "@/stores/upload-store";
import { StorageUsageBar } from "./StorageUsageBar";
import { useLibraryPrefs } from "./useLibraryPrefs";
import { LibraryToolbar } from "./LibraryToolbar";
import { SelectionBar } from "./SelectionBar";
import { TagFilterBar } from "./TagFilterBar";
import { HomeTab } from "./HomeTab";
import { AllBooksTab } from "./AllBooksTab";
import { FolderPickerModal } from "./FolderPickerModal";
import { UploadPdfModal } from "./UploadPdfModal";
import { DeviceBookScanModal } from "./DeviceBookScanModal";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { BookStatusTag } from "@/types/database";

const STORAGE_KEY = "pnyxy-library-tab";

const tabs = [
  { key: "home", label: "Home" },
  { key: "all", label: "All Books" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function LibraryPage() {
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } =
    useOpenDocument();

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "home" || saved === "all" ? saved : "home";
  });

  const books = useLibraryStore((s) => s.books);
  const folders = useLibraryStore((s) => s.folders);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const uploadPdf = useUploadStore((s) => s.uploadPdf);
  const moveBookToFolder = useLibraryStore((s) => s.moveBookToFolder);
  const moveFolderToFolder = useLibraryStore((s) => s.moveFolderToFolder);
  const removeFromLibrary = useLibraryStore((s) => s.removeFromLibrary);
  const user = useAuthStore((s) => s.user);

  // View preferences
  const { viewMode, cardSize, setViewMode, setCardSize, sortOrders, setSortOrder } = useLibraryPrefs();

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Tag filter
  const [activeTag, setActiveTag] = useState<BookStatusTag | null>(null);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionActive = selectedIds.size > 0;
  const lastClickedIdRef = useRef<string | null>(null);

  // Build ordered list of selectable IDs (folders sorted by name, then books by date)
  const getOrderedIds = useCallback((): string[] => {
    const folderIds = folders
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => `folder:${f.id}`);
    const bookIds = books.map((b) => `book:${b.id}`);
    return [...folderIds, ...bookIds];
  }, [folders, books]);

  const handleToggleSelect = useCallback(
    (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => {
      if (event.shiftKey && lastClickedIdRef.current) {
        // Range selection
        const ordered = getOrderedIds();
        const fromIdx = ordered.indexOf(lastClickedIdRef.current);
        const toIdx = ordered.indexOf(id);
        if (fromIdx !== -1 && toIdx !== -1) {
          const start = Math.min(fromIdx, toIdx);
          const end = Math.max(fromIdx, toIdx);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = start; i <= end; i++) {
              next.add(ordered[i]);
            }
            return next;
          });
        }
      } else if (event.ctrlKey) {
        // Toggle single item
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else {
        // Toggle (during active selection or checkbox click)
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
      lastClickedIdRef.current = id;
    },
    [getOrderedIds],
  );

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);

  // Move-to-folder modal state
  const [moveEntry, setMoveEntry] = useState<UnifiedLibraryItem | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  // Remove confirmation state
  const [removeEntry, setRemoveEntry] = useState<UnifiedLibraryItem | null>(null);

  useEffect(() => {
    fetchLibrary();
    fetchFolders();
    fetchStorageUsage();
  }, [fetchLibrary, fetchFolders, fetchStorageUsage]);

  // Clear selection when switching tabs
  const handleTabChange = useCallback(
    (key: TabKey) => {
      setActiveTab(key);
      localStorage.setItem(STORAGE_KEY, key);
      clearSelection();
    },
    [clearSelection],
  );

  // Keyboard shortcuts
  const openUploadModal = useCallback(() => setUploadModalOpen(true), []);
  const openScanModal = useCallback(() => setScanModalOpen(true), []);
  const switchToHome = useCallback(
    () => handleTabChange("home"),
    [handleTabChange],
  );
  const switchToAll = useCallback(
    () => handleTabChange("all"),
    [handleTabChange],
  );

  useKeyboardShortcut({
    id: "library:open-file",
    key: "o",
    ctrl: true,
    description: "Open a file from disk",
    handler: triggerFilePicker,
  });
  useKeyboardShortcut({
    id: "library:upload",
    key: "u",
    ctrl: true,
    description: "Open upload dialog",
    handler: openUploadModal,
  });
  useKeyboardShortcut({
    id: "library:scan-device",
    key: "d",
    ctrl: true,
    shift: true,
    description: "Scan device for books",
    handler: openScanModal,
  });
  useKeyboardShortcut({
    id: "library:tab-home",
    key: "1",
    alt: true,
    description: "Switch to Home tab",
    handler: switchToHome,
  });
  useKeyboardShortcut({
    id: "library:tab-all",
    key: "2",
    alt: true,
    description: "Switch to All Books tab",
    handler: switchToAll,
  });

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

  // Bulk operations
  const handleBulkMove = () => {
    setBulkMoveOpen(true);
  };

  const handleBulkMoveSelect = async (folderId: string | null) => {
    const bookIds = [...selectedIds]
      .filter((s) => s.startsWith("book:"))
      .map((s) => s.slice(5));
    const folderIds = [...selectedIds]
      .filter((s) => s.startsWith("folder:"))
      .map((s) => s.slice(7));

    // Move books
    for (const id of bookIds) {
      const entry = books.find((b) => b.id === id);
      if (entry) await moveBookToFolder(entry, folderId);
    }
    // Move folders
    for (const id of folderIds) {
      await moveFolderToFolder(id, folderId);
    }

    setBulkMoveOpen(false);
    clearSelection();
  };

  const handleBulkDelete = async () => {
    const bookIds = [...selectedIds]
      .filter((s) => s.startsWith("book:"))
      .map((s) => s.slice(5));

    for (const id of bookIds) {
      const entry = books.find((b) => b.id === id);
      if (entry) await removeFromLibrary(entry);
    }

    // For folders, use deleteFolder from the store
    const folderIds = [...selectedIds]
      .filter((s) => s.startsWith("folder:"))
      .map((s) => s.slice(7));

    const deleteFolder = useLibraryStore.getState().deleteFolder;
    for (const id of folderIds) {
      await deleteFolder(id);
    }

    clearSelection();
  };

  const handleRefresh = useCallback(() => {
    fetchLibrary();
    fetchFolders();
  }, [fetchLibrary, fetchFolders]);

  // ── Drag & drop import ───────────────────────────────────────
  // Drop one or more book files anywhere on the library page and
  // they get added: PDFs upload to the cloud library (if signed
  // in), other supported formats are opened locally in the reader.
  const [dragOver, setDragOver] = useState(false);
  const [dropStatus, setDropStatus] = useState<{
    total: number;
    index: number;
    name: string;
    errors: number;
  } | null>(null);
  // Track drag-enter/leave nesting — a single drag fires enter/leave
  // for every child the pointer crosses, which would otherwise flicker
  // the overlay.
  const dragDepth = useRef(0);

  const SUPPORTED_RE = /\.(pdf|epub|txt|md|markdown)$/i;
  const PDF_RE = /\.pdf$/i;

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);

      const all = Array.from(e.dataTransfer.files);
      const files = all.filter((f) => SUPPORTED_RE.test(f.name));
      if (files.length === 0) return;

      let errors = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setDropStatus({ total: files.length, index: i, name: file.name, errors });

        try {
          if (PDF_RE.test(file.name) && user) {
            const bookId = await uploadPdf(file);
            if (!bookId) errors += 1;
          } else {
            // Non-PDF, or PDF but not signed in — open locally. Only
            // navigate on the last file so multi-drop stays on the
            // library if possible (but single-file drops jump straight
            // to the reader).
            await openFile(file, i === files.length - 1);
          }
        } catch {
          errors += 1;
        }
      }

      setDropStatus(null);
      await fetchLibrary();
      await fetchStorageUsage();
    },
    [user, uploadPdf, openFile, fetchLibrary, fetchStorageUsage],
  );

  const isUploaded = removeEntry?.source === "uploaded";

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay — shown while a file drag is hovering. */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm">
          <div className="mx-4 flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent-purple/60 bg-bg-secondary/90 px-8 py-10 text-center shadow-xl">
            <UploadCloud size={40} className="text-accent-purple" />
            <p className="text-base font-semibold text-text-primary">
              Drop to add to your library
            </p>
            <p className="text-xs text-text-muted">
              PDF, EPUB, TXT, or Markdown — multiple files supported
              {!user && (
                <>
                  <br />
                  Sign in to save PDFs to your cloud library.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Upload progress badge (while drop queue is processing). */}
      {dropStatus && (
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-lg border border-glass-border bg-bg-secondary/95 px-4 py-3 shadow-lg backdrop-blur-xl">
          <Loader2 size={16} className="animate-spin text-accent-purple" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
              Importing {dropStatus.index + 1} of {dropStatus.total}
              {dropStatus.errors > 0 && (
                <span className="ml-2 text-xs text-amber-400">
                  ({dropStatus.errors} failed)
                </span>
              )}
            </p>
            <p className="max-w-xs truncate text-xs text-text-muted">
              {dropStatus.name}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-text-primary">Your Library</h2>
          <p className="text-sm text-text-secondary">
            {books.length} {books.length === 1 ? "book" : "books"} in your
            collection
          </p>
          {storageUsage && (
            <StorageUsageBar
              usedBytes={storageUsage.usedBytes}
              limitBytes={storageUsage.limitBytes}
              tier={storageUsage.tier}
              className="mt-2 max-w-xs"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={openScanModal}
            title={`Scan device for books (${formatShortcut({ key: "d", ctrl: true, shift: true })})`}
          >
            <FolderSearch size={18} />
            <span className="hidden sm:inline">Scan device</span>
            <Kbd
              shortcut={{ key: "d", ctrl: true, shift: true }}
              className="ml-1 hidden lg:inline-flex"
            />
          </Button>
          <Button
            variant="secondary"
            onClick={() => setUploadModalOpen(true)}
            title={`Upload a book (${formatShortcut({ key: "u", ctrl: true })})`}
          >
            <Upload size={18} />
            <span className="hidden sm:inline">Upload</span>
            <Kbd
              shortcut={{ key: "u", ctrl: true }}
              className="ml-1 hidden lg:inline-flex"
            />
          </Button>
          <Button
            variant="secondary"
            onClick={triggerFilePicker}
            title={`Open a file (${formatShortcut({ key: "o", ctrl: true })})`}
          >
            <FilePlus size={18} />
            <span className="hidden sm:inline">Open</span>
            <Kbd
              shortcut={{ key: "o", ctrl: true }}
              className="ml-1 hidden lg:inline-flex"
            />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.epub,.txt,.md,.markdown"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg border border-glass-border bg-glass-bg p-1 backdrop-blur-md">
        {tabs.map(({ key, label }, idx) => {
          const tabShortcut = { key: String(idx + 1), alt: true };
          return (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              title={`${label} (${formatShortcut(tabShortcut)})`}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                activeTab === key
                  ? "bg-accent-purple/15 text-accent-purple"
                  : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              )}
            >
              <span>{label}</span>
              <Kbd shortcut={tabShortcut} className="hidden lg:inline-flex" />
            </button>
          );
        })}
      </div>

      {/* Toolbar: search, view toggle, size slider */}
      <LibraryToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        cardSize={cardSize}
        onCardSizeChange={setCardSize}
        onRefresh={handleRefresh}
        isRefreshing={isLoading}
      />

      {/* Tag filter bar */}
      <TagFilterBar activeTag={activeTag} onTagChange={setActiveTag} />

      {/* Tab content */}
      {activeTab === "home" && (
        <HomeTab
          onMoveBook={handleMoveBook}
          onRemoveBook={handleRemoveBook}
          viewMode={viewMode}
          cardSize={cardSize}
          searchQuery={searchQuery}
          selectedIds={selectedIds}
          selectionActive={selectionActive}
          onToggleSelect={handleToggleSelect}
          activeTag={activeTag}
          isLoading={isLoading}
        />
      )}
      {activeTab === "all" && (
        <AllBooksTab
          onMoveBook={handleMoveBook}
          onRemoveBook={handleRemoveBook}
          viewMode={viewMode}
          cardSize={cardSize}
          searchQuery={searchQuery}
          selectedIds={selectedIds}
          selectionActive={selectionActive}
          onToggleSelect={handleToggleSelect}
          activeTag={activeTag}
          sortOrders={sortOrders}
          setSortOrder={setSortOrder}
          isLoading={isLoading}
        />
      )}

      {/* Selection action bar */}
      <SelectionBar
        count={selectedIds.size}
        onMove={handleBulkMove}
        onDelete={handleBulkDelete}
        onClear={clearSelection}
      />

      {/* Upload PDF modal */}
      <UploadPdfModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
      />

      {/* Scan device for PDFs modal */}
      <DeviceBookScanModal
        open={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
      />

      {/* Move single item to folder */}
      <FolderPickerModal
        open={!!moveEntry}
        folders={folders}
        currentFolderId={moveEntry?.folder_id ?? null}
        onClose={() => setMoveEntry(null)}
        onSelect={handleMoveSelect}
      />

      {/* Bulk move to folder */}
      <FolderPickerModal
        open={bulkMoveOpen}
        folders={folders}
        currentFolderId={null}
        onClose={() => setBulkMoveOpen(false)}
        onSelect={handleBulkMoveSelect}
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
                className="cursor-pointer rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
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
