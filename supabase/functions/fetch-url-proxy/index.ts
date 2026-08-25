// Server-side URL to file proxy: fetches a document the browser could
// not (missing upstream CORS) and streams it back. Auth required, SSRF
// guard on private IPs, 100 MB cap, 30 s timeout, mime allow-list
// aligned with the client (PDF / EPUB / TXT / MD). See ../README.md.

import "../_shared/deno-shim.ts";
import { corsFor, handleOptions, json } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";

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

// Reject private / loopback / link-local IPs to prevent SSRF.
// Hostnames are allowed; the deno fetch will resolve them and use
// system networking, this guard is a defence-in-depth check on
// hostnames that look like raw IPs.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "::") return true;

  // IPv4 dotted-quad
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;                               // 10.0.0.0/8
    if (a === 127) return true;                              // loopback
    if (a === 169 && b === 254) return true;                 // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                 // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                               // multicast / reserved
  }

  // IPv6 link-local / unique-local / loopback (rough; full parser overkill)
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }

  return false;
}

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
  if (isBlockedHost(target.hostname)) {
    return jsonError(400, "blocked_host", "That host is not allowed.");
  }

  // ── Fetch with timeout ──
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Some servers 403 unknown UAs; pretend to be a normal browser.
        "User-Agent":
          "Mozilla/5.0 (compatible; PnyxyImporter/1.0; +https://pnyxy.com)",
        Accept: "application/pdf, application/epub+zip, text/plain, text/markdown, */*;q=0.5",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as { name?: string })?.name === "AbortError";
    return jsonError(
      aborted ? 504 : 502,
      aborted ? "timeout" : "fetch_failed",
      aborted
        ? "The remote server didn't respond in time."
        : "Couldn't reach the URL.",
    );
  }
  clearTimeout(timer);

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

  // Buffer the body so we can enforce the size cap before sending. For
  // a 100 MB ceiling this is acceptable; if we ever raise the cap,
  // switch to a streaming reader that aborts past N bytes.
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return jsonError(
      413,
      "too_large",
      `File is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB; limit ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`,
    );
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
