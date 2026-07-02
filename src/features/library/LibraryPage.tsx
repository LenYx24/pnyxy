import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FilePlus,
  FolderPlus,
  FolderSearch,
  Upload,
  UploadCloud,
  Link as LinkIcon,
  BookPlus,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import { CreateFolderModal } from "./modals/CreateFolderModal";
import { cn } from "@/lib/cn";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useQuizStore } from "@/stores/quiz-store";
import { useChatStore } from "@/stores/chat-store";
import { useUploadStore } from "@/stores/upload-store";
import {
  classifyFile,
  fileExtension,
  logUploadAttempt,
} from "@/lib/upload-telemetry";
import { OpenFromUrlModal } from "./modals/OpenFromUrlModal";
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
import { FolderPickerModal } from "./modals/FolderPickerModal";
import { UploadPdfModal } from "./modals/UploadPdfModal";
import { DeviceBookScanModal } from "./modals/DeviceBookScanModal";
import { AddManualBookModal } from "./modals/AddManualBookModal";
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
  const folderPath = useLibraryStore((s) => s.folderPath);
  const createFolderPath = useLibraryStore((s) => s.createFolderPath);

  const storageUsage = useUploadStore((s) => s.storageUsage);
  const fetchStorageUsage = useUploadStore((s) => s.fetchStorageUsage);
  const enqueueUpload = useUploadStore((s) => s.enqueueUpload);
  const moveBookToFolder = useLibraryStore((s) => s.moveBookToFolder);
  const moveFolderToFolder = useLibraryStore((s) => s.moveFolderToFolder);
  const removeFromLibrary = useLibraryStore((s) => s.removeFromLibrary);
  const notes = useNoteStore((s) => s.notes);
  const moveNoteToFolder = useNoteStore((s) => s.moveNoteToFolder);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const moveWhiteboardToFolder = useWhiteboardStore(
    (s) => s.moveWhiteboardToFolder,
  );
  const deleteWhiteboard = useWhiteboardStore((s) => s.deleteWhiteboard);
  const quizzes = useQuizStore((s) => s.myQuizzes);
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const deleteQuiz = useQuizStore((s) => s.deleteQuiz);
  const conversations = useChatStore((s) => s.conversations);
  const moveConversationToFolder = useChatStore(
    (s) => s.moveConversationToFolder,
  );
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const user = useAuthStore((s) => s.user);

  // View preferences
  const {
    viewMode,
    cardSize,
    setViewMode,
    controlsExpanded,
    setControlsExpanded,
    sortOrders,
    setSortOrder,
    listColumnWidths,
    setListColumnWidth,
  } = useLibraryPrefs();

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
    const noteIds = notes.map((n) => `note:${n.id}`);
    const whiteboardIds = whiteboards.map((w) => `whiteboard:${w.id}`);
    const quizIds = quizzes.map((q) => `quiz:${q.id}`);
    const chatIds = conversations.map((c) => `chat:${c.id}`);
    return [
      ...folderIds,
      ...bookIds,
      ...noteIds,
      ...whiteboardIds,
      ...quizIds,
      ...chatIds,
    ];
  }, [folders, books, notes, whiteboards, quizzes, conversations]);

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
      } else {
        // Plain click during an active selection — or any
        // ctrl/cmd-click — toggles the row. Range-select (shift) is
        // handled above; everything else collapses to the same
        // single-item toggle.
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
  const [newFolderOpen, setNewFolderOpen] = useState(false);

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

    const noteIds = [...selectedIds]
      .filter((s) => s.startsWith("note:"))
      .map((s) => s.slice(5));
    const whiteboardIds = [...selectedIds]
      .filter((s) => s.startsWith("whiteboard:"))
      .map((s) => s.slice(11));
    const quizIds = [...selectedIds]
      .filter((s) => s.startsWith("quiz:"))
      .map((s) => s.slice(5));
    const chatIds = [...selectedIds]
      .filter((s) => s.startsWith("chat:"))
      .map((s) => s.slice(5));

    // Move books
    for (const id of bookIds) {
      const entry = books.find((b) => b.id === id);
      if (entry) await moveBookToFolder(entry, folderId);
    }
    // Move notes
    for (const id of noteIds) {
      moveNoteToFolder(id, folderId);
    }
    // Move whiteboards
    for (const id of whiteboardIds) {
      moveWhiteboardToFolder(id, folderId);
    }
    // Move quizzes
    for (const id of quizIds) {
      await moveQuizToFolder(id, folderId);
    }
    // Move conversations
    for (const id of chatIds) {
      await moveConversationToFolder(id, folderId);
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

    // Delete notes
    const noteIds = [...selectedIds]
      .filter((s) => s.startsWith("note:"))
      .map((s) => s.slice(5));
    for (const id of noteIds) {
      deleteNote(id);
    }

    // Delete whiteboards
    const whiteboardIds = [...selectedIds]
      .filter((s) => s.startsWith("whiteboard:"))
      .map((s) => s.slice(11));
    for (const id of whiteboardIds) {
      deleteWhiteboard(id);
    }

    // Delete quizzes
    const quizIds = [...selectedIds]
      .filter((s) => s.startsWith("quiz:"))
      .map((s) => s.slice(5));
    for (const id of quizIds) {
      await deleteQuiz(id);
    }

    // Delete conversations
    const chatIds = [...selectedIds]
      .filter((s) => s.startsWith("chat:"))
      .map((s) => s.slice(5));
    for (const id of chatIds) {
      await deleteConversation(id);
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
  // Inline notice for drag-drops that contained known-unsupported
  // formats. Auto-dismisses after a few seconds so it doesn't
  // linger. Set is per-extension so the message can name the
  // formats the user actually tried.
  const [unsupportedNotice, setUnsupportedNotice] = useState<string[]>([]);
  const unsupportedDismissRef = useRef<number | null>(null);
  // Track drag-enter/leave nesting — a single drag fires enter/leave
  // for every child the pointer crosses, which would otherwise flicker
  // the overlay.
  const dragDepth = useRef(0);

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

  const showUnsupportedNotice = useCallback((extensions: string[]) => {
    if (extensions.length === 0) return;
    setUnsupportedNotice(extensions);
    if (unsupportedDismissRef.current !== null) {
      window.clearTimeout(unsupportedDismissRef.current);
    }
    unsupportedDismissRef.current = window.setTimeout(() => {
      setUnsupportedNotice([]);
      unsupportedDismissRef.current = null;
    }, 6000);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);

      const all = Array.from(e.dataTransfer.files);

      // Bucket files by class. Known-unsupported book formats get
      // logged so we can see real demand later; unknown-extension
      // files (junk drops) are silently ignored.
      const supported: File[] = [];
      const rejectedExtensions = new Set<string>();
      for (const file of all) {
        const kind = classifyFile(file);
        if (kind === "supported") {
          supported.push(file);
        } else if (kind === "known-unsupported") {
          rejectedExtensions.add(fileExtension(file.name));
          void logUploadAttempt({
            file,
            status: "rejected_unsupported_format",
          });
        }
      }

      if (rejectedExtensions.size > 0) {
        showUnsupportedNotice([...rejectedExtensions]);
      }

      if (supported.length === 0) return;

      // PDFs are enqueued for background upload — the user sees a
      // ghost card per file in the grid with live progress + retry.
      // Non-PDFs (epub/txt/md) open locally as before; we only
      // navigate on the *last* one so multi-format drops don't yank
      // the user off the library mid-batch.
      for (let i = 0; i < supported.length; i++) {
        const file = supported[i];
        if (PDF_RE.test(file.name) && user) {
          enqueueUpload(file, currentFolderId);
        } else {
          try {
            await openFile(file, i === supported.length - 1);
          } catch {
            // openFile owns its own error UI; nothing for us to do.
          }
        }
      }
    },
    [user, enqueueUpload, openFile, currentFolderId, showUnsupportedNotice],
  );

  useEffect(() => {
    return () => {
      if (unsupportedDismissRef.current !== null) {
        window.clearTimeout(unsupportedDismissRef.current);
      }
    };
  }, []);

  const isUploaded = removeEntry?.source === "uploaded";

  const handleNewFolder = useCallback(() => setNewFolderOpen(true), []);
  const handleConfirmNewFolder = useCallback(
    async (name: string) => {
      // Lands in whatever folder the user is currently viewing.
      await createFolderPath(name, currentFolderId);
    },
    [createFolderPath, currentFolderId],
  );

  // Right-click anywhere in the library content area: create a folder
  // or reach any of the upload/import entry points. Mirrors the header
  // buttons so the actions are available without travelling to the
  // top-right. Desktop-only (onContextMenu); touch users get the
  // header buttons + "+" menu.
  const libraryMenu = useContextMenu(() => [
    {
      id: "new-folder",
      label: t("library.allBooks.newFolder"),
      icon: FolderPlus,
      onClick: handleNewFolder,
    },
    { id: "div-upload", divider: true },
    {
      id: "upload",
      label: t("library.actions.upload"),
      icon: Upload,
      onClick: () => setUploadModalOpen(true),
    },
    {
      id: "open-file",
      label: t("library.actions.open"),
      icon: FilePlus,
      onClick: triggerFilePicker,
    },
    {
      id: "scan",
      label: t("library.actions.scan"),
      icon: FolderSearch,
      onClick: openScanModal,
    },
    {
      id: "from-url",
      label: t("library.actions.fromUrl"),
      icon: LinkIcon,
      onClick: () => setUrlModalOpen(true),
    },
    {
      id: "manual",
      label: t("library.actions.manual"),
      icon: BookPlus,
      onClick: () => setManualModalOpen(true),
    },
  ]);

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
      // Whole-page right-click target so the import/new-folder menu is
      // reachable from the empty areas too — the footer, the storage
      // bar, the spacer, header whitespace — not just the grid. Rows and
      // AllBooksTab's own handler call stopPropagation, so their
      // right-clicks still show their own menu; only events that reach
      // here (the chrome around the grid) open the library menu.
      onContextMenu={libraryMenu.onContextMenu}
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
                "text-accent",
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
      {/* Inline notice for drag-drops with known-unsupported book
          formats. Auto-dismisses after a few seconds. The aim is
          to acknowledge the attempt so the user doesn't think it
          silently dropped, and to communicate that demand is
          recorded. */}
      {unsupportedNotice.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            {t("library.upload.unsupportedFormat", {
              formats: unsupportedNotice.join(", "),
            })}
          </p>
        </div>
      )}

      {/* Drop overlay — shown while a file drag is hovering. */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm">
          <div className="mx-4 flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent/60 bg-bg-secondary/90 px-8 py-10 text-center shadow-xl">
            <UploadCloud size={40} className="text-accent" />
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
      {/* Single header line: title · controls (toggle / search /
          refresh / view) · actions (Upload / New folder). The import
          options that used to hang off a "+" overflow now live in the
          right-click context menu. */}
      <LibraryToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={handleRefresh}
        isRefreshing={isLoading}
        controlsExpanded={controlsExpanded}
        onToggleControls={() => setControlsExpanded(!controlsExpanded)}
        leading={
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-text-primary">
              {t("library.yourLibrary")}
            </h2>
            <StreakPill />
          </div>
        }
        trailing={
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="primary"
              onClick={() => setUploadModalOpen(true)}
              title={t("library.actions.upload")}
              className="px-3 py-1.5 sm:px-4 sm:py-2"
            >
              <Upload size={18} />
              <span className="hidden sm:inline">
                {t("library.actions.upload")}
              </span>
            </Button>
            <Button
              variant="secondary"
              onClick={handleNewFolder}
              title={t("library.allBooks.newFolder")}
              className="px-3 py-1.5 sm:px-4 sm:py-2"
            >
              <FolderPlus size={18} />
              <span className="hidden sm:inline">
                {t("library.allBooks.newFolder")}
              </span>
            </Button>
          </div>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Tag filter bar — collapses with the rest of the search /
          filter panel via the persisted `controlsExpanded` flag. */}
      {controlsExpanded && (
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
        listColumnWidths={listColumnWidths}
        setListColumnWidth={setListColumnWidth}
        isLoading={isLoading}
        onContextMenu={libraryMenu.onContextMenu}
      />

      {/* Guarantees a gap between the last row of covers and the
          footer divider when the grid fills the viewport. `mt-auto`
          on the footer below absorbs all flex slack on short pages,
          so this spacer collapses harmlessly there. */}
      <div aria-hidden className="h-8 shrink-0" />

      {/* Bottom info row — book count + storage usage. Sticks to the
          bottom of the viewport on every breakpoint so the storage
          gauge stays glanceable while scrolling long libraries. On
          desktop it pins to `bottom-0`; on mobile/tablet it pins just
          above the fixed bottom nav (whose height is
          `3.5rem + safe-bottom`, `md:hidden`), so the two never
          overlap. Background + blur lets content scroll underneath
          without a hard cut. `mt-auto` still parks it at the bottom on
          short pages where there's nothing to scroll. */}
      <div className="sticky bottom-[calc(3.5rem+var(--spacing-safe-bottom,0px))] z-10 mt-auto flex flex-col gap-1.5 border-t border-glass-border bg-bg-primary/85 px-1 pb-2 pt-3 text-xs text-text-muted backdrop-blur-md md:bottom-0">
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

      {/* New folder modal — driven by the header button + the
          right-click context menu. Creates in the current folder. */}
      <CreateFolderModal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={handleConfirmNewFolder}
        parentFolderName={
          folderPath.length > 0
            ? folderPath[folderPath.length - 1].name
            : null
        }
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
                className="cursor-pointer rounded-lg bg-danger/20 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/30"
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

