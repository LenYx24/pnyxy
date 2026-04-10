import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { BookOpen, FilePlus, Loader2 } from "lucide-react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview";
import { ReaderSidebarContent } from "./ReaderSidebar";
import { ReaderToolbar } from "./ReaderToolbar";
import { PdfViewer } from "./PdfViewer";
import { CommentsSidebar } from "./CommentsSidebar";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { WhiteboardPanelWrapper } from "@/features/whiteboard/WhiteboardPanel";
import { useReaderStore } from "@/stores/reader-store";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useUndoStore } from "@/stores/undo-store";
import { useUIStore } from "@/stores/ui-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { getFile } from "@/lib/file-store";
import { createPdfAdapter } from "./adapters/pdf-adapter";
import { useOpenPdf } from "@/hooks/use-open-pdf";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Button } from "@/components/ui";
import { saveDockviewLayout, loadDockviewLayout } from "@/stores/ui-store";

function TocPanel(props: IDockviewPanelProps) {
  const dockviewApi = props.containerApi;
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } = useOpenPdf();

  const handleOpenFile = useCallback(() => {
    triggerFilePicker();
  }, [triggerFilePicker]);

  const handleOpenNote = useCallback(
    (noteId: string) => {
      const panelId = `note-${noteId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
        return;
      }
      dockviewApi.addPanel({
        id: panelId,
        component: "note",
        title: "Note",
        params: { noteId },
        position: { direction: "right" },
      });
    },
    [dockviewApi],
  );

  const handleCreateNote = useCallback(() => {
    const noteId = useNoteStore.getState().createNote();
    const panelId = `note-${noteId}`;
    dockviewApi.addPanel({
      id: panelId,
      component: "note",
      title: "New Note",
      params: { noteId },
      position: { direction: "right" },
    });
  }, [dockviewApi]);

  const handleOpenWhiteboard = useCallback(
    (whiteboardId: string) => {
      const panelId = `whiteboard-${whiteboardId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) {
        existing.api.setActive();
        return;
      }
      dockviewApi.addPanel({
        id: panelId,
        component: "whiteboard",
        title: "Whiteboard",
        params: { whiteboardId },
        position: { direction: "right" },
      });
    },
    [dockviewApi],
  );

  const handleCreateWhiteboard = useCallback(() => {
    const whiteboardId = useWhiteboardStore.getState().createWhiteboard();
    const panelId = `whiteboard-${whiteboardId}`;
    dockviewApi.addPanel({
      id: panelId,
      component: "whiteboard",
      title: "New Whiteboard",
      params: { whiteboardId },
      position: { direction: "right" },
    });
  }, [dockviewApi]);

  return (
    <>
      <ReaderSidebarContent
        onOpenFile={handleOpenFile}
        onOpenNote={handleOpenNote}
        onCreateNote={handleCreateNote}
        onOpenWhiteboard={handleOpenWhiteboard}
        onCreateWhiteboard={handleCreateWhiteboard}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileSelect}
      />
    </>
  );
}

function ViewerPanel(props: IDockviewPanelProps<{ documentId?: string }>) {
  const documentId = props.params?.documentId;
  return <PdfViewer documentId={documentId} />;
}

function CommentsPanel(_props: IDockviewPanelProps) {
  return <CommentsSidebar />;
}

function NotePanelWrapper(props: IDockviewPanelProps<{ noteId?: string }>) {
  const noteId = props.params?.noteId;
  if (!noteId) return null;
  return <NoteEditor noteId={noteId} />;
}

const dockviewComponents = {
  toc: TocPanel,
  pdfViewer: ViewerPanel,
  comments: CommentsPanel,
  note: NotePanelWrapper,
  whiteboard: WhiteboardPanelWrapper,
};

function EmptyState() {
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenPdf();

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-glass-bg">
        <BookOpen size={32} className="text-text-muted" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-text-primary">
        No book open
      </h2>
      <p className="mb-6 max-w-sm text-sm text-text-secondary">
        Select a book from your library to start reading, or open a PDF file
        directly.
      </p>
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
  );
}

