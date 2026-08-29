// Pnyxy: ingest a URL into a library "resource" (beta). YouTube links
// resolve via the public oEmbed API, other pages are reduced to markdown
// via Jina Reader (r.jina.ai). Returns { kind, title, description,
// thumbnail_url, content, transcript, transcript_lang, url }; the
// transcript (YouTube caption cues, best-effort scrape) feeds the
// resource viewer's AI side-chat. verify_jwt = true. See ../README.md.
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

/** One caption cue, mirrors `TranscriptSegment` in src/types/resource.ts. */
interface TranscriptSegment {
  start: number;
  dur: number;
  text: string;
}

/** Caption languages we prefer, in order; the first available track wins,
 *  a human-made track beating an auto-generated ("asr") one in the same
 *  language. Anything else falls back to whatever track the video has. */
const PREFERRED_CAPTION_LANGS = ["hu", "en"];

/** Hard cap on stored cues so a 10-hour lecture doesn't bloat the row. */
const MAX_TRANSCRIPT_SEGMENTS = 6000;

function parseYouTubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    return u.pathname.slice(1).split("/")[0] || null;
  }
  if (u.pathname === "/watch") return u.searchParams.get("v");
  const m = u.pathname.match(/\/(embed|shorts|live)\/([^/?#]+)/);
  if (m) return m[2];
  return u.searchParams.get("v");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Best-effort caption fetch. YouTube exposes the caption track list in
 * the watch page's embedded player response; each track has a timedtext
 * URL that returns JSON when asked with `fmt=json3`. There is no
 * official captions API without the video owner's OAuth, so this is a
 * scrape that can break or be blocked for datacenter IPs. Any failure
 * yields null and the resource is still saved (the viewer offers a
 * retry and the Gemini direct-video path as an alternative).
 */
async function fetchYouTubeTranscript(
  videoId: string,
): Promise<{ segments: TranscriptSegment[]; lang: string } | null> {
  const watchRes = await fetch(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`,
    {
      headers: {
        // Desktop UA + consent cookie: the EU consent interstitial
        // otherwise replaces the page and hides the player response.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+cb; SOCS=CAI",
      },
    },
  );
  if (!watchRes.ok) return null;
  const html = await watchRes.text();

  const marker = '"captionTracks":';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  // The array is JSON embedded in a larger JSON literal; find its end by
  // bracket depth rather than a regex so quoted brackets don't trip it.
  const arrStart = html.indexOf("[", idx);
  if (arrStart === -1) return null;
  let depth = 0;
  let inStr = false;
  let arrEnd = -1;
  for (let i = arrStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        arrEnd = i;
        break;
      }
    }
  }
  if (arrEnd === -1) return null;

  let tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
  try {
    tracks = JSON.parse(html.slice(arrStart, arrEnd + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const score = (t: (typeof tracks)[number]) => {
    const lang = (t.languageCode ?? "").toLowerCase().split("-")[0];
    const langRank = PREFERRED_CAPTION_LANGS.indexOf(lang);
    // preferred languages first (lower = better), then human before asr
    return (langRank === -1 ? 10 : langRank) * 2 + (t.kind === "asr" ? 1 : 0);
  };
  const track = tracks
    .filter((t) => typeof t.baseUrl === "string")
    .sort((a, b) => score(a) - score(b))[0];
  if (!track?.baseUrl) return null;

  const ttUrl = new URL(track.baseUrl.replace(/\\u0026/g, "&"));
  ttUrl.searchParams.set("fmt", "json3");
  const ttRes = await fetch(ttUrl.toString(), {
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!ttRes.ok) return null;
  const data = await ttRes.json().catch(() => null);
  const events: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }> = data?.events;
  if (!Array.isArray(events)) return null;

  const segments: TranscriptSegment[] = [];
  for (const ev of events) {
    if (!Array.isArray(ev.segs)) continue;
    const text = decodeHtmlEntities(
      ev.segs.map((sg) => sg.utf8 ?? "").join(""),
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    segments.push({
      start: Math.round((ev.tStartMs ?? 0) / 100) / 10,
      dur: Math.round((ev.dDurationMs ?? 0) / 100) / 10,
      text,
    });
    if (segments.length >= MAX_TRANSCRIPT_SEGMENTS) break;
  }
  if (segments.length === 0) return null;
  return { segments, lang: track.languageCode ?? "und" };
}

async function ingestYouTube(url: string, parsed: URL) {
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    url,
  )}&format=json`;
  const res = await fetch(oembed);
  if (!res.ok) throw new Error(`oembed_${res.status}`);
  const data = await res.json();

  // Transcript is best-effort: a failure here must not fail the import.
  let transcript: TranscriptSegment[] | null = null;
  let transcript_lang: string | null = null;
  const videoId = parseYouTubeId(parsed);
  if (videoId) {
    try {
      const t = await fetchYouTubeTranscript(videoId);
      if (t) {
        transcript = t.segments;
        transcript_lang = t.lang;
      }
    } catch (err) {
      console.warn("ingest-url: transcript fetch failed", err);
    }
  }

  return {
    kind: "youtube",
    title: typeof data.title === "string" ? data.title : "",
    description: typeof data.author_name === "string" ? data.author_name : null,
    thumbnail_url:
      typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
    content: null,
    transcript,
    transcript_lang,
    url,
  };
}

/**
 * Reader-mode cleanup of Jina's markdown: drop site chrome before the
 * article's H1 (nav menus, "Skip to content"), inline media stubs and
 * the "↑" back-to-top markers, and turn heading permalinks
 * (`## [#](…#slug)Text`) into an anchor + plain heading so the viewer
 * can scroll to the URL's #fragment.
 */
function cleanupArticleMarkdown(md: string): string {
  const lines = md.split("\n");
  // start at the first H1 when it sits in the first half of the doc
  const h1 = lines.findIndex((l) => /^# \S/.test(l));
  let body = h1 > 0 && h1 < lines.length / 2 ? lines.slice(h1) : lines;
  body = body
    .filter((l) => !/^\[Skip to content\]/i.test(l))
    .filter((l) => !/^\[?\[Video \d+\]\([^)]*\)\]?\s*$/.test(l))
    .filter((l) => l.trim() !== "↑")
    .map((l) => {
      const m = l.match(/^(#{1,6})\s*\[#\]\([^)]*#([^)\s]+)\)\s*(.*)$/);
      if (m) return `<a id="${m[2].replace(/[^\w-]/g, "")}"></a>\n${m[1]} ${m[3]}`;
      return l;
    });
  return body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  content = cleanupArticleMarkdown(content);
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
    const result = isYt ? await ingestYouTube(raw, parsed) : await ingestWeb(raw);
    return json(200, result, corsHeaders);
  } catch (err) {
    // Never echo the raw error (may include upstream response bodies
    // or internal details) to the client; log it server-side instead.
    console.error("ingest-url: ingest failed for", parsed.hostname, err);
    return jsonErrorPublic(502, "ingest_failed", corsHeaders);
  }
});
