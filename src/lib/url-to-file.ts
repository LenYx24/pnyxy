/**
 * Client-side URL → File loader for the Library "Open from URL" feature.
 *
 * Pure browser fetch — no proxy, no server hop. The browser's same-origin
 * policy applies, so URLs whose servers don't send CORS headers will fail.
 * That's intentional: keeping this client-only avoids SSRF, abuse, and
 * any "we fetched it on their behalf" legal exposure.
 *
 * On failure, throws an Error with a user-readable message that the
 * calling UI can display directly.
 */

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB hard cap
const SUPPORTED_EXT = /\.(pdf|epub|txt|md|markdown)$/i;

const SUPPORTED_MIME: Record<string, true> = {
  "application/pdf": true,
  "application/epub+zip": true,
  "application/x-mobipocket-ebook": true,
  "text/plain": true,
  "text/markdown": true,
};

export class UrlFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlFetchError";
  }
}

function parseFilename(
  contentDisposition: string | null,
  url: URL,
): string {
  // RFC 6266: filename* (UTF-8 / percent-encoded) takes precedence.
  if (contentDisposition) {
    const starMatch = contentDisposition.match(
      /filename\*\s*=\s*[^']*''([^;]+)/i,
    );
    if (starMatch) {
      try {
        return decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, ""));
      } catch {
        // fall through
      }
    }
    const plainMatch = contentDisposition.match(
      /filename\s*=\s*"?([^";]+)"?/i,
    );
    if (plainMatch) return plainMatch[1].trim();
  }

  const last = url.pathname.split("/").filter(Boolean).pop();
  if (last) {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  return "document";
}

export interface FetchUrlOptions {
  /** Override the inferred filename. */
  filename?: string;
  /** Override the size cap (bytes). */
  maxBytes?: number;
}

/**
 * Fetches a URL and returns it as a File suitable for openFile() /
 * uploadPdf() etc. Throws UrlFetchError with a user-readable message
 * on any failure (CORS, network, oversized, unsupported type, …).
 */
export async function fetchUrlAsFile(
  rawUrl: string,
  opts: FetchUrlOptions = {},
): Promise<File> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new UrlFetchError("Please enter a URL.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UrlFetchError("That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlFetchError("Only http:// and https:// URLs are supported.");
  }

  const maxBytes = opts.maxBytes ?? MAX_BYTES;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      // Don't leak our origin to the target server.
      referrerPolicy: "no-referrer",
      // We deliberately don't send credentials cross-origin.
      credentials: "omit",
      // Default cache; the browser will handle revalidation.
    });
  } catch {
    // Network error or CORS preflight failure (the browser converts a
    // CORS rejection into a generic TypeError — we can't distinguish).
    throw new UrlFetchError(
      "Couldn't reach the URL. The site may block cross-origin requests; if you can download the file in your browser, try uploading it instead.",
    );
  }

  if (!response.ok) {
    throw new UrlFetchError(
      `The server returned ${response.status} ${response.statusText || ""}`.trim(),
    );
  }

  // Pre-check size from Content-Length when present.
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new UrlFetchError(
        `File is too large (${(length / 1024 / 1024).toFixed(1)} MB; limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB).`,
      );
    }
  }

  const contentType =
    (response.headers.get("content-type") ?? "").split(";")[0].trim() ||
    "application/octet-stream";
  const filename =
    opts.filename ??
    parseFilename(response.headers.get("content-disposition"), url);

  // Validate by MIME first, fall back to filename extension. We allow
  // octet-stream if the URL has a supported extension — many CDNs
  // serve everything as octet-stream.
  const mimeOk = SUPPORTED_MIME[contentType];
  const extOk = SUPPORTED_EXT.test(filename);
  if (!mimeOk && !extOk) {
    throw new UrlFetchError(
      "That URL doesn't look like a supported document (PDF, EPUB, TXT, or Markdown).",
    );
  }

  const blob = await response.blob();
  if (blob.size > maxBytes) {
    throw new UrlFetchError(
      `File is too large (${(blob.size / 1024 / 1024).toFixed(1)} MB; limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB).`,
    );
  }
  if (blob.size === 0) {
    throw new UrlFetchError("The URL returned an empty response.");
  }

  // Re-stamp the MIME so the rest of the pipeline (createAdapterForFile,
  // uploadPdf's Storage upload) sees the right content-type. If the
  // server gave octet-stream we infer from the extension.
  const finalType = SUPPORTED_MIME[contentType]
    ? contentType
    : /\.pdf$/i.test(filename)
      ? "application/pdf"
      : /\.epub$/i.test(filename)
        ? "application/epub+zip"
        : /\.(md|markdown)$/i.test(filename)
          ? "text/markdown"
          : "text/plain";

  return new File([blob], filename, { type: finalType });
}
