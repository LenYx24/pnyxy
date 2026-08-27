import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  StickyNote,
  Highlighter,
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Camera,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useBook } from "../BookPageContext";
import { useNoteStore } from "@/stores/note-store";
import { loadHighlights, loadComments } from "@/lib/annotation-storage";
import { ocrImage, OcrUnavailableError } from "@/lib/ai/ocr";
import type { Highlight, Comment } from "@/types/annotation";
import { cn } from "@/lib/cn";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function HighlightRow({ h }: { h: Highlight }) {
  const pageNums = [...new Set(h.selection.rects.map((r) => r.pageNum))];
  const pageLabel =
    pageNums.length === 1
      ? `p. ${pageNums[0]}`
      : `pp. ${pageNums[0]}–${pageNums[pageNums.length - 1]}`;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 transition-colors hover:bg-glass-hover">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
          <Highlighter size={12} /> {pageLabel}
        </span>
        <span className="text-2xs text-text-muted">
          {formatDate(h.createdAt)}
        </span>
      </div>
      <p className="line-clamp-3 text-sm text-text-secondary">
        {h.selection.text}
      </p>
    </div>
  );
}

function CommentRow({ c }: { c: Comment }) {
  const pageNum = c.selection.rects[0]?.pageNum ?? 0;
  const latest = c.messages[c.messages.length - 1];
  return (
    <div className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 transition-colors hover:bg-glass-hover">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-text-muted">
          <MessageSquare size={12} /> p. {pageNum}
          {c.resolved && <span className="ml-1 text-success">✓</span>}
        </span>
        <span className="text-2xs text-text-muted">
          {formatDate(c.createdAt)}
        </span>
      </div>
      <p className="line-clamp-2 text-xs italic text-text-muted">
        “{c.selection.text}”
      </p>
      {latest && (
        <p className="mt-1 line-clamp-3 text-sm text-text-secondary">
          {latest.text}
        </p>
      )}
    </div>
  );
}

