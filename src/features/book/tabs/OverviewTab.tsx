import { useEffect, useState } from "react";
import {
  Plus,
  Check,
  Download,
  Loader2,
  ExternalLink,
  BookOpen,
  FileText,
  Trash2,
} from "lucide-react";
import { Button, CategoryChip } from "@/components/ui";
import { getDownloadOptions } from "@/lib/open-library";
import { useBrowseStore } from "@/stores/browse-store";
import { useAuthStore } from "@/stores/auth-store";
import {
  useOpenUploadedDocument,
  prefetchBookBlob,
} from "@/hooks/use-open-uploaded-document";
import type {
  CatalogBook,
  DownloadOption,
  UploadedLibraryItem,
} from "@/types/catalog";
import type { Book, Category } from "@/types/database";
import { useBook } from "../BookPageContext";

export function OverviewTab() {
  const data = useBook();
  if (data.source === "catalog") {
    return <CatalogOverview book={data.book} categories={data.categories} />;
  }
  return (
    <UploadedOverview
      book={data.book}
      storagePath={data.storagePath}
      fileName={data.fileName}
      sizeBytes={data.sizeBytes}
      categories={data.categories}
    />
  );
}

function CatalogOverview({
  book,
  categories,
}: {
  book: CatalogBook;
  categories: Category[];
}) {
  const user = useAuthStore((s) => s.user);
  const {
    userLibraryIds,
    addToUserLibrary,
    removeFromUserLibrary,
    checkUserLibrary,
  } = useBrowseStore();
  const [libraryLoading, setLibraryLoading] = useState(false);
  const inLibrary = userLibraryIds.has(book.id);

  useEffect(() => {
    checkUserLibrary();
  }, [checkUserLibrary]);

  let downloads: DownloadOption[] = [];
  if (book.ia_id) {
    downloads = getDownloadOptions(book.ia_id);
  } else if (book.download_url) {
    const ext = book.download_url.split(".").pop()?.toLowerCase();
    const format = ext === "epub" ? "epub" : ext === "txt" ? "txt" : "pdf";
    downloads = [
      { format, url: book.download_url, label: format.toUpperCase() },
    ];
  }

  const handleToggleLibrary = async () => {
    if (!user) return;
    setLibraryLoading(true);
    try {
      if (inLibrary) {
        await removeFromUserLibrary(book.id);
      } else {
        await addToUserLibrary(book.id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLibraryLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {user && (
          <Button
            variant={inLibrary ? "secondary" : "primary"}
            onClick={handleToggleLibrary}
            disabled={libraryLoading}
            aria-label={inLibrary ? "Remove from library" : "Add to library"}
            className={
              inLibrary
                ? "group hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
                : undefined
            }
          >
            {libraryLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : inLibrary ? (
              <>
                <Check size={16} className="group-hover:hidden" />
                <Trash2 size={16} className="hidden group-hover:inline" />
                <span className="group-hover:hidden">In Your Library</span>
                <span className="hidden group-hover:inline">
                  Remove from Library
                </span>
              </>
            ) : (
              <>
                <Plus size={16} />
                Add to My Library
              </>
            )}
          </Button>
        )}
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

      {book.ia_id && (
        <p className="rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-400">
          This book is in the public domain and can be freely downloaded from
          the Internet Archive.
        </p>
      )}

      {book.description && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-text-primary">
            Description
          </h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">
            {book.description}
          </p>
        </div>
      )}

      <MetaGrid
        entries={[
          { label: "Publisher", value: book.publisher },
          { label: "Published", value: book.published_date },
          {
            label: "Pages",
            value: book.page_count ? String(book.page_count) : null,
          },
          { label: "Language", value: book.language },
          { label: "ISBN-13", value: book.isbn_13 },
          { label: "ISBN-10", value: book.isbn_10 },
        ]}
      />

      {(categories.length > 0 || book.categories.length > 0) && (
        <div>
          <span className="text-sm text-text-muted">Categories</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {categories.length > 0
              ? categories.map((cat) => (
                  <CategoryChip key={cat.id} category={cat} />
                ))
              : book.categories.map((cat) => (
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
  );
}

function UploadedOverview({
  book,
  storagePath,
  fileName,
  sizeBytes,
  categories,
}: {
  book: Book;
  storagePath: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  categories: Category[];
}) {
  const { openUploadedBook } = useOpenUploadedDocument();
  const [loading, setLoading] = useState(false);

  // Warm the blob cache in the background so clicking "Open in Reader"
  // skips the network round-trip. Skipped on low-end devices and large
  // files inside prefetchBookBlob; cancelled if the user navigates
  // away before it finishes.
  useEffect(() => {
    if (!storagePath) return;
    return prefetchBookBlob(storagePath, { sizeBytes });
  }, [storagePath, sizeBytes]);

  const handleOpen = async () => {
    if (!storagePath || !fileName) return;
    setLoading(true);
    try {
      const entry: UploadedLibraryItem = {
        source: "uploaded",
        id: book.id,
        folder_id: book.folder_id,
        added_at: book.created_at,
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          cover_url: book.cover_url,
          page_count: book.page_count,
          format: book.format,
          file_hash: book.file_hash,
          storage_path: storagePath,
          size_bytes: sizeBytes,
          file_name: fileName,
        },
      };
      await openUploadedBook(entry);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={handleOpen}
          disabled={loading || !storagePath}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              <BookOpen size={16} />
              Open in Reader
            </>
          )}
        </Button>
      </div>

      <div className="rounded-lg border border-glass-border bg-glass-bg/50 p-4 text-sm">
        <p className="mb-1 flex items-center gap-1.5 text-text-muted">
          <FileText size={14} />
          This is an uploaded file.
        </p>
        <p className="text-xs text-text-secondary">
          Only basic metadata is extracted today. AI-assisted enrichment
          (summary, auto-categorization, cover detection) is planned.
        </p>
      </div>

      <MetaGrid
        entries={[
          {
            label: "Pages",
            value: book.page_count ? String(book.page_count) : null,
          },
          {
            label: "Format",
            value: book.format ? book.format.toUpperCase() : null,
          },
          { label: "Size", value: sizeBytes ? formatBytes(sizeBytes) : null },
          { label: "File name", value: fileName, wide: true },
        ]}
      />

      {categories.length > 0 && (
        <div>
          <span className="text-sm text-text-muted">Categories</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {categories.map((cat) => (
              <CategoryChip key={cat.id} category={cat} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaGrid({
  entries,
}: {
  entries: Array<{ label: string; value: string | null; wide?: boolean }>;
}) {
  const visible = entries.filter((e) => e.value);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      {visible.map((e) => (
        <div key={e.label} className={e.wide ? "sm:col-span-2" : undefined}>
          <span className="text-text-muted">{e.label}</span>
          <p className="truncate text-text-primary">{e.value}</p>
        </div>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
