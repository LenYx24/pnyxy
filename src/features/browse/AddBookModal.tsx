import { useState, useCallback, useRef, useEffect } from "react";
import {
  X,
  Search,
  Check,
  Loader2,
  Download,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getProviders } from "@/lib/book-providers";
import type { ProviderBook } from "@/lib/book-providers";
import { useBrowseStore } from "@/stores/browse-store";
import { useCategoryStore } from "@/stores/category-store";
import type { CatalogBookInsert } from "@/types/catalog";

type Tab = "search" | "url" | "manual";

interface AddBookModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddBookModal({ open, onClose }: AddBookModalProps) {
  const [tab, setTab] = useState<Tab>("search");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const addBookToCatalog = useBrowseStore((s) => s.addBookToCatalog);
  const addBooksToCatalog = useBrowseStore((s) => s.addBooksToCatalog);

  const handleSubmit = async (book: CatalogBookInsert, categoryIds?: string[]) => {
    setSubmitting(true);
    setError(null);
    try {
      await addBookToCatalog(book, categoryIds);
      setSubmittedCount(1);
      setSubmitted(true);
    } catch {
      setError("Failed to submit book. It may already exist in the catalog.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchSubmit = async (books: CatalogBookInsert[]) => {
    setSubmitting(true);
    setError(null);
    try {
      await addBooksToCatalog(books);
      setSubmittedCount(books.length);
      setSubmitted(true);
    } catch {
      setError(
        "Failed to submit books. Some may already exist in the catalog.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setTab("search");
    setSubmitted(false);
    setError(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Add a Book
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {submitted ? (
            <SuccessMessage onClose={handleClose} count={submittedCount} />
          ) : (
            <>
              {/* Tab toggle */}
              <div className="mb-4 flex gap-2">
                {(
                  [
                    { id: "search", label: "Search" },
                    { id: "url", label: "Import URL" },
                    { id: "manual", label: "Manual" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTab(t.id);
                      setError(null);
                    }}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      tab === t.id
                        ? "bg-accent-purple/15 text-accent-purple"
                        : "text-text-muted hover:text-text-primary",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {error && (
                <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </p>
              )}

              {tab === "search" && (
                <SearchTab
                  onBatchSubmit={handleBatchSubmit}
                  submitting={submitting}
                />
              )}
              {tab === "url" && (
                <UrlImportTab
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  setError={setError}
                />
              )}
              {tab === "manual" && (
                <ManualTab
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  setError={setError}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Success message ─────────────────────────────────────────

function SuccessMessage({
  onClose,
  count = 1,
}: {
  onClose: () => void;
  count?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
        <Check size={24} className="text-green-400" />
      </div>
      <p className="text-center text-sm text-text-primary">
        {count > 1
          ? `${count} books submitted successfully!`
          : "Book submitted successfully!"}
      </p>
      <p className="text-center text-xs text-text-muted">
        {count > 1
          ? "They will appear in the catalog once verified by an admin."
          : "It will appear in the catalog once verified by an admin."}
      </p>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

// ── Search tab (provider-based) ─────────────────────────────

function SearchTab({
  onBatchSubmit,
  submitting,
}: {
  onBatchSubmit: (books: CatalogBookInsert[]) => Promise<void>;
  submitting: boolean;
}) {
  const providers = getProviders();
  const [providerId, setProviderId] = useState(providers[0].id);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProviderBook[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<
    Map<string, ProviderBook>
  >(() => new Map());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const provider = providers.find((p) => p.id === providerId) ?? providers[0];

  const getBookKey = (book: ProviderBook) => book.source_id ?? book.title;

  const toggleBook = (book: ProviderBook) => {
    const key = getBookKey(book);
    setSelectedBooks((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, book);
      }
      return next;
    });
  };

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setSelectedBooks(new Map());
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        setResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const data = await provider.search(value, 1, 10);
          setResults(data.books);
        } catch {
          setResults([]);
        } finally {
          setSearching(false);
        }
      }, 400);
    },
    [provider],
  );

  const selectionCount = selectedBooks.size;

  return (
    <>
      {/* Provider selector (shown when multiple providers exist) */}
      {providers.length > 1 && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-text-muted">Source</label>
          <select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setResults([]);
              setSelectedBooks(new Map());
            }}
            className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary focus:border-accent-purple/50 focus:outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Search input */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          placeholder={`Search ${provider.name}...`}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-lg border border-glass-border bg-bg-primary/50 py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
        />
        {searching && (
          <Loader2
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-text-muted"
          />
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="mb-4 max-h-60 space-y-1 overflow-y-auto">
          {results.map((book) => {
            const key = getBookKey(book);
            const isSelected = selectedBooks.has(key);
            return (
              <button
                key={key}
                onClick={() => toggleBook(book)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left transition-colors cursor-pointer",
                  isSelected
                    ? "bg-accent-purple/15 border border-accent-purple/30"
                    : "hover:bg-glass-hover border border-transparent",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        isSelected
                          ? "border-accent-purple bg-accent-purple"
                          : "border-glass-border",
                      )}
                    >
                      {isSelected && (
                        <Check size={10} className="text-white" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {book.title}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {book.authors?.join(", ") || "Unknown author"}
                        {book.published_date && ` (${book.published_date})`}
                      </p>
                    </div>
                  </div>
                  {book.downloadable && (
                    <span className="ml-2 flex shrink-0 items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-green-400">
                      <Download size={10} />
                      Free
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Submit bar */}
      {selectionCount > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-glass-border bg-bg-secondary/95 px-3 py-2 backdrop-blur-sm">
          <span className="text-xs text-text-muted">
            {selectionCount} {selectionCount === 1 ? "book" : "books"} selected
          </span>
          <Button
            className="px-3 py-1.5 text-xs"
            onClick={() =>
              onBatchSubmit([...selectedBooks.values()] as CatalogBookInsert[])
            }
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              `Add ${selectionCount} ${selectionCount === 1 ? "Book" : "Books"}`
            )}
          </Button>
        </div>
      )}
    </>
  );
}

// ── URL import tab ──────────────────────────────────────────

function UrlImportTab({
  onSubmit,
  submitting,
  setError,
}: {
  onSubmit: (book: CatalogBookInsert) => Promise<void>;
  submitting: boolean;
  setError: (err: string | null) => void;
}) {
  const [form, setForm] = useState({
    url: "",
    title: "",
    authors: "",
  });

  const handleSubmit = () => {
    if (!form.url.trim()) {
      setError("Download URL is required.");
      return;
    }
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      new URL(form.url.trim());
    } catch {
      setError("Please enter a valid URL.");
      return;
    }

    const book: CatalogBookInsert = {
      title: form.title.trim(),
      authors: form.authors
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      download_url: form.url.trim(),
      source: "user_submitted",
    };
    onSubmit(book);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        Paste a direct link to a PDF or EPUB file. Only use links to books you
        have the right to access.
      </p>

      <div className="relative">
        <LinkIcon
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="url"
          placeholder="https://example.com/book.pdf"
          value={form.url}
          onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          className="w-full rounded-lg border border-glass-border bg-bg-primary/50 py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
        />
      </div>
      <input
        type="text"
        placeholder="Title *"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
      />
      <input
        type="text"
        placeholder="Authors (comma separated)"
        value={form.authors}
        onChange={(e) =>
          setForm((f) => ({ ...f, authors: e.target.value }))
        }
        className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
      />

      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          "Submit for Review"
        )}
      </Button>
    </div>
  );
}

// ── Manual entry tab ────────────────────────────────────────

function ManualTab({
  onSubmit,
  submitting,
  setError,
}: {
  onSubmit: (book: CatalogBookInsert, categoryIds?: string[]) => Promise<void>;
  submitting: boolean;
  setError: (err: string | null) => void;
}) {
  const categories = useCategoryStore((s) => s.categories);
  const fetchCategories = useCategoryStore((s) => s.fetchCategories);

  useEffect(() => {
    if (categories.length === 0) fetchCategories();
  }, [categories.length, fetchCategories]);

  const [form, setForm] = useState({
    title: "",
    authors: "",
    description: "",
    isbn: "",
  });
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(
    new Set(),
  );

  const toggleCategory = (id: string) => {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    // Build categories text array from selected category names (backward compat)
    const catNames = categories
      .filter((c) => selectedCategoryIds.has(c.id))
      .map((c) => c.name);

    const book: CatalogBookInsert = {
      title: form.title.trim(),
      authors: form.authors
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      description: form.description.trim() || null,
      isbn_13:
        form.isbn.trim().length === 13 ? form.isbn.trim() : null,
      isbn_10:
        form.isbn.trim().length === 10 ? form.isbn.trim() : null,
      categories: catNames,
      source: "user_submitted",
    };
    onSubmit(book, [...selectedCategoryIds]);
  };

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Title *"
        value={form.title}
        onChange={(e) =>
          setForm((f) => ({ ...f, title: e.target.value }))
        }
        className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
      />
      <input
        type="text"
        placeholder="Authors (comma separated)"
        value={form.authors}
        onChange={(e) =>
          setForm((f) => ({ ...f, authors: e.target.value }))
        }
        className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
      />
      <textarea
        placeholder="Description"
        rows={3}
        value={form.description}
        onChange={(e) =>
          setForm((f) => ({ ...f, description: e.target.value }))
        }
        className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none resize-none"
      />
      <input
        type="text"
        placeholder="ISBN (10 or 13 digits)"
        value={form.isbn}
        onChange={(e) =>
          setForm((f) => ({ ...f, isbn: e.target.value }))
        }
        className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple/50 focus:outline-none"
      />

      {/* Category picker */}
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
                  ? "bg-accent-purple/15 text-accent-purple"
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

      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          "Submit for Review"
        )}
      </Button>
    </div>
  );
}
