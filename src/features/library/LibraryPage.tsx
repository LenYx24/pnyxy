import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FilePlus,
  FolderSearch,
  Upload,
  UploadCloud,
  Link as LinkIcon,
  BookPlus,
  Plus,
} from "lucide-react";
import { Button, FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { useUploadStore } from "@/stores/upload-store";
import { OpenFromUrlModal } from "./OpenFromUrlModal";
import { StorageUsageBar } from "./StorageUsageBar";
import { StreakPill } from "./StreakCard";
import { useIsMobile } from "@/hooks/use-media-query";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { RefreshCw } from "lucide-react";
import { useLibraryPrefs } from "./useLibraryPrefs";
import { LibraryToolbar } from "./LibraryToolbar";
import { SelectionBar } from "./SelectionBar";
import { TagFilterBar } from "./TagFilterBar";
import { AllBooksTab } from "./AllBooksTab";
import { FolderPickerModal } from "./FolderPickerModal";
import { UploadPdfModal } from "./UploadPdfModal";
import { DeviceBookScanModal } from "./DeviceBookScanModal";
import { AddManualBookModal } from "./AddManualBookModal";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { BookStatusTag } from "@/types/database";

export function LibraryPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } =
    useOpenDocument();

  const books = useLibraryStore((s) => s.books);
  const folders = useLibraryStore((s) => s.folders);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const fetchInProgress = useLibraryStore((s) => s.fetchInProgress);
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const enqueueUpload = useUploadStore((s) => s.enqueueUpload);
  const moveBookToFolder = useLibraryStore((s) => s.moveBookToFolder);
  const moveFolderToFolder = useLibraryStore((s) => s.moveFolderToFolder);
  const removeFromLibrary = useLibraryStore((s) => s.removeFromLibrary);
  const user = useAuthStore((s) => s.user);

  // View preferences
  const { viewMode, cardSize, setViewMode, sortOrders, setSortOrder } = useLibraryPrefs();

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Tag filter
  const [activeTag, setActiveTag] = useState<BookStatusTag | null>(null);

  // Mobile-only: whether the view/filter controls + tag filter bar are expanded
  const [mobileControlsExpanded, setMobileControlsExpanded] = useState(false);

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
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  // Shared dispatcher used by both URL-import and drag-drop: PDFs go to
  // the cloud library (when signed in); other formats just open in the
  // reader since the upload pipeline is PDF-only today.
  const importFile = useCallback(
    async (file: File) => {
      const isPdf = /\.pdf$/i.test(file.name);
      if (isPdf && user) {
        // Background upload — ghost card in the grid surfaces the
        // progress + result. The store handles `fetchLibrary(true)`
        // itself when the upload lands.
        enqueueUpload(file);
      } else {
        await openFile(file);
      }
    },
    [user, enqueueUpload, openFile],
  );

  // Move-to-folder modal state
  const [moveEntry, setMoveEntry] = useState<UnifiedLibraryItem | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  // Remove confirmation state
  const [removeEntry, setRemoveEntry] = useState<UnifiedLibraryItem | null>(null);

  const { confirm, ConfirmModalElement } = useConfirm();

  useEffect(() => {
    fetchLibrary();
    fetchFolders();
    fetchStorageUsage();
    fetchInProgress();
  }, [fetchLibrary, fetchFolders, fetchStorageUsage, fetchInProgress]);

  // Pull-to-refresh on mobile. Refetches the library + folders + usage
  // when the user pulls past the trigger distance from the top. Always
  // forces — pulling is an explicit user request to invalidate the
  // freshness window.
  const { pullDistance, isRefreshing } = usePullToRefresh({
    enabled: isMobile,
    onRefresh: useCallback(async () => {
      await Promise.all([
        fetchLibrary(true),
        fetchFolders(true),
        fetchStorageUsage(),
      ]);
    }, [fetchLibrary, fetchFolders, fetchStorageUsage]),
  });

  // Keyboard shortcuts. The corresponding on-button hint chips are
  // gone (the user said they were too much visual noise) — these
  // bindings are still functional, just no longer advertised inline;
  // the global ? overlay surfaces them when the user wants a list.
  const openUploadModal = useCallback(() => setUploadModalOpen(true), []);
  const openScanModal = useCallback(() => setScanModalOpen(true), []);

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
    const count = selectedIds.size;
    if (count === 0) return;
    const ok = await confirm({
      title: t("library.confirm.bulkDeleteTitle", { count }),
      body: t("library.confirm.bulkDeleteBody"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;

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
    // Toolbar Refresh button is an explicit user request — bypass
    // the library store's freshness check.
    fetchLibrary(true);
    fetchFolders(true);
  }, [fetchLibrary, fetchFolders]);

  // ── Drag & drop import ───────────────────────────────────────
  // Drop one or more book files anywhere on the library page and
  // they get added: PDFs are enqueued for background upload (the
  // ghost cards in the grid show per-file progress), other
  // supported formats are opened locally in the reader.
  const [dragOver, setDragOver] = useState(false);
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

      // PDFs are enqueued for background upload — the user sees a
      // ghost card per file in the grid with live progress + retry.
      // Non-PDFs (epub/txt/md) open locally as before; we only
      // navigate on the *last* one so multi-format drops don't yank
      // the user off the library mid-batch.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (PDF_RE.test(file.name) && user) {
          enqueueUpload(file, currentFolderId);
        } else {
          try {
            await openFile(file, i === files.length - 1);
          } catch {
            // openFile owns its own error UI; nothing for us to do.
          }
        }
      }
    },
    [user, enqueueUpload, openFile, currentFolderId],
  );

  const isUploaded = removeEntry?.source === "uploaded";

  return (
    // flex-col + min-h-full lets the mini-footer's `mt-auto` push
    // it to the bottom of the available height — content stays at
    // the top, footer pins to the bottom even when there are only
    // a few books to show.
    <div
      className="relative flex min-h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Pull-to-refresh indicator (mobile only). Fades in as the
          user pulls; spins while refreshing. */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="pointer-events-none fixed left-0 right-0 top-safe-top z-30 flex justify-center"
          style={{
            transform: `translateY(${isRefreshing ? 12 : Math.max(pullDistance - 30, 0)}px)`,
            opacity: isRefreshing ? 1 : Math.min(pullDistance / 70, 1),
            transition: isRefreshing ? "transform 150ms ease-out" : undefined,
          }}
        >
          <div className="rounded-full border border-glass-border bg-bg-secondary/90 p-2 shadow-lg backdrop-blur-md">
            <RefreshCw
              size={18}
              className={cn(
                "text-accent-purple",
                isRefreshing && "animate-spin",
              )}
              style={
                !isRefreshing
                  ? { transform: `rotate(${Math.min(pullDistance * 3, 360)}deg)` }
                  : undefined
              }
            />
          </div>
        </div>
      )}
      {/* Drop overlay — shown while a file drag is hovering. */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm">
          <div className="mx-4 flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent-purple/60 bg-bg-secondary/90 px-8 py-10 text-center shadow-xl">
            <UploadCloud size={40} className="text-accent-purple" />
            <p className="text-base font-semibold text-text-primary">
              {t("library.dropOverlay.title")}
            </p>
            <p className="text-xs text-text-muted">
              {t("library.dropOverlay.formats")}
              {!user && (
                <>
                  <br />
                  {t("library.dropOverlay.signInHint")}
                </>
              )}
            </p>
          </div>
        </div>
      )}


      {/* Header: stacks vertically below xl (1280px) because the
          button row + title + storage bar won't fit cleanly side-by-
          side on mid-sizes. We previously switched at sm, then lg —
          both left crowded windows where buttons overlapped the
          title. xl is the first width with comfortable room for both. */}
      <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-text-primary">
              {t("library.yourLibrary")}
            </h2>
            <StreakPill />
          </div>
        </div>
        {/* Action row — primary "Upload" lives at the top level
            because that's the high-frequency action; the rest
            (scan, open file, from URL, manual) sit behind a single
            "+" overflow to keep the header from feeling busy.
            Per-book "Open in reader" buttons inside the grid/list
            replace the standalone "Open" header button for the
            common case of "I want to read a book that's already in
            my library". */}
        <LibraryAddMenu
          onUpload={() => setUploadModalOpen(true)}
          onScan={openScanModal}
          onOpenFile={triggerFilePicker}
          onFromUrl={() => setUrlModalOpen(true)}
          onManual={() => setManualModalOpen(true)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.epub,.txt,.md,.markdown"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* Toolbar: search + view toggle. Cover size moved to
          Settings → Appearance to keep the toolbar focused. */}
      <LibraryToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={handleRefresh}
        isRefreshing={isLoading}
        mobileControlsExpanded={mobileControlsExpanded}
        onToggleMobileControls={() => setMobileControlsExpanded((v) => !v)}
      />

      {/* Tag filter bar — hidden on mobile until controls are expanded */}
      {(!isMobile || mobileControlsExpanded) && (
        <TagFilterBar activeTag={activeTag} onTagChange={setActiveTag} />
      )}

      {/* Single library view — the old Home / All Books tabs
          collapsed into one. "Recently added" moved to the Home
          page so it's still discoverable without forcing tab state
          here. */}
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

      {/* Guarantees a gap between the last row of covers and the
          footer divider when the grid fills the viewport. `mt-auto`
          on the footer below absorbs all flex slack on short pages,
          so this spacer collapses harmlessly there. */}
      <div aria-hidden className="h-8 shrink-0" />

      {/* Bottom info row — book count + storage usage. Pinned to
          the page bottom via `mt-auto` so nothing renders below it,
          regardless of how few books the user has. */}
      <div className="mt-auto flex flex-col gap-1.5 border-t border-glass-border pt-4 text-xs text-text-muted">
        <p>{t("library.bookCount", { count: books.length })}</p>
        {storageUsage && (
          <StorageUsageBar
            usedBytes={storageUsage.usedBytes}
            limitBytes={storageUsage.limitBytes}
            tier={storageUsage.tier}
            className="max-w-xs"
          />
        )}
      </div>

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

      {/* Open from URL modal */}
      <OpenFromUrlModal
        open={urlModalOpen}
        onClose={() => setUrlModalOpen(false)}
        onFile={importFile}
      />

      {/* Manual "shell book" modal — add metadata-only book */}
      <AddManualBookModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
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

      {ConfirmModalElement}

      {/* Remove confirmation dialog */}
      {removeEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setRemoveEntry(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              {isUploaded
                ? t("library.confirm.deleteTitle")
                : t("library.confirm.removeTitle")}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {isUploaded
                ? t("library.confirm.deleteBody")
                : t("library.confirm.removeBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setRemoveEntry(null)}
              >
                {t("common.cancel")}
              </Button>
              <button
                onClick={confirmRemove}
                className="cursor-pointer rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                {isUploaded
                  ? t("library.confirm.deleteAction")
                  : t("library.confirm.removeAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The compact "Add" cluster: a primary "Upload" button next to a
 * secondary "+" overflow that opens a small menu with the rarer
 * sources (scan, open file, from URL, manual). Replaces the old row
 * of five equal-weight buttons that the user found busy.
 */
function AddMenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FolderSearch;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      <Icon size={14} className="shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function LibraryAddMenu({
  onUpload,
  onScan,
  onOpenFile,
  onFromUrl,
  onManual,
}: {
  onUpload: () => void;
  onScan: () => void;
  onOpenFile: () => void;
  onFromUrl: () => void;
  onManual: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // FloatingMenu anchors to whichever element this ref points at;
  // a wrapping span keeps the ref typing simple (the underlying
  // Button component doesn't forward refs).
  const triggerRef = useRef<HTMLSpanElement>(null);
  // Hover-open with a small grace period so the cursor can travel
  // from trigger → portaled menu without dropping out. Touch devices
  // (no hover capability) fall back to the click toggle below.
  const closeTimerRef = useRef<number | null>(null);

  const close = () => setOpen(false);
  const wrap = (fn: () => void) => () => {
    fn();
    close();
  };

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 150);
  };

  // Skip hover-open on touch-only devices — fingers don't hover, and
  // a touch on the trigger would otherwise both open *and* immediately
  // dispatch a click, causing the menu to flicker.
  const hoverEnabled =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover)").matches;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="primary"
        onClick={onUpload}
        title={t("library.actions.upload")}
        className="px-3 py-1.5 sm:px-5 sm:py-2.5"
      >
        <Upload size={18} />
        <span className="hidden sm:inline">{t("library.actions.upload")}</span>
      </Button>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={hoverEnabled ? () => { cancelClose(); setOpen(true); } : undefined}
        onMouseLeave={hoverEnabled ? scheduleClose : undefined}
      >
        <Button
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
          title={t("library.actions.more")}
          aria-label={t("library.actions.more")}
          className="px-3 py-1.5 sm:px-3 sm:py-2.5"
        >
          <Plus size={18} />
        </Button>
      </span>
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        onMouseEnter={hoverEnabled ? cancelClose : undefined}
        onMouseLeave={hoverEnabled ? scheduleClose : undefined}
      >
        <AddMenuItem
          icon={FilePlus}
          label={t("library.actions.open")}
          onClick={wrap(onOpenFile)}
        />
        <AddMenuItem
          icon={FolderSearch}
          label={t("library.actions.scan")}
          onClick={wrap(onScan)}
        />
        <AddMenuItem
          icon={LinkIcon}
          label={t("library.actions.fromUrl")}
          onClick={wrap(onFromUrl)}
        />
        <AddMenuItem
          icon={BookPlus}
          label={t("library.actions.manual")}
          onClick={wrap(onManual)}
        />
      </FloatingMenu>
    </div>
  );
}
