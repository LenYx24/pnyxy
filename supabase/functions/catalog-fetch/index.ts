// Pnyxy catalog-fetch proxy.
//
// Server-side CORS bypass for downloading public-domain books from
// Project Gutenberg / Internet Archive / Standard Ebooks / MEK when
// the upstream server doesn't send permissive CORS headers.
//
// The browser calls this function with an authenticated JWT and a
// `url` query param. We:
//   1. Verify the caller is signed in.
//   2. Confirm the target host is on a tight whitelist — this is NOT
//      a general-purpose HTTP proxy.
//   3. HEAD the target to sanity-check size before we stream (prevents
//      multi-GB files from pinning the edge function).
//   4. Stream the body back with the upstream content-type.
//
// Not a streaming SSE endpoint — this just forwards the octet-stream
// with a permissive CORS response header so the browser can blob() it.
//
// Env vars (auto-populated):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY

// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hostAllowed(host: string): boolean {
  const normalized = host.toLowerCase();
  return ALLOWED_HOSTS.some(
    (h) => normalized === h || normalized.endsWith(`.${h}`),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonError(405, "method_not_allowed");
  }

  // ── Auth: require a signed-in user ─────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(401, "not_authenticated");
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError(500, "server_misconfigured");
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonError(401, "not_authenticated");
  }

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
  // Not all hosts answer HEAD (MEK sometimes returns 405) — treat
  // a non-2xx HEAD as "size unknown" and fall through to streaming.
  try {
    const head = await fetch(targetUrl.toString(), {
      method: "HEAD",
      redirect: "follow",
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
  } catch {
    // HEAD failures aren't fatal — fall through to GET.
  }

  // ── Stream the file back ───────────────────────────────────
  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), { redirect: "follow" });
  } catch {
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
  if (contentLength) headers["Content-Length"] = contentLength;

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
});
