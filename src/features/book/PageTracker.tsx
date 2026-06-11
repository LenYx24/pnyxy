import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Check, Pencil, X } from "lucide-react";
import { fetchResumeState, saveResumeState } from "@/lib/resume-state";
import { cn } from "@/lib/cn";

interface PageTrackerProps {
  /** Same identifier the reader uses (uploaded book uuid OR catalog
   *  uuid OR PDF hash) — keyed against book_resume_state.doc_id. */
  docId: string;
  /** Total pages, when known. Catalog books often have this; manual
   *  shell entries might not. Hidden in the UI when null. */
  pageCount: number | null;
}

/**
 * Compact "Page X of N" widget for the book detail sidebar. Doubles
 * as a manual progress setter for physical-book / metadata-only
 * users — set it once, sync to cloud, see your progress next time.
 * Reuses the existing book_resume_state table the in-app reader
 * already syncs to, so a manual entry from the sidebar and the
 * reader's auto-tracked position live in the same place.
 */
export function PageTracker({ docId, pageCount }: PageTrackerProps) {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Reset on docId change without a setState-in-effect: the
  // in-render guard pattern from the React docs avoids the stale
  // "loaded for previous book" flash when the user navigates
  // between two books that share this component instance.
  const [docIdSnapshot, setDocIdSnapshot] = useState(docId);
  if (docIdSnapshot !== docId) {
    setDocIdSnapshot(docId);
    setLoading(true);
    setCurrentPage(null);
    setEditing(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetchResumeState(docId).then((row) => {
      if (cancelled) return;
      setCurrentPage(row?.page ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const handleStartEdit = () => {
    setDraft(String(currentPage ?? ""));
    setEditing(true);
  };

  const handleSave = async () => {
    const parsed = parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setEditing(false);
      return;
    }
    // Clamp to total pages when we know it — catches typos like
    // "210" on a 200-page book without bothering the user.
    const clamped = pageCount ? Math.min(parsed, pageCount) : parsed;
    setSaving(true);
    await saveResumeState(docId, { page: clamped });
    setCurrentPage(clamped);
    setSaving(false);
    setEditing(false);
  };

  if (loading) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-glass-border bg-bg-primary/40 px-2 py-1 text-2xs text-text-secondary">
      <Bookmark size={11} className="text-accent" />
      {editing ? (
        <>
          <input
            autoFocus
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
              if (e.key === "Escape") setEditing(false);
            }}
            min={1}
            max={pageCount ?? undefined}
            className="w-12 rounded border border-glass-border bg-bg-primary px-1 py-0.5 text-2xs text-text-primary outline-none focus:border-accent"
          />
          {pageCount && (
            <span className="text-text-muted">/ {pageCount}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="ml-1 rounded p-0.5 text-success hover:bg-glass-hover cursor-pointer disabled:opacity-50"
            aria-label={t("common.save")}
          >
            <Check size={11} />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded p-0.5 text-text-muted hover:bg-glass-hover cursor-pointer"
            aria-label={t("common.cancel")}
          >
            <X size={11} />
          </button>
        </>
      ) : (
        <button
          onClick={handleStartEdit}
          title={t("book.pageTracker.editTitle")}
          className={cn(
            "group flex items-center gap-1 rounded text-text-secondary transition-colors hover:text-text-primary cursor-pointer",
          )}
        >
          {currentPage === null ? (
            <span className="italic text-text-muted">
              {t("book.pageTracker.notStarted")}
            </span>
          ) : pageCount ? (
            <span className="tabular-nums">
              {t("book.pageTracker.progress", {
                current: currentPage,
                total: pageCount,
              })}
            </span>
          ) : (
            <span className="tabular-nums">
              {t("book.pageTracker.currentOnly", { current: currentPage })}
            </span>
          )}
          <Pencil
            size={10}
            className="opacity-0 transition-opacity group-hover:opacity-60"
          />
        </button>
      )}
    </div>
  );
}
