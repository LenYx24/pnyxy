import { lazy, Suspense, useCallback } from "react";
import { type IDockviewPanelProps } from "dockview";
import { X } from "lucide-react";
import i18n from "@/lib/i18n";
import { useOpenDocument } from "@/hooks/use-open-document";

// Lazy so the reader route doesn't eagerly bundle the note editor's heavy
// CodeMirror stack, it loads only when a note panel is actually opened.
// (An eager import made opening a book pull in + optimize CodeMirror,
// which blanked the reader in dev until Vite finished re-optimizing.)
const NoteEditor = lazy(() =>
  import("@/features/notes/NoteEditor").then((m) => ({ default: m.NoteEditor })),
);
import { ReaderSidebarContent } from "./ReaderSidebar";
import { ActiveViewer } from "./viewers/ActiveViewer";
import { SearchOverlay } from "./popovers/SearchOverlay";
import { CommentsSidebar } from "./panels/CommentsSidebar";

/**
 * Sidebar TOC panel. Notes/whiteboards now live in the right tools
 * panel; the left sidebar keeps contents + bookmarks and the
 * open-another-file launcher.
 */
export function TocPanel() {
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

  const handleOpenFile = useCallback(() => {
    triggerFilePicker();
  }, [triggerFilePicker]);

  return (
    <>
      <ReaderSidebarContent onOpenFile={handleOpenFile} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />
    </>
  );
}

/**
 * The viewer dockview panel, wraps `ActiveViewer` with a `relative`
 * container and mounts the floating search overlay inside it so the
 * overlay's right edge stays aligned with the PDF viewer panel even
 * when AI chat / TOC panels are open beside it.
 */
export function ViewerPanel(
  props: IDockviewPanelProps<{ documentId?: string }>,
) {
  return (
    <div className="relative h-full w-full">
      <ActiveViewer documentId={props.params?.documentId} />
      <SearchOverlay />
    </div>
  );
}

export function CommentsPanel(props: IDockviewPanelProps) {
  const dockviewApi = props.containerApi;
  const handleClose = useCallback(() => {
    const panel = dockviewApi.getPanel("comments");
    if (panel) dockviewApi.removePanel(panel);
  }, [dockviewApi]);
  return <CommentsSidebar onClose={handleClose} />;
}

export function NotePanelWrapper(
  props: IDockviewPanelProps<{ noteId?: string }>,
) {
  const noteId = props.params?.noteId;
  if (!noteId) return null;
  // Single-panel groups hide the dockview tab bar (and its close X), so
  // give the note panel its own close affordance.
  return (
    <div className="relative h-full w-full">
      <Suspense
        fallback={<div className="p-4 text-sm text-text-muted">Loading…</div>}
      >
        <NoteEditor noteId={noteId} />
      </Suspense>
      <button
        type="button"
        onClick={() => props.api.close()}
        aria-label={i18n.t("common.close", { defaultValue: "Close" })}
        title={i18n.t("common.close", { defaultValue: "Close" })}
        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      >
        <X size={16} />
      </button>
    </div>
  );
}
