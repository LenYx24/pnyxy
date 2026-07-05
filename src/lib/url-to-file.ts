// Client-side URL -> File loader. Direct fetch first, then the
// fetch-url-proxy edge function (auth required) if CORS blocks us.

import { supabase } from "./supabase";

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
  // RFC 6266: filename* takes precedence.
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

// Build a File, inferring the MIME from the extension when the
// content-type isn't one we recognize.
function finalizeFile(
  blob: Blob,
  filename: string,
  contentType: string,
): File {
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

async function tryDirect(
  url: URL,
  opts: FetchUrlOptions,
): Promise<{ file: File } | { networkError: true }> {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      referrerPolicy: "no-referrer",
      credentials: "omit",
    });
  } catch {
    // Browsers fold CORS and network errors into one generic TypeError.
    return { networkError: true };
  }

  if (!response.ok) {
    throw new UrlFetchError(
      `The server returned ${response.status} ${response.statusText || ""}`.trim(),
    );
  }

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

  return { file: finalizeFile(blob, filename, contentType) };
}

async function tryProxy(
  url: URL,
  opts: FetchUrlOptions,
): Promise<File> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    // no proxy for anon users, surface the CORS-style error
    throw new UrlFetchError(
      "Couldn't reach the URL. The site may block cross-origin requests; if you can download the file in your browser, try uploading it instead.",
    );
  }

  const { data, error } = await supabase.functions.invoke("fetch-url-proxy", {
    body: { url: url.toString() },
  });

  if (error) {
    // SDK exposes the raw response on context.response for non-2xx.
    const ctx = (error as unknown as { context?: { response?: Response } })
      .context;
    if (ctx?.response) {
      try {
        const body = (await ctx.response.clone().json()) as {
          message?: string;
        };
        if (body?.message) throw new UrlFetchError(body.message);
      } catch (e) {
        if (e instanceof UrlFetchError) throw e;
      }
    }
    throw new UrlFetchError(
      "Couldn't import that URL. The remote server may be blocking us, or the file is unsupported.",
    );
  }

  // Proxy returns a binary body, so the SDK hands back a Blob (or
  // sometimes an ArrayBuffer) rather than parsed JSON.
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (data instanceof ArrayBuffer) {
    blob = new Blob([data]);
  } else {
    throw new UrlFetchError("Proxy returned an unexpected response.");
  }

  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  if (blob.size > maxBytes) {
    throw new UrlFetchError(
      `File is too large (${(blob.size / 1024 / 1024).toFixed(1)} MB; limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB).`,
    );
  }
  if (blob.size === 0) {
    throw new UrlFetchError("The URL returned an empty response.");
  }

  // headers aren't reachable through data, so fall back to the URL path
  // and the blob's own type
  const filename =
    opts.filename ?? parseFilename(null, url);
  const contentType = blob.type || "application/octet-stream";

  return finalizeFile(blob, filename, contentType);
}

/** Fetch a URL as a File. Throws UrlFetchError on any failure. */
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

  // browsers block file:// reads from a web origin, point to drag-and-drop
  if (url.protocol === "file:") {
    throw new UrlFetchError(
      "The browser doesn't let web pages read local files via file:// URLs. Drag the file from your file manager onto the library, or use the Upload button.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlFetchError("Only http:// and https:// URLs are supported.");
  }

  const direct = await tryDirect(url, opts);
  if ("file" in direct) return direct.file;

  return tryProxy(url, opts);
}
