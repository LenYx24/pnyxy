// Pnyxy: ingest a URL into a library "resource" (beta). YouTube links
// resolve via the public oEmbed API, other pages are reduced to markdown
// via Jina Reader (r.jina.ai). Returns { kind, title, description,
// thumbnail_url, content, url }. verify_jwt = true. See ../README.md.

import "../_shared/deno-shim.ts";
import { corsFor, handleOptions, json as jsonWith } from "../_shared/http.ts";

const YT_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
];

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
  const json = (status: number, body: unknown): Response =>
    jsonWith(status, body, corsHeaders);

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json(401, { error: "not_authenticated" });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_json" });
  }
  let raw = (body.url ?? "").trim();
  if (!raw) return json(400, { error: "missing_url" });
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return json(400, { error: "invalid_url" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json(400, { error: "invalid_url" });
  }

  try {
    const isYt = YT_HOSTS.includes(parsed.hostname.toLowerCase());
    const result = isYt ? await ingestYouTube(raw) : await ingestWeb(raw);
    return json(200, result);
  } catch (err) {
    return json(502, { error: "ingest_failed", detail: String(err) });
  }
});
