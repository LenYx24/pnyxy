import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { BookOpen, FilePlus } from "lucide-react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview";
import { ReaderSidebarContent } from "./ReaderSidebar";
import { ReaderToolbar } from "./ReaderToolbar";
import { PdfViewer } from "./PdfViewer";
import { useReaderStore } from "@/stores/reader-store";
import { getFile } from "@/lib/file-store";
import { createPdfAdapter } from "./adapters/pdf-adapter";
import { useOpenPdf } from "@/hooks/use-open-pdf";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { Button } from "@/components/ui";
import { saveDockviewLayout, loadDockviewLayout } from "@/stores/ui-store";

function TocPanel(_props: IDockviewPanelProps) {
  return <ReaderSidebarContent />;
}

function ViewerPanel(_props: IDockviewPanelProps) {
  return <PdfViewer />;
}

const dockviewComponents = {
  toc: TocPanel,
  pdfViewer: ViewerPanel,
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
  const meta = useReaderStore((s) => s.meta);
  const openDocument = useReaderStore((s) => s.openDocument);
  const goToPage = useReaderStore((s) => s.goToPage);
  const zoomIn = useReaderStore((s) => s.zoomIn);
  const zoomOut = useReaderStore((s) => s.zoomOut);
  const setZoomMode = useReaderStore((s) => s.setZoomMode);

  const dockviewApiRef = useRef<DockviewApi | null>(null);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenPdf();

  // Load document from file registry if navigated directly
  useEffect(() => {
    if (bookId && !meta) {
      const file = getFile(bookId);
      if (file) {
        const adapter = createPdfAdapter();
        openDocument(adapter, file);
      }
    }
  }, [bookId, meta, openDocument]);

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
    handler: zoomIn,
  });

  useKeyboardShortcut({
    id: "reader:zoom-out",
    key: "-",
    ctrl: true,
    description: "Zoom out",
    handler: zoomOut,
  });

  useKeyboardShortcut({
    id: "reader:zoom-reset",
    key: "0",
    ctrl: true,
    description: "Reset zoom to fit width",
    handler: useCallback(() => setZoomMode("fit-width"), [setZoomMode]),
  });

  const prevPageHandler = useCallback(() => {
    const { currentPage } = useReaderStore.getState();
    if (currentPage > 1) goToPage(currentPage - 1);
  }, [goToPage]);

  const nextPageHandler = useCallback(() => {
    const { currentPage, totalPages } = useReaderStore.getState();
    if (currentPage < totalPages) goToPage(currentPage + 1);
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

  // Dockview ready handler
  const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;
    dockviewApiRef.current = api;

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
      className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] -m-6 -mt-0 flex-col bg-bg-primary"
    >
      {meta ? (
        <>
          <ReaderToolbar
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
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
