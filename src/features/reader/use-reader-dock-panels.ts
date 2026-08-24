import { useCallback } from "react";
import type { DockviewApi } from "dockview";
import i18n from "@/lib/i18n";
import { useNoteStore } from "@/stores/note-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";

export interface ReaderDockPanels {
  openNote: (noteId: string) => void;
  createNote: () => void;
  openWhiteboard: (whiteboardId: string) => void;
  createWhiteboard: () => void;
  deleteNote: (noteId: string) => void;
  deleteWhiteboard: (whiteboardId: string) => void;
}

/**
 * Note / whiteboard dockview-panel open/create/delete logic, shared by
 * the reader's left TOC-panel launcher and the right tools-panel tabs.
 * Every editor opens as a panel to the right of the viewer; opening an
 * already-open note/whiteboard just re-activates its panel.
 */
export function useReaderDockPanels(
  // undefined on the mobile tools panel, which never renders the
  // note/whiteboard tabs, the handlers just no-op there.
  dockviewApi: DockviewApi | undefined,
): ReaderDockPanels {
  const openNote = useCallback(
    (noteId: string) => {
      if (!dockviewApi) return;
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

  const createNote = useCallback(() => {
    if (!dockviewApi) return;
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

  const openWhiteboard = useCallback(
    (whiteboardId: string) => {
      if (!dockviewApi) return;
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

  const createWhiteboard = useCallback(() => {
    if (!dockviewApi) return;
    const activeDoc = useReaderStore.getState().getActiveDoc();
    const allowAll = useSettingsStore.getState()
      .experimental_allowWhiteboardForAllFormats;
    if (activeDoc && !activeDoc.meta.capabilities.paginated && !allowAll) {
      return;
    }
    // Tag the new whiteboard with the active doc so the reader can filter
    // to "this book only"; without it every reader-created whiteboard
    // would show up across every other book.
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

  const deleteNote = useCallback(
    (noteId: string) => {
      if (!dockviewApi) return;
      const existing = dockviewApi.getPanel(`note-${noteId}`);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  const deleteWhiteboard = useCallback(
    (whiteboardId: string) => {
      if (!dockviewApi) return;
      const existing = dockviewApi.getPanel(`whiteboard-${whiteboardId}`);
      if (existing) dockviewApi.removePanel(existing);
    },
    [dockviewApi],
  );

  return {
    openNote,
    createNote,
    openWhiteboard,
    createWhiteboard,
    deleteNote,
    deleteWhiteboard,
  };
}
