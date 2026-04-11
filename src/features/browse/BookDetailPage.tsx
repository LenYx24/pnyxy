import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Check,
  Download,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { getDownloadOptions } from "@/lib/open-library";
import { useBrowseStore } from "@/stores/browse-store";
import { useAuthStore } from "@/stores/auth-store";
import type { CatalogBook, DownloadOption } from "@/types/catalog";

export function BookDetailPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const {
    userLibraryIds,
    addToUserLibrary,
    removeFromUserLibrary,
    checkUserLibrary,
  } = useBrowseStore();

  const [book, setBook] = useState<CatalogBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const inLibrary = bookId ? userLibraryIds.has(bookId) : false;

  // Build download options from book data
  let downloads: DownloadOption[] = [];
  if (book?.ia_id) {
    downloads = getDownloadOptions(book.ia_id);
  } else if (book?.download_url) {
    const ext = book.download_url.split(".").pop()?.toLowerCase();
    const format =
      ext === "epub" ? "epub" : ext === "txt" ? "txt" : "pdf";
    downloads = [
      {
        format,
        url: book.download_url,
        label: format.toUpperCase(),
      },
    ];
  }

  useEffect(() => {
    if (!bookId) return;

    (async () => {
      const { data, error } = await supabase
        .from("catalog_books")
        .select("*")
        .eq("id", bookId)
        .single();

      if (error) {
        console.error("Failed to fetch book:", error.message);
      }
      setBook(data);
      setLoading(false);
    })();

    checkUserLibrary();
  }, [bookId, checkUserLibrary]);

  const handleToggleLibrary = async () => {
    if (!bookId || !user) return;
    setLibraryLoading(true);
    try {
      if (inLibrary) {
        await removeFromUserLibrary(bookId);
      } else {
        await addToUserLibrary(bookId);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLibraryLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">Book not found.</p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => navigate("/app/browse")}
        >
          <ArrowLeft size={16} />
          Back to Browse
        </Button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => navigate("/app/browse")}
        className="mb-6 flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
      >
        <ArrowLeft size={16} />
        Back to Browse
      </button>

      <div className="flex flex-col gap-8 md:flex-row">
        {/* Cover */}
        <div className="shrink-0">
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.title}
              className="h-80 w-56 rounded-xl object-cover shadow-lg"
            />
          ) : (
            <div className="flex h-80 w-56 items-center justify-center rounded-xl bg-gradient-to-br from-accent-purple/30 to-accent-blue/30 shadow-lg">
              <BookOpen size={64} className="text-white/20" />
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1">
          <h1 className="mb-2 text-2xl font-bold text-text-primary">
            {book.title}
          </h1>
          <p className="mb-4 text-sm text-text-secondary">
            {book.authors.join(", ") || "Unknown author"}
          </p>

          {/* Action buttons */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Library toggle */}
            {user && (
              <Button
                variant={inLibrary ? "secondary" : "primary"}
                onClick={handleToggleLibrary}
                disabled={libraryLoading}
              >
                {libraryLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : inLibrary ? (
                  <>
                    <Check size={16} />
                    In Your Library
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Add to My Library
                  </>
                )}
              </Button>
            )}

            {/* Download buttons */}
            {downloads.map((dl) => (
              <a
                key={dl.format}
                href={dl.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-5 py-2.5 text-sm font-medium text-text-primary backdrop-blur-md transition-all duration-200 hover:bg-glass-hover"
              >
                <Download size={16} />
                {dl.label}
                <ExternalLink size={12} className="text-text-muted" />
              </a>
            ))}
          </div>

          {/* Public domain notice */}
          {book.ia_id && (
            <p className="mb-6 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-400">
              This book is in the public domain and can be freely downloaded
              from the Internet Archive.
            </p>
          )}

          {book.description && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-text-primary">
                Description
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                {book.description}
              </p>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {book.publisher && (
              <div>
                <span className="text-text-muted">Publisher</span>
                <p className="text-text-primary">{book.publisher}</p>
              </div>
            )}
            {book.published_date && (
              <div>
                <span className="text-text-muted">Published</span>
                <p className="text-text-primary">{book.published_date}</p>
              </div>
            )}
            {book.page_count && (
              <div>
                <span className="text-text-muted">Pages</span>
                <p className="text-text-primary">{book.page_count}</p>
              </div>
            )}
            {book.language && (
              <div>
                <span className="text-text-muted">Language</span>
                <p className="text-text-primary">{book.language}</p>
              </div>
            )}
            {book.isbn_13 && (
              <div>
                <span className="text-text-muted">ISBN-13</span>
                <p className="text-text-primary">{book.isbn_13}</p>
              </div>
            )}
            {book.isbn_10 && (
              <div>
                <span className="text-text-muted">ISBN-10</span>
                <p className="text-text-primary">{book.isbn_10}</p>
              </div>
            )}
          </div>

          {/* Categories */}
          {book.categories.length > 0 && (
            <div className="mt-6">
              <span className="text-sm text-text-muted">Categories</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {book.categories.map((cat) => (
                  <span
                    key={cat}
                    className="rounded-full bg-accent-purple/10 px-3 py-1 text-xs font-medium text-accent-purple"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
