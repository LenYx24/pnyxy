import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus, StickyNote, PenTool, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { noteDisplayTitle, whiteboardDisplayTitle } from "@/lib/entity-title";
import { useNoteStore } from "@/stores/note-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { ReaderDockPanels } from "../use-reader-dock-panels";

/** Shared header row: title + a "new" button on the right. */
function ListHeader({
  label,
  onCreate,
  createTitle,
  createDisabled,
}: {
  label: string;
  onCreate: () => void;
  createTitle: string;
  createDisabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-glass-border px-2.5 py-1.5">
      <span className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <button
        type="button"
        onClick={onCreate}
        disabled={createDisabled}
        title={createTitle}
        aria-label={createTitle}
        className={cn(
          "flex items-center justify-center rounded-md p-1 transition-colors",
          createDisabled
            ? "cursor-not-allowed text-text-muted/40"
            : "text-text-muted hover:bg-glass-hover hover:text-text-primary cursor-pointer",
        )}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

/** Notes list for the reader's right tools panel. Notes are global (not
 *  book-scoped); clicking one opens it as an editor panel to the right. */
export function ReaderNotesList({ panels }: { panels: ReaderDockPanels }) {
  const { t } = useTranslation();
  const notes = useNoteStore((s) => s.notes);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListHeader
        label={t("reader.sidebar.tabNotes")}
        onCreate={panels.createNote}
        createTitle={t("reader.sidebar.newNote")}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <StickyNote size={20} strokeWidth={1.5} className="text-text-muted" />
            <p className="text-xs text-text-muted">
              {t("reader.sidebar.noNotes")}
            </p>
          </div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              role="button"
              tabIndex={0}
              onClick={() => panels.openNote(note.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  panels.openNote(note.id);
              }}
              className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
            >
              <StickyNote size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {noteDisplayTitle(note, t)}
              </span>
              <a
                href={`/notes/${note.id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={t("reader.tools.openInNewTab")}
                className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
              >
                <ExternalLink size={12} />
              </a>
              <button
                type="button"
                title={t("reader.sidebar.deleteNote")}
                onClick={(e) => {
                  e.stopPropagation();
                  useNoteStore.getState().deleteNote(note.id);
                  panels.deleteNote(note.id);
                }}
                className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100 cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Whiteboards list. Whiteboards anchor to PDF pages, so creation is
 *  gated to paginated docs, and the list is scoped to the active book. */
export function ReaderWhiteboardsList({
  panels,
}: {
  panels: ReaderDockPanels;
}) {
  const { t } = useTranslation();
  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const activeDoc = useReaderStore((s) => s.getActiveDoc());
  const allowAll = useSettingsStore(
    (s) => s.experimental_allowWhiteboardForAllFormats,
  );
  const creationAllowed =
    !activeDoc || activeDoc.meta.capabilities.paginated || allowAll;

  const visible = useMemo(
    () =>
      whiteboards.filter(
        (wb) =>
          !activeDocumentId || !wb.bookId || wb.bookId === activeDocumentId,
      ),
    [whiteboards, activeDocumentId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListHeader
        label={t("reader.sidebar.tabWhiteboards")}
        onCreate={panels.createWhiteboard}
        createDisabled={!creationAllowed}
        createTitle={
          creationAllowed
            ? t("reader.sidebar.newWhiteboard")
            : t("reader.sidebar.whiteboardsGated")
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <PenTool size={20} strokeWidth={1.5} className="text-text-muted" />
            <p className="text-xs text-text-muted">
              {t("reader.sidebar.noWhiteboards")}
            </p>
          </div>
        ) : (
          visible.map((wb) => (
            <div
              key={wb.id}
              role="button"
              tabIndex={0}
              onClick={() => panels.openWhiteboard(wb.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  panels.openWhiteboard(wb.id);
              }}
              className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
            >
              <PenTool size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {whiteboardDisplayTitle(wb, t)}
              </span>
              <a
                href={`/whiteboards/${wb.id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={t("reader.tools.openInNewTab")}
                className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
              >
                <ExternalLink size={12} />
              </a>
              <button
                type="button"
                title={t("reader.sidebar.deleteWhiteboard")}
                onClick={(e) => {
                  e.stopPropagation();
                  useWhiteboardStore.getState().deleteWhiteboard(wb.id);
                  panels.deleteWhiteboard(wb.id);
                }}
                className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100 cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
