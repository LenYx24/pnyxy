import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { X, BookPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useLibraryStore } from "@/stores/library-store";
import { useOrgStore } from "@/stores/org-store";
import { parseAuthorsInput } from "@/lib/library/format-authors";
import { logError } from "@/lib/logger";

interface AddManualBookModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Add a book to the user's library as pure metadata, no file.
 * "Shell book" use case: a physical copy the user owns, or a book
 * they want to discuss/take notes on without uploading the PDF.
 *
 * Inserts one row into `books` with no corresponding `book_files`
 * row. The existing library UX already handles this: the Read
 * button hides when no file exists, but notes / forum / streaks /
 * annotations keyed to a page number all still work.
 */
export function AddManualBookModal({ open, onClose }: AddManualBookModalProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const currentFolderId = useLibraryStore((s) => s.currentFolderId);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [isbn, setIsbn] = useState("");
  const [pages, setPages] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setAuthor("");
      setCoverUrl("");
      setIsbn("");
      setPages("");
      setDescription("");
      setError(null);
      setSubmitting(false);
      const timer = setTimeout(() => titleRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      setError(t("library.addManual.signInRequired"));
      return;
    }
    const trimmedTitle = title.trim();
    // Authors are comma-separated; store the structured list and keep
    // the joined string in `author` for legacy readers. Authors are
    // optional, only a title is required.
    const parsedAuthors = parseAuthorsInput(author);
    if (!trimmedTitle) {
      setError(t("library.addManual.titleRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const parsedPages = pages.trim() ? Number(pages) : null;
      if (parsedPages != null && (!Number.isFinite(parsedPages) || parsedPages < 0)) {
        throw new Error(t("library.addManual.pagesInvalid"));
      }

      const orgId = useOrgStore.getState().currentOrgId;
      if (!orgId) {
        throw new Error(t("library.addManual.noActiveOrg"));
      }

      const { error: insertErr } = await supabase.from("books").insert({
        user_id: user.id,
        org_id: orgId,
        // Land manually-added books in whichever folder the user
        // is currently looking at, mirroring the upload behaviour.
        folder_id: currentFolderId ?? null,
        title: trimmedTitle,
        authors: parsedAuthors,
        author: parsedAuthors.join(", "),
        cover_url: coverUrl.trim() || null,
        page_count: parsedPages,
        metadata: {
          isbn: isbn.trim() || null,
          description: description.trim() || null,
          manual_entry: true,
        },
      });
      if (insertErr) throw insertErr;

      await fetchLibrary(true);
      onClose();
    } catch (err) {
      logError("AddManualBookModal", err);
      setError(
        err instanceof Error ? err.message : t("library.addManual.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !submitting && onClose()}
      />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <BookPlus size={16} className="text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("library.addManual.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
          <p className="text-xs text-text-muted">
            {t("library.addManual.hint")}
          </p>

          <div>
            <label htmlFor="manual-title" className="mb-1 block text-sm font-medium text-text-secondary">
              {t("library.addManual.titleLabel")} *
            </label>
            <input
              id="manual-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
            />
          </div>

          <div>
            <label htmlFor="manual-author" className="mb-1 block text-sm font-medium text-text-secondary">
              {t("library.addManual.authorLabel")}
            </label>
            <input
              id="manual-author"
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t("library.addManual.authorsPlaceholder")}
              maxLength={500}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
            />
          </div>

          <div>
            <label htmlFor="manual-cover" className="mb-1 block text-sm font-medium text-text-secondary">
              {t("library.addManual.coverUrlLabel")}
            </label>
            <input
              id="manual-cover"
              type="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="manual-isbn" className="mb-1 block text-sm font-medium text-text-secondary">
                {t("library.addManual.isbnLabel")}
              </label>
              <input
                id="manual-isbn"
                type="text"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="978…"
                className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
              />
            </div>
            <div>
              <label htmlFor="manual-pages" className="mb-1 block text-sm font-medium text-text-secondary">
                {t("library.addManual.pagesLabel")}
              </label>
              <input
                id="manual-pages"
                type="number"
                inputMode="numeric"
                min={0}
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
              />
            </div>
          </div>

          <div>
            <label htmlFor="manual-description" className="mb-1 block text-sm font-medium text-text-secondary">
              {t("library.addManual.descriptionLabel")}
            </label>
            <textarea
              id="manual-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting || !title.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t("library.addManual.adding")}
                </>
              ) : (
                t("library.addManual.add")
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
