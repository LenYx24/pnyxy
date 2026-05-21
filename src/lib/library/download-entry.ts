import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { getDownloadOptions } from "@/lib/open-library";
import type {
  CatalogBook,
  DownloadFormat,
  UnifiedLibraryItem,
  UploadedLibraryItem,
} from "@/types/catalog";

/**
 * One menu item the library's per-book overflow can render. `format`
 * is just informational — UI uses it to pick the localized label
 * ("Download PDF" / "Download EPUB" / etc.) and falls back to a plain
 * "Download" for the single-file uploaded case.
 */
export interface DownloadAction {
  /** Stable key for React lists. */
  key: string;
  /** Source format, surfaced so the UI can label & icon-pick. */
  format: DownloadFormat | "original";
  /** Triggers the actual download. Throws on failure; callers
   *  decide whether to toast or swallow. */
  run: () => Promise<void>;
}

/**
 * Whether the entry exposes any download path at all. Uploaded books
 * the user uploaded themselves are always downloadable; catalog books
 * require either an Internet Archive id (public-domain scan, three
 * canonical formats) or an explicit `download_url` (community-supplied
 * single file). Catalog rows without either are commercial entries
 * we can't lawfully serve — those skip the menu item.
 */
export function canDownloadEntry(entry: UnifiedLibraryItem): boolean {
  if (entry.source === "uploaded") return true;
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

/**
 * Same catalog-side actions, but addressable without a user_library
 * row. The Book description page (`/books/:id`) renders for users
 * who haven't added the book to their library too, so we can't make
 * them invent a library entry just to grab a download URL.
 */
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
  const { data, error } = await supabase.storage
    .from("book-files")
    .download(storage_path);
  if (error || !data) {
    logError("library:downloadUploaded", error ?? "no data");
    throw error ?? new Error("Could not download this book.");
  }
  // file_name carries the original extension; prefer it so the
  // downloaded file opens in the same app the user originally
  // associated with the format. Fall back to a sanitized title +
  // best-guess extension if file_name is somehow missing (older
  // pre-rename uploads pre-dating this column).
  const ext = inferExt(file_name, format);
  const fname =
    file_name && file_name.trim().length > 0
      ? file_name
      : `${sanitizeFilename(title)}.${ext}`;
  const href = URL.createObjectURL(data);
  try {
    triggerAnchor(href, fname);
  } finally {
    // Hand the URL back to the GC after the browser has had time to
    // start the download. The 60s slack is well past any realistic
    // browser-side write delay.
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}

function triggerExternalDownload(url: string, suggestedName: string): void {
  // Cross-origin URLs (Internet Archive, community CDN) generally
  // honour `Content-Disposition: attachment`, so the `download`
  // attribute is mostly a filename hint. We also open in a new tab
  // — if the host responds with HTML instead of the file (e.g. a
  // captcha / login wall), the user lands on it instead of having a
  // silent no-op.
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

/**
 * OS-safe filename. Strips control chars + the characters Windows /
 * mac / linux refuse in path segments, collapses runs of whitespace,
 * trims, and caps length so a 5,000-character book title can't
 * generate a write-fail filename. Always returns at least "book".
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "book";
}
