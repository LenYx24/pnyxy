// Server-side URL to file proxy: fetches a document the browser could
// not (missing upstream CORS) and streams it back. Auth required, SSRF
// guard on private IPs, 100 MB cap, 30 s timeout, mime allow-list
// aligned with the client (PDF / EPUB / TXT / MD). See ../README.md.

import "../_shared/deno-shim.ts";
import { corsFor, handleOptions, json } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { assertPublicHttpUrl, safeFetch, SafeFetchError } from "../_shared/safe-fetch.ts";

const MAX_BYTES = 100 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const SUPPORTED_EXT = /\.(pdf|epub|txt|md|markdown)$/i;
const SUPPORTED_MIME = new Set([
  "application/pdf",
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "text/plain",
  "text/markdown",
  "application/octet-stream",
]);

function parseFilename(contentDisposition: string | null, url: URL): string {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }
  const corsHeaders = corsFor(req);
  const jsonError = (status: number, code: string, message: string) =>
    json(status, { error: code, message }, corsHeaders);

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Use POST.");
  }

  // ── Auth ──
  const auth = await requireUser(req, {
    onError: (reason) =>
      reason === "no_bearer"
        ? jsonError(401, "auth_required", "Sign in to import from a URL.")
        : jsonError(401, "auth_invalid", "Your session has expired."),
  });
  if (!auth.ok) return auth.response;

  // ── Parse + validate input URL ──
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_json", "Invalid request body.");
  }
  const raw = (body.url ?? "").trim();
  if (!raw) {
    return jsonError(400, "no_url", "Missing url.");
  }
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return jsonError(400, "bad_url", "Not a valid URL.");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return jsonError(400, "bad_protocol", "Only http(s) URLs are supported.");
  }
  try {
    await assertPublicHttpUrl(target);
  } catch {
    return jsonError(400, "blocked_host", "That host is not allowed.");
  }

  // ── Fetch with timeout, SSRF guard on every redirect hop, and the
  // 100 MB cap enforced on the streamed body (not just Content-Length,
  // which an upstream can lie about) ──
  let upstream: Response;
  try {
    upstream = await safeFetch(target.toString(), {
      method: "GET",
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      headers: {
        // Some servers 403 unknown UAs; pretend to be a normal browser.
        "User-Agent":
          "Mozilla/5.0 (compatible; PnyxyImporter/1.0; +https://pnyxy.com)",
        Accept: "application/pdf, application/epub+zip, text/plain, text/markdown, */*;q=0.5",
      },
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === "blocked_host") {
        return jsonError(400, "blocked_host", "That host is not allowed.");
      }
      if (err.code === "timeout") {
        return jsonError(504, "timeout", "The remote server didn't respond in time.");
      }
      if (err.code === "too_large") {
        return jsonError(
          413,
          "too_large",
          `File exceeds the ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
        );
      }
      if (err.code === "too_many_redirects") {
        return jsonError(502, "too_many_redirects", "Too many redirects.");
      }
    }
    return jsonError(502, "fetch_failed", "Couldn't reach the URL.");
  }

  if (!upstream.ok) {
    return jsonError(
      502,
      "upstream_error",
      `Remote returned ${upstream.status} ${upstream.statusText || ""}`.trim(),
    );
  }

  // ── Validate response ──
  const lengthHeader = upstream.headers.get("content-length");
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > MAX_BYTES) {
      return jsonError(
        413,
        "too_large",
        `File is ${(length / 1024 / 1024).toFixed(1)} MB; limit ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`,
      );
    }
  }

  const upstreamType =
    (upstream.headers.get("content-type") ?? "").split(";")[0].trim() ||
    "application/octet-stream";
  const filename = parseFilename(upstream.headers.get("content-disposition"), target);

  const mimeOk = SUPPORTED_MIME.has(upstreamType);
  const extOk = SUPPORTED_EXT.test(filename);
  if (!mimeOk && !extOk) {
    return jsonError(
      415,
      "unsupported_type",
      "Not a supported document (PDF, EPUB, TXT, MD).",
    );
  }

  // Read the (already size-capped) body. safeFetch's counting stream
  // has already aborted the request if it exceeded MAX_BYTES, so this
  // is just draining a stream we know is within bounds.
  let buf: ArrayBuffer;
  try {
    buf = await upstream.arrayBuffer();
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === "too_large") {
      return jsonError(
        413,
        "too_large",
        `File exceeds the ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB limit.`,
      );
    }
    return jsonError(502, "fetch_failed", "Couldn't read the response.");
  }
  if (buf.byteLength === 0) {
    return jsonError(502, "empty_response", "The URL returned an empty response.");
  }

  // Stream the bytes back. The client's url-to-file.ts will rebuild
  // the File around them.
  return new Response(buf, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": upstreamType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "X-Pnyxy-Filename": encodeURIComponent(filename),
    },
  });
});