export function ReaderPage() {
  const { bookId } = useParams();
  const documents = useReaderStore((s) => s.documents);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const addDocument = useReaderStore((s) => s.addDocument);
  const setActiveDocument = useReaderStore((s) => s.setActiveDocument);
  const goToPage = useReaderStore((s) => s.goToPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);

  const isLoadingDocument = useUIStore((s) => s.isLoadingDocument);
  const loadingMessage = useUIStore((s) => s.loadingMessage);

  const hasDocuments = documents.size > 0;

  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } = useOpenPdf();

  // Load document from file registry if navigated directly
  useEffect(() => {
    if (bookId && !documents.has(bookId)) {
      const file = getFile(bookId);
      if (file) {
        const adapter = createPdfAdapter();
        addDocument(adapter, file);
      }
    }
  }, [bookId, documents, addDocument]);

  // Load annotations when active document changes
  useEffect(() => {
    if (activeDocumentId) {
      useAnnotationStore.getState().loadAnnotations(activeDocumentId);
    }
    return () => {
      useAnnotationStore.getState().clearAll();
    };
  }, [activeDocumentId]);

  // Load notes and whiteboards on mount
  useEffect(() => {
    useNoteStore.getState().loadNotes();
    useWhiteboardStore.getState().loadWhiteboards();
  }, []);

  // Listen for fullscreen changes (e.g. user pressing Esc)
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

  const prevPageHandler = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (activeDoc && activeDoc.currentPage > 1) goToPage(activeDoc.currentPage - 1);
  }, [goToPage]);

  const nextPageHandler = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (activeDoc && activeDoc.currentPage < activeDoc.totalPages) goToPage(activeDoc.currentPage + 1);
  }, [goToPage]);

  useKeyboardShortcut({
    id: "reader:prev-page",
    key: "ArrowLeft",
    description: "Previous page",
    handler: prevPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:next-page",
    key: "ArrowRight",
    description: "Next page",
    handler: nextPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:prev-page-up",
    key: "ArrowUp",
    description: "Previous page",
    handler: prevPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:next-page-down",
    key: "ArrowDown",
    description: "Next page",
    handler: nextPageHandler,
    preventDefault: false,
  });

  useKeyboardShortcut({
    id: "reader:toggle-toc",
    key: "\\",
    ctrl: true,
    description: "Toggle table of contents",
    handler: useCallback(() => {
      const api = dockviewApiRef.current;
      if (!api) return;
      const tocPanel = api.getPanel("toc");
      if (tocPanel) {
        api.removePanel(tocPanel);
      } else {
        api.addPanel({
          id: "toc",
          component: "toc",
          title: "Table of Contents",
          position: { direction: "left" },
        });
      }
    }, []),
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
    id: "reader:add-comment",
    key: "c",
    ctrl: true,
    shift: true,
    description: "Add comment to selection",
    handler: useCallback(() => {
      const { contextMenu } = useAnnotationStore.getState();
      if (contextMenu.visible && contextMenu.selection) {
        // If context menu is visible with a selection, prompt for comment
        const text = prompt("Add comment:");
        if (text?.trim()) {
          useAnnotationStore.getState().addComment(contextMenu.selection, text.trim());
        }
      }
    }, []),
  });

  const openPdfOnCanvas = useCallback(() => {
    const api = dockviewApiRef.current;
    if (!api) return;
    const activeDoc = useReaderStore.getState().getActiveDoc();
    if (!activeDoc?.meta?.fileUrl) return;

    const whiteboardId = useWhiteboardStore.getState().createWhiteboard();
    const panelId = `whiteboard-pdf-${whiteboardId}`;
    api.addPanel({
      id: panelId,
      component: "whiteboard",
      title: "PDF Canvas",
      params: {
        whiteboardId,
        pdfDocumentUrl: activeDoc.meta.fileUrl,
      },
      position: { direction: "right" },
    });
  }, []);

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
        title: "Comments",
        position: { direction: "right" },
        initialWidth: 280,
      });
    }
  }, []);

  useKeyboardShortcut({
    id: "reader:toggle-comments",
    key: "m",
    ctrl: true,
    description: "Toggle comments panel",
    handler: toggleComments,
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

  // Dockview ready handler
  const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    dockviewApiRef.current = api;

    // Track active panel to update activeDocumentId
    api.onDidActivePanelChange((e) => {
      if (!e) return;
      const panelId = e.id;
      // If it's a viewer panel, extract the docId
      if (panelId.startsWith("viewer-")) {
        const docId = panelId.replace("viewer-", "");
        useReaderStore.getState().setActiveDocument(docId);
      } else if (panelId === "pdfViewer") {
        // Legacy default viewer panel — use the first/only document
        const docs = useReaderStore.getState().documents;
        if (docs.size > 0) {
          useReaderStore.getState().setActiveDocument(Array.from(docs.keys())[0]);
        }
      }
    });

    // Try restoring saved layout
    const saved = loadDockviewLayout();
    if (saved) {
      try {
        api.fromJSON(saved as ReturnType<typeof api.toJSON>);
        return;
      } catch {
        // corrupted layout, fall through to default
      }
    }

    // Default layout: TOC left, PDF viewer center
    api.addPanel({
      id: "pdfViewer",
      component: "pdfViewer",
      title: "Document",
    });

    api.addPanel({
      id: "toc",
      component: "toc",
      title: "Table of Contents",
      position: { direction: "left", referencePanel: "pdfViewer" },
      initialWidth: 256,
    });

    // Debounced layout persistence
    api.onDidLayoutChange(() => {
      if (layoutSaveTimerRef.current) {
        clearTimeout(layoutSaveTimerRef.current);
      }
      layoutSaveTimerRef.current = setTimeout(() => {
        saveDockviewLayout(api.toJSON());
      }, 500);
    });
  }, []);

  return (
    <div
      ref={readerContainerRef}
      className="relative flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] -m-6 -mt-0 flex-col bg-bg-primary"
    >
      {isLoadingDocument && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-accent-purple mb-3" />
          <p className="text-sm text-text-secondary">{loadingMessage}</p>
        </div>
      )}
      {hasDocuments ? (
        <>
          <ReaderToolbar
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            onToggleComments={toggleComments}
            onOpenPdfOnCanvas={openPdfOnCanvas}
          />
          <DockviewReact
            className="pnyxy-dockview-theme flex-1"
            onReady={handleDockviewReady}
            components={dockviewComponents}
          />
        </>
      ) : (
        <EmptyState />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
