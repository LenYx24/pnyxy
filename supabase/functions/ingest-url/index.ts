// Pnyxy: ingest a URL into a library "resource" (beta). YouTube links
// resolve via the public oEmbed API, other pages are reduced to markdown
// via Jina Reader (r.jina.ai). Returns { kind, title, description,
// thumbnail_url, content, url }. verify_jwt = true. See ../README.md.
//
// Auth: requireUser() (on top of the gateway's own verify_jwt = true),
// so the function has a real, verified user id to key the rate limit
// on rather than trusting an unchecked "Bearer " prefix. Rate limited
// to DAILY_INGEST_LIMIT/day per user via the shared bump_rate_limit
// RPC (migration 00073), keyed "ingest:<uid>", called with the
// service-role client so the check can't be bypassed by a caller that
// only has RLS access to their own rows.

import "../_shared/deno-shim.ts";
import {
  corsFor,
  handleOptions,
  json,
  jsonError,
  jsonErrorPublic,
  sanitizeErrorForClient,
} from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const YT_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
];

const DAILY_INGEST_LIMIT = 30;

async function ingestYouTube(url: string) {
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    url,
  )}&format=json`;
  const res = await fetch(oembed);
  if (!res.ok) throw new Error(`oembed_${res.status}`);
  const data = await res.json();
  return {
    kind: "youtube",
    title: typeof data.title === "string" ? data.title : "",
    description: typeof data.author_name === "string" ? data.author_name : null,
    thumbnail_url:
      typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
    content: null,
    url,
  };
}

async function ingestWeb(url: string) {
  // Jina Reader returns: "Title: ...\nURL Source: ...\n...\nMarkdown Content:\n<md>"
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: "text/plain", "X-Return-Format": "markdown" },
  });
  if (!res.ok) throw new Error(`reader_${res.status}`);
  const text = await res.text();
  let title = "";
  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();
  let content = text;
  const marker = text.indexOf("Markdown Content:");
  if (marker !== -1) {
    content = text.slice(marker + "Markdown Content:".length).trim();
  }
  // cap stored content so a huge page doesn't bloat the row
  if (content.length > 200_000) content = content.slice(0, 200_000);
  return { kind: "web", title, description: null, thumbnail_url: null, content, url };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }
  const corsHeaders = corsFor(req);

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Use POST.", corsHeaders);
  }

  // ── Auth: a real, verified signed-in user (not just an
  // unvalidated "Bearer " prefix) ──
  const auth = await requireUser(req, {
    onError: (reason) =>
      reason === "no_bearer"
        ? jsonError(401, "not_authenticated", "Sign in to import a URL.", corsHeaders)
        : jsonError(401, "auth_invalid", "Your session has expired.", corsHeaders),
  });
  if (!auth.ok) return auth.response;

  // ── Parse + validate input URL ──
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_json", "Invalid request body.", corsHeaders);
  }
  let raw = (body.url ?? "").trim();
  if (!raw) return jsonError(400, "missing_url", "Missing url.", corsHeaders);
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return jsonError(400, "invalid_url", "Not a valid URL.", corsHeaders);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return jsonError(400, "invalid_url", "Only http(s) URLs are supported.", corsHeaders);
  }

  // ── Per-user daily cap (migration 00073) ──
  const admin = serviceClient();
  if (!admin) {
    console.error("ingest-url: service client unavailable, missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
    return jsonErrorPublic(500, "misconfigured", corsHeaders);
  }
  const { data: withinLimit, error: rpcErr } = await admin.rpc("bump_rate_limit", {
    p_key: `ingest:${auth.user.id}`,
    p_limit: DAILY_INGEST_LIMIT,
  });
  if (rpcErr) {
    console.error("ingest-url: bump_rate_limit rpc failed", rpcErr);
    return jsonErrorPublic(500, sanitizeErrorForClient(rpcErr), corsHeaders);
  }
  if (!withinLimit) {
    return jsonError(
      429,
      "rate_limited",
      "You've hit today's import limit, try again tomorrow.",
      corsHeaders,
    );
  }

  try {
    const isYt = YT_HOSTS.includes(parsed.hostname.toLowerCase());
    const result = isYt ? await ingestYouTube(raw) : await ingestWeb(raw);
    return json(200, result, corsHeaders);
  } catch (err) {
    // Never echo the raw error (may include upstream response bodies
    // or internal details) to the client; log it server-side instead.
    console.error("ingest-url: ingest failed for", parsed.hostname, err);
    return jsonErrorPublic(502, "ingest_failed", corsHeaders);
  }
});
