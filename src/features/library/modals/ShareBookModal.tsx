import { useEffect, useState } from "react";
import { X, Share2, Check, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useBrowseStore } from "@/stores/browse-store";
import { useCategoryStore } from "@/stores/category-store";
import { containsProfanity } from "@/lib/profanity-filter";
import type { CatalogBookInsert, UploadedLibraryItem } from "@/types/catalog";

interface ShareBookModalProps {
  open: boolean;
  onClose: () => void;
  entry: UploadedLibraryItem;
}

/**
 * Lets a signed-in user submit one of their uploaded books to the
 * community catalog. Only metadata is shared — the binary file stays
 * in the user's private storage until an admin approves and, if
 * applicable, mirrors it to a public download URL.
 */
export function ShareBookModal({ open, onClose, entry }: ShareBookModalProps) {
  const categories = useCategoryStore((s) => s.categories);
  const fetchCategories = useCategoryStore((s) => s.fetchCategories);
  const addBookToCatalog = useBrowseStore((s) => s.addBookToCatalog);

  const [title, setTitle] = useState(entry.book.title);
  const [authors, setAuthors] = useState(entry.book.author ?? "");
  const [description, setDescription] = useState("");
  const [isbn, setIsbn] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(entry.book.title);
    setAuthors(entry.book.author ?? "");
    setDescription("");
    setIsbn("");
    setSelectedCategoryIds(new Set());
    setSubmitting(false);
    setSubmitted(false);
    setError(null);
    if (categories.length === 0) fetchCategories();
  }, [open, entry, categories.length, fetchCategories]);

  const titleFlagged = containsProfanity(title);
  const authorsFlagged = containsProfanity(authors);
  const descriptionFlagged = containsProfanity(description);
  const anyFlagged = titleFlagged || authorsFlagged || descriptionFlagged;

  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (anyFlagged) {
      setError(
        "Please remove disallowed language from the title, authors, or description before sharing.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    const catNames = categories
      .filter((c) => selectedCategoryIds.has(c.id))
      .map((c) => c.name);

    const trimmedIsbn = isbn.trim();
    const payload: CatalogBookInsert = {
      title: title.trim(),
      authors: authors
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      description: description.trim() || null,
      isbn_13: trimmedIsbn.length === 13 ? trimmedIsbn : null,
      isbn_10: trimmedIsbn.length === 10 ? trimmedIsbn : null,
      page_count: entry.book.page_count ?? null,
      categories: catNames,
      source: "user_submitted",
    };

    try {
      await addBookToCatalog(payload, [...selectedCategoryIds]);
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to share book. It may already be in the catalog.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={submitting ? undefined : onClose}
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-glass-border p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Share2 size={18} className="text-accent" />
            Share with community
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
                <Check size={24} className="text-success" />
              </div>
              <p className="text-center text-sm text-text-primary">
                Submitted for review
              </p>
              <p className="max-w-xs text-center text-xs text-text-muted">
                Your submission will appear in the catalog once an admin
                verifies it. Thanks for contributing!
              </p>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-glass-border bg-glass-bg/50 p-3">
                <Info size={14} className="mt-0.5 shrink-0 text-text-muted" />
                <p className="text-xs text-text-muted">
                  Only the metadata below is shared with other users. Your
                  uploaded file stays private. An admin will review the
                  submission before it appears in Browse.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs text-text-muted">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
                {titleFlagged && (
                  <p className="mt-1 text-xs text-warning">
                    Title contains disallowed language.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-text-muted">
                  Authors (comma separated)
                </label>
                <input
                  type="text"
                  value={authors}
                  onChange={(e) => setAuthors(e.target.value)}
                  className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
                {authorsFlagged && (
                  <p className="mt-1 text-xs text-warning">
                    Authors field contains disallowed language.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-text-muted">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short summary to help others decide if they want to read it."
                  className="w-full resize-none rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
                {descriptionFlagged && (
                  <p className="mt-1 text-xs text-warning">
                    Description contains disallowed language.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-text-muted">
                  ISBN (10 or 13 digits, optional)
                </label>
                <input
                  type="text"
                  value={isbn}
                  onChange={(e) => setIsbn(e.target.value)}
                  className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
                />
              </div>

              {/* Category picker */}
              {categories.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs text-text-muted">
                    Categories
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategory(cat.id)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                          selectedCategoryIds.has(cat.id)
                            ? "bg-accent/15 text-accent"
                            : "bg-glass-bg text-text-muted hover:text-text-primary border border-glass-border",
                        )}
                      >
                        {selectedCategoryIds.has(cat.id) && (
                          <Check size={10} className="mr-1 inline -mt-0.5" />
                        )}
                        {cat.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-glass-border p-4">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || anyFlagged || !title.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Share2 size={16} />
                  Submit for review
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
