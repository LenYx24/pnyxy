import type { ResourceKind } from "@/types/resource";

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/** Prefix a bare host with https:// so `new URL` accepts it. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(normalizeUrl(raw));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function detectResourceKind(raw: string): ResourceKind {
  try {
    const u = new URL(normalizeUrl(raw));
    return YT_HOSTS.has(u.hostname.toLowerCase()) ? "youtube" : "web";
  } catch {
    return "web";
  }
}

/** Extract the 11-ish char video id from any common YouTube URL shape. */
export function parseYouTubeId(raw: string): string | null {
  try {
    const u = new URL(normalizeUrl(raw));
    const host = u.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/\/(embed|shorts|live)\/([^/?#]+)/);
    if (m) return m[2];
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

export function youtubeThumbnail(id: string): string {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

/** Embed URL with the IFrame API enabled so the page can read the
 *  playhead (see useYouTubePlayer) without loading YouTube's script. */
export function youtubeEmbedUrl(id: string, startSeconds = 0): string {
  const origin =
    typeof window !== "undefined" && window.location.origin.startsWith("http")
      ? `&origin=${encodeURIComponent(window.location.origin)}`
      : "";
  const start = startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : "";
  return `https://www.youtube.com/embed/${id}?enablejsapi=1${origin}${start}`;
}

/** Best-effort human title from a URL when no metadata is available. */
export function deriveTitleFromUrl(raw: string): string {
  try {
    const u = new URL(normalizeUrl(raw));
    const path = u.pathname.replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    if (last) {
      const words = decodeURIComponent(last)
        .replace(/\.\w+$/, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (words) return words.slice(0, 120);
    }
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.slice(0, 120);
  }
}

/** Display host for a resource, e.g. "medium.com". */
export function displayHost(raw: string): string {
  try {
    return new URL(normalizeUrl(raw)).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

const URL_RE = /https?:\/\/[^\s<>()"']+/i;

/** First http(s) URL in free text, trailing punctuation stripped. */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  return m[0].replace(/[.,;:!?)\]]+$/, "");
}
