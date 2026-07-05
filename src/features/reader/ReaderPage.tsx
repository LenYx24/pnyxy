import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import {
  BookOpen,
  FilePlus,
  Globe,
  Library,
  Loader2,
  PanelLeft,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
} from "dockview";
import { PromptModal } from "@/components/ui";
import type { TextSelection } from "@/types/annotation";
import { ReaderToolbar } from "./ReaderToolbar";
import { DocumentTabs } from "./DocumentTabs";
import { LibraryPickerModal } from "./popovers/LibraryPickerModal";
import { OpenFromUrlModal } from "@/features/library/modals/OpenFromUrlModal";
import { UploadPdfModal } from "@/features/library/modals/UploadPdfModal";
import { DeviceBookScanModal } from "@/features/library/modals/DeviceBookScanModal";
import { InlineDrawToolbar } from "./controls/InlineDrawToolbar";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { MobileReaderLayout } from "./MobileReaderLayout";
import { dockviewComponents } from "./dockview-components";
import { ActiveViewer } from "./viewers/ActiveViewer";
import { SearchOverlay } from "./popovers/SearchOverlay";
import {
  useMobileReaderGestures,
  type PinchEvent,
} from "./gestures/use-mobile-reader-gestures";
import { getZoomControls } from "./gestures/pinch-zoom-controller";
import {
  ScreenshotRectSelector,
  type ScreenshotRect,
} from "./popovers/ScreenshotRectSelector";
import { FocusSessionBadge } from "./controls/FocusSessionBadge";
import { useReaderStore } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useBookmarkStore } from "@/stores/bookmark-store";
import { useUndoStore } from "@/stores/undo-store";
import { useUIStore } from "@/stores/ui-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useStreakStore } from "@/stores/streak-store";
import { getFile, registerFile } from "@/lib/file-store";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { createAdapterForFile } from "./adapters";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import { useLibraryStore } from "@/stores/library-store";
import { loadLastOpenedBook } from "@/lib/last-opened-book";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useIsMobile, useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "@/components/ui";
import { saveDockviewLayout, loadDockviewLayout } from "@/stores/ui-store";
import { loadTocWidth, saveTocWidth } from "@/lib/annotation-storage";
import type { TocItem } from "@/types/document";
import type {
  CatalogLibraryItem,
  UploadedLibraryItem,
} from "@/types/catalog";

