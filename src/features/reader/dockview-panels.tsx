import { useCallback } from "react";
import { type IDockviewPanelProps } from "dockview";
import i18n from "@/lib/i18n";
import { NoteEditor } from "@/features/notes/NoteEditor";
import { useNoteStore } from "@/stores/note-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useOpenDocument } from "@/hooks/use-open-document";
import { ReaderSidebarContent } from "./ReaderSidebar";
import { ActiveViewer } from "./viewers/ActiveViewer";
import { SearchOverlay } from "./popovers/SearchOverlay";
import { CommentsSidebar } from "./panels/CommentsSidebar";

/**
 * Sidebar TOC panel, wired with the dockview container API so its
 * children (note / whiteboard launchers) can add and remove
 * dockview panels imperatively.
 */
export function TocPanel(props: IDockviewPanelProps) {
  const dockviewApi = props.containerApi;
  const { fileInputRef, triggerFilePicker, handleFileSelect } = useOpenDocument();

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
        title: i18n.t("reader.page.panelNote"),
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
      title: i18n.t("reader.page.panelNewNote"),
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
        title: i18n.t("reader.page.panelWhiteboard"),
        params: { whiteboardId },
        position: { direction: "right" },
      });
    },
    [dockviewApi],
  );

  const handleCreateWhiteboard = useCallback(() => {
    const activeDoc = useReaderStore.getState().getActiveDoc();
    const allowAll = useSettingsStore.getState()
      .experimental_allowWhiteboardForAllFormats;
    if (activeDoc && !activeDoc.meta.capabilities.paginated && !allowAll) {
      return;
    }
    // Tag the new whiteboard with the active doc so the reader sidebar
    // can filter to "this book only", without it, every reader-created
    // whiteboard would still show up across every other book.
    const activeDocId = useReaderStore.getState().activeDocumentId ?? undefined;
    const whiteboardId = useWhiteboardStore
      .getState()
      .createWhiteboard({ bookId: activeDocId });
    const panelId = `whiteboard-${whiteboardId}`;
    dockviewApi.addPanel({
      id: panelId,
      component: "whiteboard",
      title: i18n.t("reader.page.panelNewWhiteboard"),
      params: { whiteboardId },
      position: { direction: "right" },
    });
  }, [dockviewApi]);

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      const panelId = `note-${noteId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  const handleDeleteWhiteboard = useCallback(
    (whiteboardId: string) => {
      const panelId = `whiteboard-${whiteboardId}`;
      const existing = dockviewApi.getPanel(panelId);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  return (
    <>
      <ReaderSidebarContent
        onOpenFile={handleOpenFile}
        onOpenNote={handleOpenNote}
        onCreateNote={handleCreateNote}
        onOpenWhiteboard={handleOpenWhiteboard}
        onCreateWhiteboard={handleCreateWhiteboard}
        onDeleteNote={handleDeleteNote}
        onDeleteWhiteboard={handleDeleteWhiteboard}
      />
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

export function CommentsPanel(_props: IDockviewPanelProps) {
  return <CommentsSidebar />;
}

export function NotePanelWrapper(
  props: IDockviewPanelProps<{ noteId?: string }>,
) {
  const noteId = props.params?.noteId;
  if (!noteId) return null;
  return <NoteEditor noteId={noteId} />;
}