/**
 * Inline editor for a single freestanding note. Edits in place,
 * autosaves on blur (and on the Save button); replaces the old
 * "create note → redirect to /reader" flow that yanked the user
 * out of the book detail page every time.
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

  // Note can disappear out from under us (deleted on another tab).
  // Bail without trying to render an empty editor.
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
        rows={6}
        className="block w-full resize-y rounded border border-glass-border bg-bg-primary/50 px-2 py-1.5 text-sm text-text-secondary outline-none placeholder:text-text-muted focus:border-accent/60"
      />
    </div>
  );
}

export function NotesTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const openedFrom = location.pathname + location.search;
  const book = useBook();
  const documentId = book.book.id;

  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // OCR capture state, single file input, single in-flight OCR
  // run. Errors render as a dismissable banner under the action row.
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadHighlights(documentId),
      loadComments(documentId),
      loadNotes(),
    ]).then(([hs, cs]) => {
      if (cancelled) return;
      setHighlights(hs.slice().sort((a, b) => b.createdAt - a.createdAt));
      setComments(cs.slice().sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, loadNotes]);

  const handleCreateNote = () => {
    const id = createNote();
    setEditingId(id);
  };

  const handleDelete = (id: string) => {
    deleteNote(id);
    if (editingId === id) setEditingId(null);
  };

  /** Open the camera (or file picker on desktop) so the user can
   *  snap a page from a physical book. Result is OCR'd by the
   *  vision-capable AI provider and dropped into a new note,
   *  pre-opened in the editor for trimming. */
  const handleCapture = () => {
    setOcrError(null);
    ocrInputRef.current?.click();
  };

  const handleCaptureFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the value so picking the same image twice still
    // fires onChange the second time.
    e.target.value = "";
    if (!file) return;
    setOcrError(null);
    setOcrBusy(true);
    try {
      const text = await ocrImage(file);
      if (!text) {
        setOcrError(t("book.overview.ocr.emptyResult"));
        return;
      }
      // Date-stamped title so multiple captures don't collide on a
      // generic "Captured passage" label in the notes list.
      const today = new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const id = createNote();
      updateNote(id, {
        title: `${t("book.overview.ocr.noteTitlePrefix")} · ${today}`,
        content: text,
      });
      setEditingId(id);
    } catch (err) {
      if (err instanceof OcrUnavailableError) {
        setOcrError(t("book.overview.ocr.noVisionProvider"));
      } else {
        setOcrError(t("book.overview.ocr.failed"));
      }
    } finally {
      setOcrBusy(false);
    }
  };

  const isEmpty =
    highlights.length === 0 && comments.length === 0 && notes.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {t("book.notes.heading")}
          </h2>
          <p className="text-sm text-text-muted">
            {t("book.notes.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleCapture}
            disabled={ocrBusy}
            className="px-3 py-1.5 text-xs sm:text-sm"
          >
            {ocrBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Camera size={14} />
            )}
            <span className="hidden sm:inline">
              {t("book.overview.ocr.button")}
            </span>
            <span className="sm:hidden">
              {t("book.overview.ocr.buttonShort")}
            </span>
          </Button>
          <Button
            variant="primary"
            onClick={handleCreateNote}
            className="px-3 py-1.5 text-xs sm:text-sm"
          >
            <Plus size={14} />
            {t("book.notes.newNote")}
          </Button>
        </div>
      </div>
      {/* `capture="environment"` opens the back camera on phones; on
          desktop it falls back to the file picker. accept=image/*
          plus the picker means any phone-saved screenshot works
          too. */}
      <input
        ref={ocrInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCaptureFile}
      />
      {ocrBusy && (
        <p
          className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent"
          role="status"
        >
          {t("book.overview.ocr.processing")}
        </p>
      )}
      {ocrError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <span>{ocrError}</span>
          <button
            type="button"
            onClick={() => setOcrError(null)}
            aria-label={t("common.close")}
            className="shrink-0 rounded p-0.5 text-warning/80 transition-colors hover:bg-warning/15 hover:text-warning cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {loading && (
        <p className="text-sm text-text-muted">{t("book.notes.loading")}</p>
      )}

      {!loading && isEmpty && (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
          <StickyNote size={28} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">
            {t("book.notes.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.notes.emptyBody")}
          </p>
        </div>
      )}

      {!loading && highlights.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Highlighter size={14} className="text-warning" />
            {t("book.notes.highlights")}
            <span className="text-xs font-normal text-text-muted">
              ({highlights.length})
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {highlights.map((h) => (
              <button
                key={h.id}
                onClick={() =>
                  navigate(`/reader/${documentId}`, {
                    state: { from: openedFrom },
                  })
                }
                className="text-left cursor-pointer"
              >
                <HighlightRow h={h} />
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && comments.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <MessageSquare size={14} className="text-accent" />
            {t("book.notes.comments")}
            <span className="text-xs font-normal text-text-muted">
              ({comments.length})
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {comments.map((c) => (
              <button
                key={c.id}
                onClick={() =>
                  navigate(`/reader/${documentId}`, {
                    state: { from: openedFrom },
                  })
                }
                className="text-left cursor-pointer"
              >
                <CommentRow c={c} />
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && notes.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <StickyNote size={14} className="text-blue-400" />
              {t("book.notes.notes")}
              <span className="text-xs font-normal text-text-muted">
                ({notes.length})
              </span>
            </h3>
            <span className="text-2xs text-text-muted">
              {t("book.notes.notesGlobal")}
            </span>
          </div>
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
                  <button
                    type="button"
                    onClick={() => setEditingId(n.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    aria-label={t("common.open")}
                  >
                    <p className="truncate text-sm font-medium text-text-primary">
                      {n.title || t("book.notes.untitled")}
                    </p>
                    <p className="line-clamp-2 text-xs text-text-muted">
                      {n.content || t("book.notes.emptyNote")}
                    </p>
                  </button>
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
                    onClick={() => handleDelete(n.id)}
                    className="rounded p-1 text-text-muted opacity-0 transition-opacity hover:bg-glass-hover hover:text-danger group-hover:opacity-100 cursor-pointer"
                    aria-label={t("common.delete")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}