function EmptyState() {
  const { t } = useTranslation();
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } =
    useOpenDocument();
  const { openUploadedBook } = useOpenUploadedDocument();
  const { openCatalogBook } = useOpenCatalogBook();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // read once; a device only remembers its own last-opened book
  const [lastOpened] = useState(loadLastOpenedBook);
  const [resuming, setResuming] = useState(false);

  // Re-resolve the remembered book from the library and re-open it. The
  // page position then restores from the cross-device resume state, so
  // this continues where any device left off.
  const handleResume = async () => {
    if (!lastOpened || resuming) return;
    setResuming(true);
    try {
      await useLibraryStore.getState().fetchLibrary();
      const books = useLibraryStore.getState().books;
      if (lastOpened.source === "uploaded") {
        const entry = books.find(
          (e): e is UploadedLibraryItem =>
            e.source === "uploaded" && e.id === lastOpened.id,
        );
        if (entry) await openUploadedBook(entry);
      } else {
        const entry = books.find(
          (e): e is CatalogLibraryItem =>
            e.source === "catalog" && e.catalog_book.id === lastOpened.id,
        );
        if (entry) await openCatalogBook(entry.catalog_book);
      }
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-glass-bg">
        <BookOpen size={32} className="text-text-muted" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-text-primary">
        {t("reader.empty.title", { defaultValue: "No book open" })}
      </h2>
      <p className="mb-6 max-w-sm text-sm text-text-secondary">
        {t("reader.empty.body", {
          defaultValue:
            "Upload a book or open a file to start reading — anything you open shows up in your library.",
        })}
      </p>

      {/* resume the last book this device had open */}
      {lastOpened && (
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          className="mb-6 flex w-full max-w-sm items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-left transition-colors hover:bg-accent/15 disabled:opacity-60 cursor-pointer"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent">
            {resuming ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <BookOpen size={18} />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-accent">
              {t("reader.empty.continue", { defaultValue: "Continue reading" })}
            </span>
            <span className="block truncate text-sm font-semibold text-text-primary">
              {lastOpened.title}
            </span>
          </span>
        </button>
      )}

      {/* primary: get a book open right now */}
      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button variant="primary" onClick={triggerFilePicker}>
          <FilePlus size={18} />
          {t("reader.empty.openFile", { defaultValue: "Open a file" })}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setPickerOpen(true)}>
            <Library size={16} />
            {t("reader.empty.fromLibrary", { defaultValue: "From library" })}
          </Button>
          <Button variant="secondary" onClick={() => setUrlOpen(true)}>
            <Globe size={16} />
            {t("library.actions.fromUrl", { defaultValue: "From URL" })}
          </Button>
        </div>
      </div>

      {/* secondary: bring more books into the library */}
      <div className="mt-5 flex items-center gap-4 text-xs">
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <Upload size={14} />
          {t("library.actions.upload", { defaultValue: "Upload to library" })}
        </button>
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <ScanLine size={14} />
          {t("library.actions.scan", { defaultValue: "Scan device" })}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />

      {pickerOpen && <LibraryPickerModal onClose={() => setPickerOpen(false)} />}
      <OpenFromUrlModal
        open={urlOpen}
        onClose={() => setUrlOpen(false)}
        onFile={(file) => {
          setUrlOpen(false);
          void openFile(file);
        }}
      />
      <UploadPdfModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DeviceBookScanModal open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}

function flattenToc(items: TocItem[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    result.push(item.title);
    if (item.children.length) result.push(...flattenToc(item.children));
  }
  return result;
}

function computeTocWidth(toc: TocItem[]): number {
  const titles = flattenToc(toc);
  if (titles.length === 0) return 200;
  const sorted = titles.map((t) => t.length).sort((a, b) => b - a);
  const top3 = sorted.slice(0, 3);
  const avg = top3.reduce((sum, l) => sum + l, 0) / top3.length;
  const width = avg * 7.5 + 48;
  return Math.round(Math.min(Math.max(width, 180), 400));
}

/** Re-fetch a book's binary from Supabase after a refresh wipes the file-store. Returns null on failure. */
async function recoverBookFile(bookId: string): Promise<File | null> {
  // uploaded books, keyed by file_hash
  try {
    const { data: uploaded, error } = await supabase
      .from("books")
      .select("title, file_hash, book_files(storage_path, file_name)")
      .eq("file_hash", bookId)
      .limit(1)
      .maybeSingle();
    if (!error && uploaded) {
      const fileMeta = (
        uploaded.book_files as
          | { storage_path: string; file_name: string }[]
          | { storage_path: string; file_name: string }
          | null
      );
      const first = Array.isArray(fileMeta) ? fileMeta[0] : fileMeta;
      if (first?.storage_path) {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("book-files")
          .download(first.storage_path);
        if (!dlErr && blob) {
          return new File([blob], first.file_name ?? "document");
        }
      }
    }
  } catch (err) {
    logError("reader:recover:uploaded", err);
  }

  // catalog books, by id. Direct fetch, fall back to edge function for CORS-blocked hosts.
  try {
    const { data: catalog, error } = await supabase
      .from("catalog_books")
      .select("title, download_url")
      .eq("id", bookId)
      .limit(1)
      .maybeSingle();
    if (error || !catalog?.download_url) return null;
    const url = catalog.download_url as string;
    let res: Response;
    try {
      res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (directErr) {
      logError("reader:recover:catalog:direct", directErr);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      if (!accessToken) return null;
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-fetch?url=${encodeURIComponent(url)}`;
      try {
        res = await fetch(fnUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        if (!res.ok) return null;
      } catch (proxyErr) {
        logError("reader:recover:catalog:proxy", proxyErr);
        return null;
      }
    }
    const blob = await res.blob();
    // filename from the URL; adapter only needs bytes + extension
    const urlPath = url.toLowerCase().split("?")[0];
    const ext = urlPath.endsWith(".epub")
      ? ".epub"
      : urlPath.endsWith(".pdf")
        ? ".pdf"
        : urlPath.endsWith(".txt")
          ? ".txt"
          : "";
    const filename =
      ((catalog.title as string | null) ?? "document").replace(/[^\w.-]+/g, "_") +
      ext;
    return new File([blob], filename, { type: blob.type });
  } catch (err) {
    logError("reader:recover:catalog", err);
    return null;
  }
}

export function ReaderPage() {
  const { t } = useTranslation();
  const { bookId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  // Landscape phones dodge the 767px breakpoint but are too cramped for the
  // Dockview split-view, so treat short + touch as compact.
  const isMobilePortrait = useIsMobile();
  const isLandscapePhone = useMediaQuery(
    "(max-height: 500px) and (pointer: coarse)",
  );
  const isMobile = isMobilePortrait || isLandscapePhone;
  // Subscribe to derived booleans, not the documents Map: it churns a new
  // ref every pinch frame and would re-render the reader 60x/sec.
  const hasDocuments = useReaderStore((s) => s.documents.size > 0);
  const bookDocumentLoaded = useReaderStore((s) =>
    bookId ? s.documents.has(bookId) : false,
  );
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const addDocument = useReaderStore((s) => s.addDocument);
  const goToPage = useReaderStore((s) => s.goToPage);
  // Bind inline-draw to the active doc; deactivate on switch so draw mode doesn't carry over.
  const setInlineDrawBook = useInlineDrawStore((s) => s.setBook);
  const setInlineDrawActive = useInlineDrawStore((s) => s.setActive);
  useEffect(() => {
    setInlineDrawBook(activeDocumentId ?? null);
    if (!activeDocumentId) setInlineDrawActive(false);
  }, [activeDocumentId, setInlineDrawBook, setInlineDrawActive]);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);

  const isLoadingDocument = useUIStore((s) => s.isLoadingDocument);
  const loadingMessage = useUIStore((s) => s.loadingMessage);
  const zenMode = useUIStore((s) => s.zenMode);
  const setZenMode = useUIStore((s) => s.setZenMode);
  const toggleZenMode = useUIStore((s) => s.toggleZenMode);
  const libraryPickerOpen = useUIStore((s) => s.libraryPickerOpen);
  const setLibraryPickerOpen = useUIStore((s) => s.setLibraryPickerOpen);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);


  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Comment-via-shortcut: stash the selection, render PromptModal, commit on submit.
  const [commentPromptSelection, setCommentPromptSelection] =
    useState<TextSelection | null>(null);
  const tocWidthRef = useRef<number>(256);
  // Default AI chat panel width, remembered across close/reopen. Small screens
  // take ~42% of viewport (capped 300-500); wide monitors get 320.
  const aiChatWidthRef = useRef<number>(
    typeof window !== "undefined" && window.innerWidth < 1280
      ? Math.max(300, Math.min(500, Math.floor(window.innerWidth * 0.42)))
      : 320,
  );
  // Bumped per cold-path recovery; the async finally only clears the spinner
  // when the token still matches, so mid-recovery navigation keeps the newer state.
  const loadingTokenRef = useRef(0);
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Pinch-zoom for touch tablets/laptops outside `isMobile` (iPad landscape,
  // Surface). Swipe off here to avoid double-firing the mobile gesture suite.
  const isTouch = useMediaQuery("(pointer: coarse)");
  useMobileReaderGestures({
    targetRef: readerContainerRef,
    enableSwipe: false,
    enablePinch: !isMobile && isTouch,
    onSwipeLeft: () => {},
    onSwipeRight: () => {},
    onSingleTap: () => {},
    onDoubleTap: () => {},
    onPinch: useCallback(({ phase, scale, midX, midY }: PinchEvent) => {
      const controls = getZoomControls();
      if (!controls) return;
      if (phase === "start") controls.begin(midX, midY);
      else if (phase === "move") controls.update(scale);
      else controls.end();
    }, []),
  });
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

  // Load the document from the in-memory registry, or re-fetch from Supabase
  // if a refresh wiped it.
  useEffect(() => {
    if (!bookId || bookDocumentLoaded) return;
    let cancelled = false;
    const file = getFile(bookId);
    if (file) {
      // hot path: file already in memory
      const adapter = createAdapterForFile(file);
      void addDocument(adapter, file);
      return;
    }
    // cold path: post-refresh recovery. `cancelled` gates applying the doc so a
    // fast bookId change can't race two opens; the spinner uses loadingTokenRef.
    const setLoading = useUIStore.getState().setLoading;
    const token = ++loadingTokenRef.current;
    setLoading(true, t("reader.page.loadingDocumentMessage"));
    void (async () => {
      try {
        const recovered = await recoverBookFile(bookId);
        if (cancelled || !recovered) return;
        registerFile(bookId, recovered);
        const adapter = createAdapterForFile(recovered);
        await addDocument(adapter, recovered);
      } finally {
        if (loadingTokenRef.current === token) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, bookDocumentLoaded, addDocument, t]);

  // Load annotations + bookmarks for the active document
  useEffect(() => {
    if (activeDocumentId) {
      useAnnotationStore.getState().loadAnnotations(activeDocumentId);
      useBookmarkStore.getState().loadForDocument(activeDocumentId);
    }
    return () => {
      useAnnotationStore.getState().clearAll();
      useBookmarkStore.getState().clear();
    };
  }, [activeDocumentId]);

  // Jump to ?page= once the right doc is loaded, then consume the param. Guard
  // on activeDocumentId matching bookId or a stale doc from /chat gets the jump.
  useEffect(() => {
    if (!activeDocumentId) return;
    if (bookId && activeDocumentId !== bookId) return;
    const pageParam = searchParams.get("page");
    if (!pageParam) return;
    const pageNum = Number.parseInt(pageParam, 10);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    goToPage(pageNum);
    // Companion `q=` from citation chips: arm the citation slot so
    // CitationQuoteHighlightLayer picks it up when the page renders.
    const quote = searchParams.get("q");
    if (quote) {
      useReaderStore.getState().setActiveCitation({
        docId: activeDocumentId,
        page: pageNum,
        quote,
        createdAt: Date.now(),
      });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("page");
        next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [activeDocumentId, bookId, searchParams, setSearchParams, goToPage]);

  useEffect(() => {
    useNoteStore.getState().loadNotes();
    useWhiteboardStore.getState().loadWhiteboards();
  }, []);

  // Fullscreen can change externally (Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = readerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcut({
    id: "reader:open-file",
    key: "o",
    ctrl: true,
    description: "Open PDF file",
    handler: triggerFilePicker,
  });

  useKeyboardShortcut({
    id: "reader:zoom-in",
    key: "=",
    ctrl: true,
    description: "Zoom in",
    handler: useCallback(() => zoomIn(), [zoomIn]),
  });

  useKeyboardShortcut({
    id: "reader:zoom-out",
    key: "-",
    ctrl: true,
    description: "Zoom out",
    handler: useCallback(() => zoomOut(), [zoomOut]),
  });

  useKeyboardShortcut({
    id: "reader:zoom-reset",
    key: "0",
    ctrl: true,
    description: "Reset zoom to fit width",
    handler: useCallback(() => setZoomMode("fit-width"), [setZoomMode]),
  });

  // Ctrl/Cmd + wheel zoom for non-PDF viewers only. PdfViewer has its own
  // pivot-anchored handler; a second one racing it causes page jumps.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-active-viewer]")) return;
      if (target.closest("[data-pdf-viewer]")) return;
      e.preventDefault();
      const store = useReaderStore.getState();
      if (e.deltaY < 0) store.zoomIn();
      else store.zoomOut();
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  const prevPageHandler = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (activeDoc && activeDoc.currentPage > 1) goToPage(activeDoc.currentPage - 1);
  }, [goToPage]);

  const nextPageHandler = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (activeDoc && activeDoc.currentPage < activeDoc.totalPages) goToPage(activeDoc.currentPage + 1);
  }, [goToPage]);

  // Arrow up/down scroll the active PDF viewer one line.
  const LINE_SCROLL_PX = 60;
  // PdfViewer lives in a separate dockview subtree, so find it by marker attrs
  // instead of sharing a ref.
  const getActivePdfViewerEl = useCallback(
    (): HTMLElement | null =>
      document.querySelector<HTMLElement>(
        "[data-pdf-viewer][data-active-viewer]",
      ),
    [],
  );
  const lineScroll = useCallback(
    (dy: number) => {
      getActivePdfViewerEl()?.scrollBy({ top: dy, behavior: "smooth" });
    },
    [getActivePdfViewerEl],
  );
  const horizScroll = useCallback(
    (dx: number) => {
      getActivePdfViewerEl()?.scrollBy({ left: dx, behavior: "smooth" });
    },
    [getActivePdfViewerEl],
  );

  // With a horizontal scrollbar, Left/Right pan instead of paging.
  const hasHorizontalOverflow = useCallback(() => {
    const el = getActivePdfViewerEl();
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + 1;
  }, [getActivePdfViewerEl]);

  const arrowLeftHandler = useCallback(() => {
    if (hasHorizontalOverflow()) {
      horizScroll(-LINE_SCROLL_PX);
      return;
    }
    prevPageHandler();
  }, [hasHorizontalOverflow, horizScroll, prevPageHandler]);

  const arrowRightHandler = useCallback(() => {
    if (hasHorizontalOverflow()) {
      horizScroll(LINE_SCROLL_PX);
      return;
    }
    nextPageHandler();
  }, [hasHorizontalOverflow, horizScroll, nextPageHandler]);

  useKeyboardShortcut({
    id: "reader:prev-page",
    key: "ArrowLeft",
    description: "Previous page (pan when zoomed in)",
    handler: arrowLeftHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:next-page",
    key: "ArrowRight",
    description: "Next page (pan when zoomed in)",
    handler: arrowRightHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:line-up",
    key: "ArrowUp",
    description: "Scroll up one line",
    handler: useCallback(() => lineScroll(-LINE_SCROLL_PX), [lineScroll]),
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:line-down",
    key: "ArrowDown",
    description: "Scroll down one line",
    handler: useCallback(() => lineScroll(LINE_SCROLL_PX), [lineScroll]),
    preventDefault: false,
  });

  // vim hjkl: h=prev page, l=next page, j=line down, k=line up. Skip when an
  // editable element is focused.
  const isEditableFocused = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  };
  useKeyboardShortcut({
    id: "reader:vim-h",
    key: "h",
    description: "Previous page (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      prevPageHandler();
    }, [prevPageHandler]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:vim-l",
    key: "l",
    description: "Next page (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      nextPageHandler();
    }, [nextPageHandler]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:vim-j",
    key: "j",
    description: "Scroll down one line (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      lineScroll(LINE_SCROLL_PX);
    }, [lineScroll]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:vim-k",
    key: "k",
    description: "Scroll up one line (vim)",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      lineScroll(-LINE_SCROLL_PX);
    }, [lineScroll]),
    preventDefault: false,
  });
  void horizScroll;

  // 1-5: set the active highlight color. isEditableFocused also covers
  // contenteditable (EPUB iframe, inline-edit pills) that the shortcut module skips.
  const setActiveHighlightColor = useAnnotationStore(
    (s) => s.setActiveHighlightColor,
  );
  useKeyboardShortcut({
    id: "reader:highlight-yellow",
    key: "1",
    description: "Set highlight color: yellow",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("yellow");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-green",
    key: "2",
    description: "Set highlight color: green",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("green");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-blue",
    key: "3",
    description: "Set highlight color: blue",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("blue");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-pink",
    key: "4",
    description: "Set highlight color: pink",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("pink");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:highlight-orange",
    key: "5",
    description: "Set highlight color: orange",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      setActiveHighlightColor("orange");
    }, [setActiveHighlightColor]),
    preventDefault: false,
  });

  // n / Shift+N: jump between search matches.
  useKeyboardShortcut({
    id: "reader:search-next",
    key: "n",
    description: "Next search match",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      useSearchStore.getState().next();
    }, []),
    preventDefault: false,
  });
  useKeyboardShortcut({
    id: "reader:search-prev",
    key: "n",
    shift: true,
    description: "Previous search match",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      useSearchStore.getState().prev();
    }, []),
    preventDefault: false,
  });

  // Space / Shift+Space: page advance / back. Bound explicitly since focus
  // may be on the toolbar or sidebar, not the viewer.
  useKeyboardShortcut({
    id: "reader:space-next",
    key: " ",
    description: "Next page",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      nextPageHandler();
    }, [nextPageHandler]),
  });
  useKeyboardShortcut({
    id: "reader:space-prev",
    key: " ",
    shift: true,
    description: "Previous page",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      prevPageHandler();
    }, [prevPageHandler]),
  });

  // Home / End: scroll to top / bottom of the active viewer.
  const getActiveViewerEl = useCallback(
    (): HTMLElement | null =>
      document.querySelector<HTMLElement>("[data-active-viewer]"),
    [],
  );
  useKeyboardShortcut({
    id: "reader:home",
    key: "Home",
    description: "Jump to start of document",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      const el = getActiveViewerEl();
      el?.scrollTo({ top: 0, behavior: "smooth" });
    }, [getActiveViewerEl]),
  });
  useKeyboardShortcut({
    id: "reader:end",
    key: "End",
    description: "Jump to end of document",
    handler: useCallback(() => {
      if (isEditableFocused()) return;
      const el = getActiveViewerEl();
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, [getActiveViewerEl]),
  });

  // Ctrl+Shift+T: cycle reader theme. Shift because Ctrl+T is browser new-tab.
  useKeyboardShortcut({
    id: "reader:cycle-theme",
    key: "t",
    ctrl: true,
    shift: true,
    description: "Cycle reader theme",
    handler: useCallback(() => {
      const { readerTheme, setReaderTheme } = useSettingsStore.getState();
      setReaderTheme(
        readerTheme === "light"
          ? "dark"
          : readerTheme === "dark"
            ? "sepia"
            : "light",
      );
    }, []),
  });

  const toggleSidebar = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    // Snapshot the AI-chat width first. Dockview redistributes freed space
    // proportionally, so pin the chat and let the viewer absorb the TOC's space.
    const aiChatBefore = api.getPanel("aiChat");
    const aiChatW = aiChatBefore?.api.width ?? null;

    const tocPanel = api.getPanel("toc");
    if (tocPanel) {
      api.removePanel(tocPanel);
    } else {
      api.addPanel({
        id: "toc",
        component: "toc",
        title: i18n.t("reader.page.panelToc"),
        position: { direction: "left" },
        initialWidth: tocWidthRef.current,
        minimumWidth: 180,
        maximumWidth: 400,
      });
    }

    // Restore chat width once dockview settles; the delta comes from the viewer sibling.
    if (aiChatW != null && aiChatW > 0) {
      requestAnimationFrame(() => {
        const c = api.getPanel("aiChat");
        if (c && Math.abs(c.api.width - aiChatW) > 1) {
          c.api.setSize({ width: aiChatW });
        }
      });
    }
  }, []);

  // Pin the AI chat width while the sidebar collapse/expand animates the <main>
  // margin and resizes the dockview container, else the chat visibly jumps.
  useEffect(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const chat = api.getPanel("aiChat");
    if (!chat) return;
    const target = chat.api.width;
    if (target <= 0) return;
    let raf = 0;
    let cancelled = false;
    const startedAt = performance.now();
    const pin = () => {
      if (cancelled) return;
      const c = api.getPanel("aiChat");
      if (c && Math.abs(c.api.width - target) > 1) {
        c.api.setSize({ width: target });
      }
      // re-pin across the whole margin transition
      if (performance.now() - startedAt < 320) {
        raf = requestAnimationFrame(pin);
      }
    };
    raf = requestAnimationFrame(pin);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sidebarCollapsed]);

  useKeyboardShortcut({
    id: "reader:toggle-toc",
    key: "\\",
    ctrl: true,
    description: "Toggle table of contents",
    handler: toggleSidebar,
  });

  useKeyboardShortcut({
    id: "reader:go-to-page",
    key: "g",
    ctrl: true,
    description: "Go to page",
    handler: useCallback(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-page-input]',
      );
      input?.focus();
      input?.select();
    }, []),
  });

  useKeyboardShortcut({
    id: "reader:fullscreen",
    key: "f",
    description: "Toggle fullscreen",
    handler: toggleFullscreen,
  });

  useKeyboardShortcut({
    id: "reader:zen-mode",
    key: ".",
    ctrl: true,
    description: "Toggle zen reading mode",
    handler: toggleZenMode,
  });

  // Esc exits zen mode regardless of focus
  useEffect(() => {
    if (!zenMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZenMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zenMode, setZenMode]);

  useKeyboardShortcut({
    id: "reader:add-comment",
    key: "c",
    ctrl: true,
    shift: true,
    description: "Add comment to selection",
    handler: useCallback(() => {
      const { contextMenu } = useAnnotationStore.getState();
      if (contextMenu.visible && contextMenu.selection) {
        setCommentPromptSelection(contextMenu.selection);
      }
    }, []),
  });

  const [isDrawMode, setIsDrawMode] = useState(false);
  const drawWhiteboardIdRef = useRef<string | null>(null);

  const toggleDrawMode = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;

    // Add the replacement into the SAME group ("within") BEFORE removing the
    // original, so the group never goes empty and dockview keeps its proportions.
    if (isDrawMode) {
      const wbPanel = api.getPanel("pdfCanvasWhiteboard");
      if (!wbPanel) {
        setIsDrawMode(false);
        return;
      }
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
        position: { referencePanel: "pdfCanvasWhiteboard", direction: "within" },
      });
      api.removePanel(wbPanel);
      setIsDrawMode(false);
    } else {
      const activeDoc = useReaderStore.getState().getActiveDoc();
      if (!activeDoc?.meta?.fileUrl) return;

      // whiteboard-on-document needs a paginated format unless the experimental toggle is on
      const allowAll = useSettingsStore.getState()
        .experimental_allowWhiteboardForAllFormats;
      if (!activeDoc.meta.capabilities.paginated && !allowAll) return;

      const viewerPanel = api.getPanel("pdfViewer");
      if (!viewerPanel) return;

      // reuse existing whiteboard or create one
      if (!drawWhiteboardIdRef.current) {
        const activeDocId =
          useReaderStore.getState().activeDocumentId ?? undefined;
        drawWhiteboardIdRef.current = useWhiteboardStore
          .getState()
          .createWhiteboard({ bookId: activeDocId });
      }

      api.addPanel({
        id: "pdfCanvasWhiteboard",
        component: "whiteboard",
        title: i18n.t("reader.page.panelPdfCanvas"),
        params: {
          whiteboardId: drawWhiteboardIdRef.current,
          pdfDocumentUrl: activeDoc.meta.fileUrl,
        },
        position: { referencePanel: "pdfViewer", direction: "within" },
      });
      api.removePanel(viewerPanel);
      setIsDrawMode(true);
    }
  }, [isDrawMode]);

  const toggleComments = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panel = api.getPanel("comments");
    if (panel) {
      api.removePanel(panel);
    } else {
      api.addPanel({
        id: "comments",
        component: "comments",
        title: i18n.t("reader.page.panelComments"),
        position: { direction: "right" },
        initialWidth: 280,
      });
    }
  }, []);

  // Global @media print CSS hides everything except [data-active-viewer], so
  // the PDF canvas + overlays rasterize together.
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const [rectScreenshotActive, setRectScreenshotActive] = useState(false);
  // Separate flag from the download rect so the two capture modes don't cross-wire.
  const [rectToAiActive, setRectToAiActive] = useState(false);

  const saveCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const link = document.createElement("a");
    link.download = `screenshot-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    // also copy to clipboard; fails silently if permission is denied (http origin, no focus)
    try {
      canvas.toBlob((blob) => {
        if (!blob || !navigator.clipboard?.write) return;
        navigator.clipboard
          .write([new ClipboardItem({ "image/png": blob })])
          .catch(() => {});
      }, "image/png");
    } catch {
      // ClipboardItem missing or blocked
    }
  }, []);

  const handleScreenshot = useCallback(async () => {
    const viewer =
      document.querySelector<HTMLElement>("[data-active-viewer]") ??
      document.querySelector<HTMLElement>("[data-pdf-viewer]");
    if (!viewer) return;

    const { default: html2canvas } = await import("html2canvas-pro");
    const canvas = await html2canvas(viewer, {
      useCORS: true,
      allowTaint: true,
      scale: window.devicePixelRatio,
      backgroundColor: null,
    });
    saveCanvas(canvas);
  }, [saveCanvas]);

  const handleRectScreenshotStart = useCallback(() => {
    setRectScreenshotActive(true);
  }, []);

  const handleRectScreenshotCapture = useCallback(
    async (rect: ScreenshotRect) => {
      setRectScreenshotActive(false);
      // let the overlay unmount before rasterizing so it isn't captured
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { default: html2canvas } = await import("html2canvas-pro");
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio,
        backgroundColor: null,
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      });
      saveCanvas(canvas);
    },
    [saveCanvas],
  );

  // "Crop area for AI": overlay + html2canvas, but the PNG goes into the chat
  // composer's pending attachments (scanned PDFs, figures, image-only pages).
  const handleRectToAiStart = useCallback(() => {
    setRectToAiActive(true);
  }, []);

  const handleRectToAiCapture = useCallback(async (rect: ScreenshotRect) => {
    setRectToAiActive(false);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const { default: html2canvas } = await import("html2canvas-pro");
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: window.devicePixelRatio,
      backgroundColor: null,
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    });
    // base64 PNG, same shape as uploaded image attachments
    const dataUrl = canvas.toDataURL("image/png");
    const idx = dataUrl.indexOf(",");
    const data = idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
    useUIStore.getState().pushChatAttachment({
      kind: "image",
      media_type: "image/png",
      data,
      name: `page-${Date.now()}.png`,
    });
    // open the chat panel so the attachment is visible (null on /chat)
    useUIStore.getState().openReaderAiChat?.();
  }, []);

  const toggleSearch = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen && store.mode === "find") store.close();
    else store.open("find");
  }, []);

  const toggleReplace = useCallback(() => {
    const store = useSearchStore.getState();
    if (store.isOpen && store.mode === "replace") store.close();
    else store.open("replace");
  }, []);

  const toggleAiChat = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const panel = api.getPanel("aiChat");
    if (panel) {
      // capture width before removal so reopen restores it
      const currentWidth = panel.api.width;
      if (currentWidth > 0) aiChatWidthRef.current = currentWidth;
      api.removePanel(panel);
    } else {
      api.addPanel({
        id: "aiChat",
        component: "aiChat",
        title: i18n.t("reader.page.panelAiChat"),
        position: { direction: "right" },
        initialWidth: aiChatWidthRef.current,
      });
    }
  }, []);

  // Open-only entry point in the UI store so "Send to AI" can ensure the panel
  // is on screen without toggling it closed. Cleared on unmount so callers
  // outside the reader fall back to /chat.
  useEffect(() => {
    const open = () => {
      if (isMobile) {
        useUIStore.getState().setMobileReaderPanel("aiChat");
        return;
      }
      const api = dockviewApiRef.current;
      if (!api) return;
      if (api.getPanel("aiChat")) return; // already open
      api.addPanel({
        id: "aiChat",
        component: "aiChat",
        title: i18n.t("reader.page.panelAiChat"),
        position: { direction: "right" },
        initialWidth: aiChatWidthRef.current,
      });
    };
    useUIStore.getState().setOpenReaderAiChat(open);
    return () => {
      useUIStore.getState().setOpenReaderAiChat(null);
    };
  }, [isMobile]);

  useKeyboardShortcut({
    id: "reader:print",
    key: "p",
    ctrl: true,
    description: "Print document",
    handler: handlePrint,
  });

  useKeyboardShortcut({
    id: "reader:screenshot",
    key: "s",
    ctrl: true,
    shift: true,
    description: "Screenshot viewport",
    handler: handleScreenshot,
  });

  useKeyboardShortcut({
    id: "reader:search",
    key: "f",
    ctrl: true,
    description: "Find in document",
    handler: toggleSearch,
  });

  useKeyboardShortcut({
    id: "reader:replace",
    key: "h",
    ctrl: true,
    description: "Find and replace in document",
    handler: toggleReplace,
  });

  useKeyboardShortcut({
    id: "reader:toggle-comments",
    key: "m",
    ctrl: true,
    description: "Toggle comments panel",
    handler: toggleComments,
  });

  useKeyboardShortcut({
    id: "reader:toggle-ai-chat",
    key: "i",
    ctrl: true,
    description: "Toggle AI chat panel",
    handler: toggleAiChat,
  });

  useKeyboardShortcut({
    id: "reader:bookmark-page",
    key: "b",
    ctrl: true,
    description: "Bookmark current page",
    handler: useCallback(() => {
      const store = useReaderStore.getState();
      const docId = store.activeDocumentId;
      const doc = docId ? store.documents.get(docId) : null;
      if (doc) {
        useBookmarkStore.getState().addBookmark(doc.currentPage);
      }
    }, []),
  });

  useKeyboardShortcut({
    id: "reader:undo",
    key: "z",
    ctrl: true,
    description: "Undo last annotation action",
    handler: useCallback(() => {
      useUndoStore.getState().performUndo();
    }, []),
  });

  const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    dockviewApiRef.current = api;

    api.onDidActivePanelChange((e) => {
      if (!e) return;
      const panelId = e.id;
      if (panelId.startsWith("viewer-")) {
        const docId = panelId.replace("viewer-", "");
        useReaderStore.getState().setActiveDocument(docId);
      } else if (panelId === "pdfViewer") {
        // The default viewer keeps one panel id regardless of which doc it
        // shows; the active doc lives in the store. Guard against snapping back
        // to the first doc when toggling the toc panel re-fires this.
        const state = useReaderStore.getState();
        if (state.activeDocumentId) return;
        if (state.documents.size > 0) {
          state.setActiveDocument(Array.from(state.documents.keys())[0]);
        }
      }
    });

    const activeDoc = useReaderStore.getState().getActiveDoc();
    const dynamicWidth = activeDoc ? computeTocWidth(activeDoc.toc) : 256;
    tocWidthRef.current = dynamicWidth;

    const docId = useReaderStore.getState().activeDocumentId;
    const setupLayout = (resolvedWidth: number) => {
      tocWidthRef.current = resolvedWidth;

      // Dockview redistributes space equally on add/remove; defer setSize to
      // next frame so it runs after that settles.
      const restoreTocWidth = () => {
        requestAnimationFrame(() => {
          try {
            const tocPanel = api.getPanel("toc");
            if (tocPanel) {
              tocPanel.api.setSize({ width: tocWidthRef.current });
            }
          } catch {
            // panel may not exist
          }
        });
      };
      api.onDidRemovePanel((removed) => {
        if (removed.id === "toc") return;
        restoreTocWidth();
      });
      api.onDidAddPanel((added) => {
        if (added.id === "toc") return;
        restoreTocWidth();
      });

      const saved = loadDockviewLayout();
      if (saved) {
        try {
          api.fromJSON(saved as ReturnType<typeof api.toJSON>);
          restoreTocWidth();
          // Saved layout may have the whiteboard active (reader closed in draw
          // mode); reflect it so the draw button doesn't add a duplicate.
          if (api.getPanel("pdfCanvasWhiteboard")) {
            setIsDrawMode(true);
          }
          setupLayoutPersistence();
          return;
        } catch {
          // corrupted layout, fall through to default
        }
      }

      // Default layout: viewer only. TOC is opened on demand via the
      // floating-circle toggle and persists across sessions once pinned.
      api.addPanel({
        id: "pdfViewer",
        component: "pdfViewer",
        title: i18n.t("reader.page.panelDocument"),
      });

      // keep `resolvedWidth` referenced for the lint gate; toggleSidebar reads it via tocWidthRef
      void resolvedWidth;

      setupLayoutPersistence();
    };

    // Debounced layout + TOC width persistence
    const setupLayoutPersistence = () => {
      api.onDidLayoutChange(() => {
        if (layoutSaveTimerRef.current) {
          clearTimeout(layoutSaveTimerRef.current);
        }
        layoutSaveTimerRef.current = setTimeout(() => {
          saveDockviewLayout(api.toJSON());

          // persist TOC width per document
          const currentDocId = useReaderStore.getState().activeDocumentId;
          if (currentDocId) {
            try {
              const tocPanel = api.getPanel("toc");
              if (tocPanel) {
                const width = tocPanel.api.width;
                if (width > 0) {
                  tocWidthRef.current = width;
                  saveTocWidth(currentDocId, width);
                }
              }
            } catch {
              // panel may not exist
            }
          }
        }, 500);
      });
    };

    if (docId) {
      loadTocWidth(docId).then((savedWidth) => {
        setupLayout(savedWidth ?? dynamicWidth);
      });
    } else {
      setupLayout(dynamicWidth);
    }
  }, []);

  // Reading timer for streaks. Respects the active tracker's enabled flag so a
  // toggled-off tracker doesn't quietly accumulate streak time.
  useEffect(() => {
    if (!hasDocuments) return;

    let lastTick = Date.now();
    let accumulated = 0;

    const flush = () => {
      const now = Date.now();
      accumulated += (now - lastTick) / 1000;
      lastTick = now;
      if (accumulated >= 1) {
        const whole = Math.floor(accumulated);
        // Only credit streak time when the active tracker is enabled. Only the
        // toggle tracker has an `enabled` flag; others always credit.
        const settingsState = useSettingsStore.getState();
        const activeId = settingsState.activeTrackerId;
        const activeSettings = settingsState.trackerSettings[activeId];
        const tracking =
          activeId !== "toggle" ||
          (activeSettings as { enabled?: boolean } | undefined)?.enabled !== false;
        if (tracking) {
          useStreakStore.getState().addReadingTime(whole);
        }
        accumulated -= whole;
      }
    };

    const interval = setInterval(() => {
      if (!document.hidden) {
        flush();
      }
    }, 60_000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        flush();
      } else {
        lastTick = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flush();
    };
  }, [hasDocuments]);

  return (
    <div
      ref={readerContainerRef}
      // Full dynamic viewport on every breakpoint. `100dvh` accounts for the
      // URL-bar shrink/grow on mobile Safari; the bottom bar pads safe-area itself.
      className="relative flex h-[100dvh] flex-col bg-bg-primary md:h-screen"
    >
      {isLoadingDocument && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-accent mb-3" />
          <p className="text-sm text-text-secondary">{loadingMessage}</p>
        </div>
      )}
      {hasDocuments && zenMode ? (
        <div className="relative flex-1 overflow-hidden bg-bg-primary">
          <ActiveViewer />
          <SearchOverlay />
          <button
            onClick={() => setZenMode(false)}
            className="group fixed right-4 top-4 z-50 rounded-full border border-glass-border bg-bg-secondary/70 p-2 text-text-muted opacity-30 backdrop-blur-md transition-opacity hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
            title={t("reader.page.exitZenTitle")}
            aria-label={t("reader.page.exitZen")}
          >
            <X size={16} />
          </button>
        </div>
      ) : hasDocuments ? (
        isMobile ? (
          <MobileReaderLayout
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            isDrawMode={isDrawMode}
            onToggleDrawMode={toggleDrawMode}
            onScreenshot={handleScreenshot}
            onScreenshotRect={handleRectScreenshotStart}
            onRectToAi={handleRectToAiStart}
            onPrint={handlePrint}
            onToggleZenMode={toggleZenMode}
          />
        ) : (
          <>
            <ReaderToolbar
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
              onToggleComments={toggleComments}
              isDrawMode={isDrawMode}
              onToggleDrawMode={toggleDrawMode}
              onScreenshot={handleScreenshot}
              onScreenshotRect={handleRectScreenshotStart}
              onRectToAi={handleRectToAiStart}
              onPrint={handlePrint}
              onToggleSearch={toggleSearch}
              onToggleAiChat={toggleAiChat}
              onToggleZenMode={toggleZenMode}
              onToggleSidebar={toggleSidebar}
            />
            <DocumentTabs />
            <div className="relative flex-1 overflow-hidden">
              <DockviewReact
                className="pnyxy-dockview-theme h-full w-full"
                onReady={handleDockviewReady}
                components={dockviewComponents}
              />
              {/* Floating-circle toggle for the reader's TOC panel (same one
                  Ctrl+\\ binds). Distinct from the top-bar hamburger, which is
                  the global app sidebar. */}
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t("reader.toolbar.toggleSidebar")}
                title={t("reader.toolbar.toggleSidebar")}
                className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-glass-border bg-bg-secondary/80 text-text-secondary shadow-md backdrop-blur-md transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
              >
                <PanelLeft size={16} />
              </button>
              {/* SearchOverlay lives inside ViewerPanel, not here: its `right-4`
                  would pin to the dockview edge and overlap the open AI chat panel. */}
            </div>
          </>
        )
      ) : (
        <EmptyState />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />
      {rectScreenshotActive && (
        <ScreenshotRectSelector
          onCapture={handleRectScreenshotCapture}
          onCancel={() => setRectScreenshotActive(false)}
        />
      )}
      {rectToAiActive && (
        <ScreenshotRectSelector
          onCapture={handleRectToAiCapture}
          onCancel={() => setRectToAiActive(false)}
        />
      )}
      {libraryPickerOpen && (
        <LibraryPickerModal
          onClose={() => setLibraryPickerOpen(false)}
        />
      )}
      <FocusSessionBadge />
      <PromptModal
        open={commentPromptSelection !== null}
        title={t("reader.addCommentTitle")}
        placeholder={t("reader.addCommentPlaceholder")}
        confirmLabel={t("reader.addCommentSubmit")}
        onClose={() => setCommentPromptSelection(null)}
        onSubmit={(text) => {
          if (commentPromptSelection) {
            useAnnotationStore
              .getState()
              .addComment(commentPromptSelection, text);
          }
        }}
      />
      <InlineDrawToolbar />
    </div>
  );
}
