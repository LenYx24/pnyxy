// Pnyxy catalog-fetch proxy: server-side CORS bypass for downloading
// public-domain books (Gutenberg / Internet Archive / Standard Ebooks /
// MEK). Signed-in caller, tight host whitelist, size sanity check,
// streams the upstream body back. See ../README.md.

import "../_shared/deno-shim.ts";
import { corsFor, handleOptions, json } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { safeFetch, SafeFetchError } from "../_shared/safe-fetch.ts";

// Tight whitelist. Only add sources after confirming they host PD /
// open-licensed works. A wildcard proxy would be abused as a privacy
// bypass or a way to exfiltrate content from gated services.
const ALLOWED_HOSTS = [
  "gutenberg.org",
  "www.gutenberg.org",
  "dev.gutenberg.org",
  "archive.org",
  "www.archive.org",
  "ia600300.us.archive.org",
  "standardebooks.org",
  "www.standardebooks.org",
  "mek.oszk.hu",
];

const MAX_FETCH_BYTES = 50 * 1024 * 1024; // 50 MB
// No timeout existed before this SSRF hardening pass (bare `fetch`,
// `redirect: "follow"`); safeFetch requires one, 60 s is generous for
// a public-domain book download over a slow connection.
const TIMEOUT_MS = 60_000;

const CORS_METHODS = "GET, OPTIONS";

function hostAllowed(host: string): boolean {
  const normalized = host.toLowerCase();
  return ALLOWED_HOSTS.some(
    (h) => normalized === h || normalized.endsWith(`.${h}`),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req, CORS_METHODS);
  }
  const corsHeaders = corsFor(req, CORS_METHODS);
  const jsonError = (status: number, message: string): Response =>
    json(status, { error: message }, corsHeaders);

  if (req.method !== "GET") {
    return jsonError(405, "method_not_allowed");
  }

  // ── Auth: require a signed-in user ─────────────────────────
  const auth = await requireUser(req, {
    persistSession: false,
    onError: (reason) =>
      reason === "misconfigured"
        ? jsonError(500, "server_misconfigured")
        : jsonError(401, "not_authenticated"),
  });
  if (!auth.ok) return auth.response;

  // ── Validate target URL ────────────────────────────────────
  const params = new URL(req.url).searchParams;
  const rawTarget = params.get("url");
  if (!rawTarget) return jsonError(400, "missing_url");

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawTarget);
  } catch {
    return jsonError(400, "invalid_url");
  }
  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return jsonError(400, "invalid_protocol");
  }
  if (!hostAllowed(targetUrl.hostname)) {
    return jsonError(403, "host_not_allowed");
  }

  // ── Pre-flight size check via HEAD ─────────────────────────
  // Not all hosts answer HEAD (MEK sometimes returns 405), treat
  // a non-2xx HEAD as "size unknown" and fall through to streaming.
  try {
    const head = await safeFetch(targetUrl.toString(), {
      method: "HEAD",
      maxBytes: MAX_FETCH_BYTES,
      timeoutMs: TIMEOUT_MS,
      allowHosts: hostAllowed,
    });
    if (head.ok) {
      const lenStr = head.headers.get("content-length");
      if (lenStr) {
        const len = Number(lenStr);
        if (Number.isFinite(len) && len > MAX_FETCH_BYTES) {
          return jsonError(413, "file_too_large");
        }
      }
    }
  } catch (err) {
    if (err instanceof SafeFetchError && err.code === "blocked_host") {
      return jsonError(403, "host_not_allowed");
    }
    // Other HEAD failures aren't fatal, fall through to GET.
  }

  // ── Stream the file back, size-capped on the actual bytes read
  // (not just Content-Length, which an upstream can lie about) ──
  let upstream: Response;
  try {
    upstream = await safeFetch(targetUrl.toString(), {
      maxBytes: MAX_FETCH_BYTES,
      timeoutMs: TIMEOUT_MS,
      allowHosts: hostAllowed,
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === "blocked_host") return jsonError(403, "host_not_allowed");
      if (err.code === "timeout") return jsonError(504, "upstream_timeout");
    }
    return jsonError(502, "upstream_fetch_failed");
  }
  if (!upstream.ok) {
    return jsonError(upstream.status, `upstream_${upstream.status}`);
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = upstream.headers.get("content-length") ?? undefined;

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=3600",
  };
  // Content-Length is passed through only as a hint; if the upstream
  // understates it and the actual body exceeds MAX_FETCH_BYTES, the
  // counting stream aborts mid-response rather than trusting the header.
  if (contentLength) headers["Content-Length"] = contentLength;

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
});
