import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Bookmark as BookmarkIcon } from "lucide-react";
import { useBook } from "../BookPageContext";
import {
  loadBookmarks,
  type StoredBookmark,
} from "@/lib/annotation-storage";

/**
 * Read-only bookmark list for the active book. Used to live inside
 * NotesTab as a sub-section; now its own sidebar destination so it
 * shows up at a glance instead of buried under notes/highlights.
 * Click a bookmark → reader at that page.
 */
export function BookmarksTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const book = useBook();
  const documentId = book.book.id;

  const [bookmarks, setBookmarks] = useState<StoredBookmark[]>([]);
  const [loading, setLoading] = useState(true);

  // Reset on documentId change without setState-in-effect.
  const [docSnapshot, setDocSnapshot] = useState(documentId);
  if (docSnapshot !== documentId) {
    setDocSnapshot(documentId);
    setLoading(true);
    setBookmarks([]);
  }

  useEffect(() => {
    let cancelled = false;
    loadBookmarks(documentId).then((bms) => {
      if (cancelled) return;
      setBookmarks(bms.slice().sort((a, b) => a.page - b.page));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">
          {t("book.bookmarks.heading")}
        </h2>
        <p className="text-sm text-text-muted">
          {t("book.bookmarks.description")}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-text-muted">{t("book.notes.loading")}</p>
      )}

      {!loading && bookmarks.length === 0 && (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-8 text-center">
          <BookmarkIcon size={28} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">
            {t("book.bookmarks.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.bookmarks.emptyBody")}
          </p>
        </div>
      )}

      {!loading && bookmarks.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              onClick={() =>
                navigate(`/reader/${documentId}?page=${bm.page}`)
              }
              className="flex items-center gap-3 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2 text-left transition-colors hover:border-accent-purple/40 hover:bg-glass-hover cursor-pointer"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: bm.color }}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {bm.label || t("book.notes.bookmarkUntitled")}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-muted">
                p. {bm.page}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
