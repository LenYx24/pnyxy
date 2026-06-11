import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Check,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Inline editor — same shape as the per-book NotesTab editor, but
 * lifted up here so the workspace surface owns its own copy and
 * doesn't reach into book context. Notes are freestanding in
 * IndexedDB regardless of where they're created, so the only
 * difference between the two surfaces is presentation.
 */
function NoteEditor({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNoteStore((s) => s.updateNote);
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");

  if (!note) return null;
  const dirty = title !== note.title || content !== note.content;
  const save = () => {
    if (!dirty) return;
    updateNote(noteId, { title, content });
  };

  return (
    <div className="rounded-lg border border-accent/40 bg-glass-bg/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          placeholder={t("book.notes.titlePlaceholder")}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-text-primary outline-none placeholder:text-text-muted focus:border-glass-border focus:bg-bg-primary/50"
        />
        <button
          onClick={() => {
            save();
            onClose();
          }}
          className="rounded p-1 text-success hover:bg-glass-hover cursor-pointer"
          title={t("common.save")}
        >
          <Check size={14} />
        </button>
        <button
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-glass-hover cursor-pointer"
          title={t("common.close")}
        >
          <X size={14} />
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={save}
        placeholder={t("book.notes.contentPlaceholder")}
        rows={8}
        className="block w-full resize-y rounded border border-glass-border bg-bg-primary/50 px-2 py-1.5 text-sm text-text-secondary outline-none placeholder:text-text-muted focus:border-accent/60"
      />
    </div>
  );
}

export function WorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);

  const whiteboards = useWhiteboardStore((s) => s.whiteboards);
  const loadWhiteboards = useWhiteboardStore((s) => s.loadWhiteboards);
  const createWhiteboard = useWhiteboardStore((s) => s.createWhiteboard);

  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void loadNotes();
    void loadWhiteboards();
  }, [loadNotes, loadWhiteboards]);

  // Workspace shows ONLY freestanding whiteboards — book-tied ones
  // belong to their book detail pages, not the global scratchpad.
  // bookId === undefined is the "no book" signal we set on creation
  // in OverviewTab and the reader's draw-tool auto-create.
  const standaloneWhiteboards = useMemo(
    () =>
      whiteboards
        .filter((w) => !w.bookId)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [whiteboards],
  );

  const handleCreateNote = () => {
    const id = createNote();
    setEditingId(id);
  };

  const handleCreateWhiteboard = () => {
    const id = createWhiteboard({ title: t("workspace.whiteboards.defaultTitle") });
    navigate(`/whiteboards/${id}`);
  };

  const handleDeleteNote = (id: string) => {
    deleteNote(id);
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("workspace.title")}
        </h1>
        <p className="text-sm text-text-secondary">
          {t("workspace.subtitle")}
        </p>
      </header>

      {/* ── Notes ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <StickyNote size={16} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t("workspace.notes.heading")}
              <span className="ml-2 text-xs font-normal text-text-muted">
                ({notes.length})
              </span>
            </h2>
          </div>
          <Button
            variant="primary"
            onClick={handleCreateNote}
            className="px-3 py-1.5 text-xs"
          >
            <Plus size={14} />
            {t("book.notes.newNote")}
          </Button>
        </div>

        {notes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
            <StickyNote size={28} className="mx-auto mb-2 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">
              {t("workspace.notes.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {t("workspace.notes.emptyBody")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notes.map((n) =>
              editingId === n.id ? (
                <NoteEditor
                  key={n.id}
                  noteId={n.id}
                  onClose={() => setEditingId(null)}
                />
              ) : (
                <div
                  key={n.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2 transition-colors hover:bg-glass-hover",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {n.title || t("book.notes.untitled")}
                    </p>
                    <p className="line-clamp-2 text-xs text-text-muted">
                      {n.content || t("book.notes.emptyNote")}
                    </p>
                  </div>
                  <span className="shrink-0 text-2xs text-text-muted">
                    {formatDate(n.updatedAt)}
                  </span>
                  <button
                    onClick={() => setEditingId(n.id)}
                    className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-text-primary group-hover:opacity-100 cursor-pointer"
                    aria-label={t("common.edit")}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDeleteNote(n.id)}
                    className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-danger group-hover:opacity-100 cursor-pointer"
                    aria-label={t("common.delete")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* ── Whiteboards ── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Pencil size={16} className="text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t("workspace.whiteboards.heading")}
              <span className="ml-2 text-xs font-normal text-text-muted">
                ({standaloneWhiteboards.length})
              </span>
            </h2>
          </div>
          <Button
            variant="primary"
            onClick={handleCreateWhiteboard}
            className="px-3 py-1.5 text-xs"
          >
            <Plus size={14} />
            {t("workspace.whiteboards.newEmpty")}
          </Button>
        </div>

        {standaloneWhiteboards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
            <Pencil size={28} className="mx-auto mb-2 text-text-muted" />
            <p className="text-sm font-medium text-text-primary">
              {t("workspace.whiteboards.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {t("workspace.whiteboards.emptyBody")}
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {standaloneWhiteboards.map((wb) => (
              <button
                key={wb.id}
                onClick={() => navigate(`/whiteboards/${wb.id}`)}
                className="flex items-center justify-between gap-3 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-glass-hover cursor-pointer"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Pencil size={14} className="shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {wb.title || t("workspace.whiteboards.untitled")}
                    </p>
                    <p className="text-2xs text-text-muted">
                      {t("workspace.whiteboards.updated", {
                        date: formatDate(wb.updatedAt),
                      })}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-2xs tabular-nums text-text-muted">
                  {wb.elements.length}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
