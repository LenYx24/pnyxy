import { X } from "lucide-react";
import type { UnifiedLibraryItem } from "@/types/catalog";

interface BookInfoModalProps {
  open: boolean;
  onClose: () => void;
  entry: UnifiedLibraryItem;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs font-medium text-text-muted">{label}</span>
      <span className="text-right text-xs text-text-primary break-all">{value}</span>
    </div>
  );
}

export function BookInfoModal({ open, onClose, entry }: BookInfoModalProps) {
  if (!open) return null;

  const isUploaded = entry.source === "uploaded";
  const title = isUploaded ? entry.book.title : entry.catalog_book.title;
  const author = isUploaded
    ? entry.book.author || "Unknown"
    : entry.catalog_book.authors?.join(", ") || "Unknown";
  const pageCount = isUploaded
    ? entry.book.page_count
    : entry.catalog_book.page_count;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-5 backdrop-blur-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-text-primary truncate">
            File Information
          </h3>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Info rows */}
        <div className="divide-y divide-glass-border/50">
          <InfoRow label="Title" value={title} />
          <InfoRow label="Author" value={author} />
          <InfoRow label="Pages" value={pageCount?.toString()} />
          <InfoRow label="Source" value={isUploaded ? "Uploaded" : "Catalog"} />
          <InfoRow label="Added" value={new Date(entry.added_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })} />

          {isUploaded && (
            <>
              <InfoRow label="Format" value={entry.book.format.toUpperCase()} />
              <InfoRow label="File name" value={entry.book.file_name} />
              <InfoRow
                label="File size"
                value={entry.book.size_bytes ? formatBytes(entry.book.size_bytes) : null}
              />
              <InfoRow label="File hash" value={entry.book.file_hash} />
            </>
          )}

          {!isUploaded && (
            <>
              <InfoRow label="Publisher" value={entry.catalog_book.publisher} />
              <InfoRow label="Published" value={entry.catalog_book.published_date} />
              <InfoRow label="Language" value={entry.catalog_book.language} />
              <InfoRow label="ISBN-13" value={entry.catalog_book.isbn_13} />
              <InfoRow label="ISBN-10" value={entry.catalog_book.isbn_10} />
              {entry.catalog_book.categories?.length > 0 && (
                <InfoRow label="Categories" value={entry.catalog_book.categories.join(", ")} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
