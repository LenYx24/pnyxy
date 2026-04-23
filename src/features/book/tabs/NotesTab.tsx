import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { StickyNote, Highlighter, MessageSquare, Plus, BookOpen } from "lucide-react";
import { Button } from "@/components/ui";
import { useBook } from "../BookPageContext";
import { useNoteStore } from "@/stores/note-store";
import { loadHighlights, loadComments } from "@/lib/annotation-storage";
import type { Highlight, Comment } from "@/types/annotation";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function HighlightRow({ h }: { h: Highlight }) {
  const pageNums = [...new Set(h.selection.rects.map((r) => r.pageNum))];
  const pageLabel = pageNums.length === 1 ? `p. ${pageNums[0]}` : `pp. ${pageNums[0]}–${pageNums[pageNums.length - 1]}`;
  return (
    <div className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 transition-colors hover:bg-glass-hover">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          <Highlighter size={12} /> {pageLabel}
        </span>
        <span className="text-[10px] text-text-muted">{formatDate(h.createdAt)}</span>
      </div>
      <p className="line-clamp-3 text-sm text-text-secondary">{h.selection.text}</p>
    </div>
  );
}

function CommentRow({ c }: { c: Comment }) {
  const pageNum = c.selection.rects[0]?.pageNum ?? 0;
  const latest = c.messages[c.messages.length - 1];
  return (
    <div className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 transition-colors hover:bg-glass-hover">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">
          <MessageSquare size={12} /> p. {pageNum}
          {c.resolved && <span className="ml-1 text-green-400">✓</span>}
        </span>
        <span className="text-[10px] text-text-muted">{formatDate(c.createdAt)}</span>
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

export function NotesTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const book = useBook();
  const documentId = book.book.id;

  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      loadHighlights(documentId),
      loadComments(documentId),
      loadNotes(),
    ]).then(([hs, cs]) => {
      if (cancelled) return;
      setHighlights(
        hs.slice().sort((a, b) => b.createdAt - a.createdAt),
      );
      setComments(
        cs.slice().sort((a, b) => b.createdAt - a.createdAt),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, loadNotes]);

  const openReader = () => navigate(`/reader/${documentId}`);

  const handleCreateNote = () => {
    createNote();
    openReader();
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={openReader}
            className="px-3 py-1.5 text-xs sm:text-sm"
          >
            <BookOpen size={14} />
            {t("book.notes.openInReader")}
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
            <Highlighter size={14} className="text-yellow-400" />
            {t("book.notes.highlights")}
            <span className="text-xs font-normal text-text-muted">
              ({highlights.length})
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {highlights.map((h) => (
              <button
                key={h.id}
                onClick={openReader}
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
            <MessageSquare size={14} className="text-accent-purple" />
            {t("book.notes.comments")}
            <span className="text-xs font-normal text-text-muted">
              ({comments.length})
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {comments.map((c) => (
              <button
                key={c.id}
                onClick={openReader}
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
            <span className="text-[10px] text-text-muted">
              {t("book.notes.notesGlobal")}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {notes.map((n) => (
              <button
                key={n.id}
                onClick={openReader}
                className="rounded-lg border border-glass-border bg-glass-bg/40 p-3 text-left transition-colors hover:bg-glass-hover cursor-pointer"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {n.title || t("book.notes.untitled")}
                  </span>
                  <span className="shrink-0 text-[10px] text-text-muted">
                    {formatDate(n.updatedAt)}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-text-muted">
                  {n.content || t("book.notes.emptyNote")}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
