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
  Globe,
  AlertTriangle,
  Plus,
  StickyNote,
  PenLine,
  FileQuestion,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, FloatingMenu, Kbd } from "@/components/ui";
import { modalBackdropClass, modalSurfaceClass } from "@/components/ui/classes";
import { useContextMenu } from "@/hooks/use-context-menu";
import { useFeatures } from "@/lib/use-features";
import { CreateFolderModal } from "./modals/CreateFolderModal";
import { cn } from "@/lib/cn";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { getCatalogShortcut } from "@/lib/keyboard-shortcuts";
import { useConfirm } from "@/hooks/use-confirm";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useQuizStore } from "@/stores/quiz-store";
import { useChatStore } from "@/stores/chat-store";
import { useResourceStore } from "@/stores/resource-store";
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
import { LibraryDropZone } from "./LibraryDropZone";
import { FolderPickerModal } from "./modals/FolderPickerModal";
import { UploadPdfModal } from "./modals/UploadPdfModal";
import { DeviceBookScanModal } from "./modals/DeviceBookScanModal";
import { AddManualBookModal } from "./modals/AddManualBookModal";
import { AddResourceModal } from "./modals/AddResourceModal";
import { loadLastOpenedBook } from "@/lib/last-opened-book";
import { track } from "@/lib/telemetry";
import { prefetchBookBlob } from "@/hooks/use-open-uploaded-document";
import type { UnifiedLibraryItem } from "@/types/catalog";
import type { BookStatusTag } from "@/types/database";

// One row in the "+ New" dropdown. Styled to match the app's other
// FloatingMenu lists (e.g. BookCategoryEditor).
function CreateMenuRow({
  icon: Icon,
  label,
  onClick,
  shortcut,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Shortcut catalog id, rendered as Kbd chips at the right edge. */
  shortcut?: string;
}) {
  const spec = shortcut ? getCatalogShortcut(shortcut) : undefined;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">{label}</span>
      {spec && <Kbd shortcut={spec} variant="chips" className="ml-auto" />}
    </button>
  );
}

function CreateMenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-text-muted-2">
      {children}
    </p>
  );
}

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
  const createNote = useNoteStore((s) => s.createNote);
  const moveNoteToFolder = useNoteStore((s) => s.moveNoteToFolder);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const createWhiteboard = useWhiteboardStore((s) => s.createWhiteboard);
  const moveWhiteboardToFolder = useWhiteboardStore(
    (s) => s.moveWhiteboardToFolder,
  );
  const deleteWhiteboard = useWhiteboardStore((s) => s.deleteWhiteboard);
  const quizzes = useQuizStore((s) => s.myQuizzes);
  const moveQuizToFolder = useQuizStore((s) => s.moveQuizToFolder);
  const deleteQuiz = useQuizStore((s) => s.deleteQuiz);
  const conversations = useChatStore((s) => s.conversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const moveConversationToFolder = useChatStore(
    (s) => s.moveConversationToFolder,
  );
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const resources = useResourceStore((s) => s.resources);
  const moveResourceToFolder = useResourceStore((s) => s.moveResourceToFolder);
  const deleteResource = useResourceStore((s) => s.deleteResource);
  const fetchResources = useResourceStore((s) => s.fetchResources);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const features = useFeatures();

  // View preferences
  const {
    viewMode,
    cardSize,
    setViewMode,
    typeFilter,
    setTypeFilter,
    sortOrders,
    setSortOrder,
  } = useLibraryPrefs();

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  // Fires once per pause in typing, not per keystroke.
  useEffect(() => {
    if (!searchQuery.trim()) return;
    const id = window.setTimeout(
      () => track("search_used", { chars: searchQuery.trim().length }),
      600,
    );
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  // Tag filter
  const [activeTag, setActiveTag] = useState<BookStatusTag | null>(null);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionActive = selectedIds.size > 0;
  const lastClickedIdRef = useRef<string | null>(null);
  // The exact on-screen order (filtered + DnD-sorted) reported by
  // AllBooksTab. Range-select must span what the user actually sees,
  // not a rebuilt approximation, or the "between" items are wrong.
  const displayedOrderRef = useRef<string[]>([]);
  // Visible folder / item counts for the footer line.
  const [visibleCounts, setVisibleCounts] = useState({ folders: 0, items: 0 });

  // Fallback order if AllBooksTab hasn't reported yet.
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
    const resourceIds = resources.map((r) => `resource:${r.id}`);
    return [
      ...folderIds,
      ...bookIds,
      ...noteIds,
      ...whiteboardIds,
      ...quizIds,
      ...chatIds,
      ...resourceIds,
    ];
  }, [folders, books, notes, whiteboards, quizzes, conversations, resources]);

  const handleToggleSelect = useCallback(
    (id: string, event: { ctrlKey: boolean; shiftKey: boolean }) => {
      if (event.shiftKey && lastClickedIdRef.current) {
        // Range selection over the actual displayed order.
        const ordered = displayedOrderRef.current.length
          ? displayedOrderRef.current
          : getOrderedIds();
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
        // toggle single row
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
  const handleOrderedKeysChange = useCallback((keys: string[]) => {
    displayedOrderRef.current = keys;
    let folderCount = 0;
    for (const k of keys) if (k.startsWith("folder:")) folderCount++;
    setVisibleCounts({
      folders: folderCount,
      items: keys.length - folderCount,
    });
  }, []);

  // Upload modal state. The primary upload action now picks files and
  // uploads them directly (progress items, no confirm modal); a large
  // batch (>10) routes to the review modal instead. The modal is kept
  // for that + future use, just not the default path.
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  // URL pasted onto the page, pre-fills the add-link modal.
  const [pastedUrl, setPastedUrl] = useState("");
  const handlePasteUrl = useCallback((url: string) => {
    setPastedUrl(url);
    setResourceModalOpen(true);
  }, []);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  // Browser-extension hand-off: /library?addUrl=<pageUrl> ("Save page to
  // Pnyxy") opens the same add-link modal a pasted URL does, prefilled.
  // Strips the param right after reading it, so it doesn't reopen on a
  // refresh or a StrictMode double effect.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const addUrl = searchParams.get("addUrl");
    if (!addUrl) return;
    handlePasteUrl(addUrl);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("addUrl");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, handlePasteUrl]);

  // upload pipeline is PDF-only; other formats just open in the reader
  const importFile = useCallback(
    async (file: File) => {
      const isPdf = /\.pdf$/i.test(file.name);
      if (isPdf && user) {
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
  const [removeEntry, setRemoveEntry] = useState<UnifiedLibraryItem | null>(
    null,
  );

  const { confirm, ConfirmModalElement } = useConfirm();

  // Warm the blob cache for the book the user read last, so the most
  // likely next click opens instantly. Idle-scheduled and size-capped
  // inside prefetchBookBlob. Backlog: extend to a small set chosen from
  // recent-reads / current folder once memory budget is understood.
  useEffect(() => {
    const last = loadLastOpenedBook();
    if (!last || last.source !== "uploaded") return;
    const entry = books.find(
      (b) => b.source === "uploaded" && b.id === last.id,
    );
    if (!entry || entry.source !== "uploaded" || !entry.book.storage_path)
      return;
    return prefetchBookBlob(entry.book.storage_path, {
      sizeBytes: entry.book.size_bytes,
    });
  }, [books]);

  useEffect(() => {
    // Force a fresh books fetch on every mount so a book just added from the
    // catalog (which updates browse-store, not this store) shows up right away
    // instead of waiting out the 60s freshness throttle. The in-memory book
    // list persists across nav, so this revalidates without a blank flash.
    fetchLibrary(true);
    fetchFolders();
    fetchStorageUsage();
    fetchInProgress();
    void fetchResources();
  }, [
    fetchLibrary,
    fetchFolders,
    fetchStorageUsage,
    fetchInProgress,
    fetchResources,
  ]);

  // pull-to-refresh (mobile). always forces a refetch.
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

  // shortcuts are surfaced via the global ? overlay, no inline hints
  const triggerUpload = useCallback(() => uploadInputRef.current?.click(), []);
  const handleUploadPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) =>
        /\.pdf$/i.test(f.name),
      );
      e.target.value = "";
      if (files.length === 0 || !user) return;
      // Big batches get the review modal; everything else uploads straight
      // away with progress items (cancel via the X on each).
      if (files.length > 10) {
        setPendingUploadFiles(files);
        setUploadModalOpen(true);
        return;
      }
      for (const f of files) enqueueUpload(f, currentFolderId);
    },
    [user, enqueueUpload, currentFolderId],
  );
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
    handler: triggerUpload,
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
    const resourceIds = [...selectedIds]
      .filter((s) => s.startsWith("resource:"))
      .map((s) => s.slice(9));

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
    // Move resources
    for (const id of resourceIds) {
      await moveResourceToFolder(id, folderId);
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

    // Delete resources
    const resourceIds = [...selectedIds]
      .filter((s) => s.startsWith("resource:"))
      .map((s) => s.slice(9));
    for (const id of resourceIds) {
      await deleteResource(id);
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
    // force past the freshness check
    fetchLibrary(true);
    fetchFolders(true);
  }, [fetchLibrary, fetchFolders]);

  // drag & drop import
  const [dragOver, setDragOver] = useState(false);
  const [unsupportedNotice, setUnsupportedNotice] = useState<string[]>([]);
  const unsupportedDismissRef = useRef<number | null>(null);
  // nesting counter: drag enter/leave fires per child, would flicker the overlay
  const dragDepth = useRef(0);
  // mirrors uploadModalOpen for the drag handlers (kept in a ref so they
  // stay stable). While the modal is open the handlers early-return, so
  // the page overlay can never activate or get stuck behind it.
  const uploadModalOpenRef = useRef(false);
  useEffect(() => {
    uploadModalOpenRef.current = uploadModalOpen;
  }, [uploadModalOpen]);

  const PDF_RE = /\.pdf$/i;

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    // The upload modal owns file drops while open; suppressing the page
    // overlay here stops it getting stuck behind the modal (the modal's
    // drop stops propagation, so the page onDrop that resets it never runs).
    if (uploadModalOpenRef.current || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (uploadModalOpenRef.current || !isFileDrag(e)) return;
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
      if (uploadModalOpenRef.current || !isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);

      const all = Array.from(e.dataTransfer.files);

      // known-unsupported formats get logged; unknown extensions ignored
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

      // only navigate on the last file so multi-format drops don't yank you off mid-batch
      for (let i = 0; i < supported.length; i++) {
        const file = supported[i];
        if (PDF_RE.test(file.name) && user) {
          enqueueUpload(file, currentFolderId);
        } else {
          try {
            await openFile(file, i === supported.length - 1);
          } catch {
            // openFile handles its own error UI
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
      // create in the current folder
      await createFolderPath(name, currentFolderId);
    },
    [createFolderPath, currentFolderId],
  );

  // --- Create new entities directly from the library ---
  // Each lands in the folder the user is currently viewing and navigates
  // straight to the new item's editor/page.
  const handleCreateNote = useCallback(() => {
    const id = createNote(currentFolderId);
    if (id) navigate(`/notes/${id}`);
  }, [createNote, currentFolderId, navigate]);

  const handleCreateWhiteboard = useCallback(() => {
    const id = createWhiteboard({ folderId: currentFolderId });
    if (id) navigate(`/whiteboards/${id}`);
  }, [createWhiteboard, currentFolderId, navigate]);

  const handleCreateQuiz = useCallback(() => {
    // fresh quiz in the editor; folder placement follows the first save
    navigate("/quizzes/new");
  }, [navigate]);

  const handleCreateChat = useCallback(async () => {
    await createConversation(undefined, currentFolderId ?? undefined);
    navigate("/chat");
  }, [createConversation, currentFolderId, navigate]);

  // "Create" rows, shared by the + New dropdown and the right-click menu.
  // Entities behind a disabled feature flag (pilot) are hidden here too,
  // otherwise the menu could create things the user can't open.
  const createEntries = [
    ...(features.notes
      ? [
          {
            id: "create-note",
            label: t("library.create.note"),
            icon: StickyNote,
            onClick: handleCreateNote,
          },
        ]
      : []),
    ...(features.whiteboard
      ? [
          {
            id: "create-whiteboard",
            label: t("library.create.whiteboard"),
            icon: PenLine,
            onClick: handleCreateWhiteboard,
          },
        ]
      : []),
    ...(features.quizzes
      ? [
          {
            id: "create-quiz",
            label: t("library.create.quiz"),
            icon: FileQuestion,
            onClick: handleCreateQuiz,
          },
        ]
      : []),
    {
      id: "create-chat",
      label: t("library.create.chat"),
      icon: MessageSquare,
      onClick: () => void handleCreateChat(),
    },
    {
      id: "create-resource",
      label: t("library.actions.addResource"),
      icon: Globe,
      onClick: () => setResourceModalOpen(true),
    },
  ];

  // "Other upload modes" beyond the primary Upload button.
  const uploadEntries = [
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
  ];

  // desktop right-click menu: create, then folder/upload/import actions
  const libraryMenu = useContextMenu(() => [
    ...createEntries,
    { id: "div-folder", divider: true },
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
      onClick: triggerUpload,
    },
    ...uploadEntries,
  ]);

  return (
    // flex-1 grows within the flex-col content wrapper so the bottom
    // bar's mt-auto pins to the bottom even when the grid is short
    <div
      className="relative flex min-h-full flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // whole-page target; rows/AllBooksTab stopPropagation to keep their own menus
      onContextMenu={libraryMenu.onContextMenu}
    >
      {/* pull-to-refresh indicator (mobile) */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="pointer-events-none fixed left-0 right-0 top-safe-top z-30 flex justify-center"
          style={{
            transform: `translateY(${isRefreshing ? 12 : Math.max(pullDistance - 30, 0)}px)`,
            opacity: isRefreshing ? 1 : Math.min(pullDistance / 70, 1),
            transition: isRefreshing ? "transform 150ms ease-out" : undefined,
          }}
        >
          <div className="rounded-chip bg-bg-tertiary p-2 shadow-page">
            <RefreshCw
              size={18}
              strokeWidth={1.5}
              className={cn(
                "text-text-secondary",
                isRefreshing && "animate-spin",
              )}
              style={
                !isRefreshing
                  ? {
                      transform: `rotate(${Math.min(pullDistance * 3, 360)}deg)`,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}
      {/* notice for drops of unsupported formats, auto-dismisses */}
      {unsupportedNotice.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-control bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            {t("library.upload.unsupportedFormat", {
              formats: unsupportedNotice.join(", "),
            })}
          </p>
        </div>
      )}

      {/* drop overlay while a file drag hovers */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/70 backdrop-blur-sm">
          <div className="mx-4 flex max-w-md flex-col items-center gap-3 rounded-page bg-bg-tertiary px-8 py-10 text-center shadow-page outline-dotted outline-2 -outline-offset-8 outline-surface-3">
            <UploadCloud
              size={40}
              strokeWidth={1.5}
              className="text-text-secondary"
            />
            <p className="font-display text-base font-semibold text-text-primary">
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />
      {/* direct upload picker: PDF only, multi-select; skips the modal */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={handleUploadPick}
      />

      <AllBooksTab
        onMoveBook={handleMoveBook}
        onRemoveBook={handleRemoveBook}
        viewMode={viewMode}
        cardSize={cardSize}
        searchQuery={searchQuery}
        selectedIds={selectedIds}
        selectionActive={selectionActive}
        onToggleSelect={handleToggleSelect}
        onOrderedKeysChange={handleOrderedKeysChange}
        activeTag={activeTag}
        sortOrders={sortOrders}
        setSortOrder={setSortOrder}
        isLoading={isLoading}
        onContextMenu={libraryMenu.onContextMenu}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        renderHeader={(breadcrumb) => (
          <LibraryToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onRefresh={handleRefresh}
            isRefreshing={isLoading}
            leading={breadcrumb}
            trailing={
              <div className="flex shrink-0 items-center gap-2">
                <StreakPill />
                {/* Primary "Add" dropdown: upload + the other add modes,
                    create entities and new folder, one click from the header.
                    Ctrl+U still uploads directly. */}
                <span ref={createBtnRef} className="inline-flex">
                  <Button
                    variant="primary"
                    onClick={() => setCreateMenuOpen((v) => !v)}
                    title={t("library.list.add")}
                    aria-haspopup="menu"
                    aria-expanded={createMenuOpen}
                    className="px-3 py-2 sm:px-3.5"
                  >
                    <Plus size={16} strokeWidth={1.5} />
                    <span className="hidden sm:inline">
                      {t("library.list.add")}
                    </span>
                  </Button>
                </span>
                <FloatingMenu
                  open={createMenuOpen}
                  anchorRef={createBtnRef}
                  onClose={() => setCreateMenuOpen(false)}
                  className="min-w-[13rem] pb-1"
                >
                  <CreateMenuHeading>
                    {t("library.create.createHeading")}
                  </CreateMenuHeading>
                  {createEntries.map((e) => (
                    <CreateMenuRow
                      key={e.id}
                      icon={e.icon}
                      label={e.label}
                      onClick={() => {
                        setCreateMenuOpen(false);
                        e.onClick();
                      }}
                    />
                  ))}
                  <div className="my-1 h-px bg-surface-3" />
                  <CreateMenuHeading>
                    {t("library.create.addHeading")}
                  </CreateMenuHeading>
                  <CreateMenuRow
                    icon={Upload}
                    label={t("library.actions.upload")}
                    onClick={() => {
                      setCreateMenuOpen(false);
                      triggerUpload();
                    }}
                  />
                  {uploadEntries.map((e) => (
                    <CreateMenuRow
                      key={e.id}
                      icon={e.icon}
                      label={e.label}
                      shortcut={
                        e.id === "open-file" ? "app:open-book" : undefined
                      }
                      onClick={() => {
                        setCreateMenuOpen(false);
                        e.onClick();
                      }}
                    />
                  ))}
                  <div className="my-1 h-px bg-surface-3" />
                  <CreateMenuRow
                    icon={FolderPlus}
                    label={t("library.allBooks.newFolder")}
                    onClick={() => {
                      setCreateMenuOpen(false);
                      handleNewFolder();
                    }}
                  />
                </FloatingMenu>
              </div>
            }
          />
        )}
        filtersExtra={
          <TagFilterBar activeTag={activeTag} onTagChange={setActiveTag} />
        }
      />

      {/* dashed drop / paste target under the list (both views) */}
      <LibraryDropZone
        onPickFiles={triggerUpload}
        onPasteUrl={handlePasteUrl}
      />

      {/* gap between last row and the footer divider */}
      <div aria-hidden className="h-8 shrink-0" />

      {/* sticky bottom info row: book count + storage. offset above the
          mobile bottom nav (3.5rem + safe-bottom) so they don't overlap. */}
      <div className="sticky bottom-[calc(3.5rem+var(--spacing-safe-bottom,0px))] z-10 mt-auto flex flex-col gap-1.5 bg-bg-secondary/90 px-1 pb-2 pt-3 text-xs text-text-muted-2 backdrop-blur-md md:bottom-0">
        <p>
          {t("library.list.folderCount", { count: visibleCounts.folders })}
          {", "}
          {t("library.list.itemCount", { count: visibleCounts.items })}
          {selectedIds.size > 0 &&
            ` · ${t("library.list.selectedCount", { count: selectedIds.size })}`}
        </p>
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

      {/* Upload PDF modal: kept for large batches (>10) and future use */}
      <UploadPdfModal
        open={uploadModalOpen}
        onClose={() => {
          setUploadModalOpen(false);
          setPendingUploadFiles([]);
        }}
        initialFiles={pendingUploadFiles}
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

      {/* metadata-only "shell book" modal */}
      <AddManualBookModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
      />

      {/* saved web page / YouTube link (beta), lands in the current folder */}
      <AddResourceModal
        open={resourceModalOpen}
        onClose={() => {
          setResourceModalOpen(false);
          setPastedUrl("");
        }}
        folderId={currentFolderId}
        initialUrl={pastedUrl}
      />

      {/* new folder modal, creates in the current folder */}
      <CreateFolderModal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={handleConfirmNewFolder}
        parentFolderName={
          folderPath.length > 0 ? folderPath[folderPath.length - 1].name : null
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
            className={`absolute inset-0 ${modalBackdropClass}`}
            onClick={() => setRemoveEntry(null)}
          />
          <div
            className={`relative z-10 w-full max-w-sm p-6 ${modalSurfaceClass}`}
          >
            <h3 className="mb-2 font-display text-lg font-semibold text-text-primary">
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
              <Button variant="secondary" onClick={() => setRemoveEntry(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={confirmRemove}>
                {isUploaded
                  ? t("library.confirm.deleteAction")
                  : t("library.confirm.removeAction")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
