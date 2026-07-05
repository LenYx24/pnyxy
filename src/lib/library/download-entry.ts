import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { getDownloadOptions } from "@/lib/open-library";
import type {
  CatalogBook,
  DownloadFormat,
  UnifiedLibraryItem,
  UploadedLibraryItem,
} from "@/types/catalog";

/** One download menu item for a book. `format` is used by the UI to pick the label. */
export interface DownloadAction {
  /** Stable key for React lists. */
  key: string;
  format: DownloadFormat | "original";
  /** Runs the download. Throws on failure. */
  run: () => Promise<void>;
}

/** Catalog books need an ia_id or a download_url; commercial rows have neither. */
export function canDownloadEntry(entry: UnifiedLibraryItem): boolean {
  // shell books have no file
  if (entry.source === "uploaded") return !!entry.book.storage_path;
  return !!(entry.catalog_book.ia_id || entry.catalog_book.download_url);
}

export function getDownloadActions(entry: UnifiedLibraryItem): DownloadAction[] {
  if (entry.source === "uploaded") {
    return [
      {
        key: "uploaded",
        format: "original",
        run: () => downloadUploaded(entry),
      },
    ];
  }
  return getCatalogBookDownloadActions(entry.catalog_book);
}

/** Catalog download actions without needing a user_library row (used by /books/:id). */
export function getCatalogBookDownloadActions(
  book: CatalogBook,
): DownloadAction[] {
  const { ia_id, download_url, title } = book;
  if (ia_id) {
    return getDownloadOptions(ia_id).map((opt) => ({
      key: `ia-${opt.format}`,
      format: opt.format,
      run: async () => {
        triggerExternalDownload(opt.url, buildFileName(title, opt.format));
      },
    }));
  }
  if (download_url) {
    const guessed = guessFormatFromUrl(download_url);
    return [
      {
        key: "download_url",
        format: guessed,
        run: async () => {
          triggerExternalDownload(
            download_url,
            buildFileName(title, guessed),
          );
        },
      },
    ];
  }
  return [];
}

export function canDownloadCatalogBook(book: CatalogBook): boolean {
  return !!(book.ia_id || book.download_url);
}

async function downloadUploaded(entry: UploadedLibraryItem): Promise<void> {
  const { storage_path, file_name, title, format } = entry.book;
  if (!storage_path) {
    throw new Error("This book has no file to download.");
  }
  const { data, error } = await supabase.storage
    .from("book-files")
    .download(storage_path);
  if (error || !data) {
    logError("library:downloadUploaded", error ?? "no data");
    throw error ?? new Error("Could not download this book.");
  }
  // prefer file_name (has original extension); fall back to title + guessed ext
  const ext = inferExt(file_name, format);
  const fname =
    file_name && file_name.trim().length > 0
      ? file_name
      : `${sanitizeFilename(title)}.${ext}`;
  const href = URL.createObjectURL(data);
  try {
    triggerAnchor(href, fname);
  } finally {
    // revoke after the browser has started the download
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}

function triggerExternalDownload(url: string, suggestedName: string): void {
  // cross-origin: download attr is only a filename hint; target=_blank so a
  // captcha/login wall lands the user on the page instead of failing silently
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerAnchor(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildFileName(title: string, format: DownloadFormat): string {
  return `${sanitizeFilename(title)}.${format}`;
}

function guessFormatFromUrl(url: string): DownloadFormat {
  const m = url.match(/\.(pdf|epub|txt)(?:$|[?#])/i);
  if (!m) return "pdf";
  const ext = m[1].toLowerCase();
  return ext === "epub" || ext === "txt" ? ext : "pdf";
}

function inferExt(
  fileName: string | undefined | null,
  format: string | undefined | null,
): string {
  if (fileName) {
    const m = fileName.match(/\.([a-z0-9]+)$/i);
    if (m) return m[1].toLowerCase();
  }
  if (format) {
    const f = format.toLowerCase();
    if (f === "pdf" || f === "epub" || f === "txt" || f === "markdown") {
      return f === "markdown" ? "md" : f;
    }
  }
  return "pdf";
}

/** OS-safe filename: strips illegal chars, caps length, never empty. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "book";
}
