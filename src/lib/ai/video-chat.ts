// YouTube resource side-chat: transcript helpers and the system prompt
// for both context modes.
//
//   "transcript": the stored caption cues (optionally clipped to a time
//                 range) go into the system prompt as text. Works with
//                 every provider, including BYOK and local models.
//   "video":      no transcript in the prompt; the Pnyxy proxy hands the
//                 YouTube URL (+ the same clip range) to Gemini natively,
//                 which watches the frames and listens to the audio.
//
// Both modes cite moments as [mm:ss]; the viewer turns those into
// seek links on the embedded player.

import type { TranscriptSegment } from "@/types/resource";
import { INLINE_QUIZ_SPEC } from "./extract-quiz";
import { teacherBlock } from "./teacher-mode";

export type VideoContextMode = "transcript" | "video";

/** Inclusive clip in seconds; null bound = open-ended. */
export interface VideoClip {
  startSec: number | null;
  endSec: number | null;
}

/** Keep the transcript excerpt under this many characters (~15k tokens):
 *  roughly a 90-minute lecture at normal speech rate. Longer clips are
 *  truncated from the end and the prompt says so. */
const MAX_TRANSCRIPT_CHARS = 60_000;

/** 125 → "2:05", 3725 → "1:02:05". */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Parse "1:02:05", "2:05", "125" (seconds) or "" (→ null). Returns
 *  undefined for unparseable input so the caller can flag it. */
export function parseTimestamp(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (parts.some((p) => !/^\d{1,2}$/.test(p))) return undefined;
  const nums = parts.map(Number);
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** Segments overlapping the clip, in order. Open bounds pass everything. */
export function sliceTranscript(
  segments: TranscriptSegment[],
  clip: VideoClip,
): TranscriptSegment[] {
  const start = clip.startSec ?? -Infinity;
  const end = clip.endSec ?? Infinity;
  return segments.filter(
    (seg) => seg.start + seg.dur >= start && seg.start <= end,
  );
}

/** Group cues into ~30s lines so the prompt reads as timestamped prose
 *  rather than one line per caption fragment. */
export function transcriptToText(segments: TranscriptSegment[]): string {
  const lines: string[] = [];
  let bucketStart: number | null = null;
  let bucket: string[] = [];
  const flush = () => {
    if (bucketStart === null || bucket.length === 0) return;
    lines.push(`[${formatTimestamp(bucketStart)}] ${bucket.join(" ")}`);
    bucket = [];
    bucketStart = null;
  };
  for (const seg of segments) {
    if (bucketStart === null) bucketStart = seg.start;
    bucket.push(seg.text);
    if (seg.start - bucketStart >= 30) flush();
  }
  flush();
  return lines.join("\n");
}

/** Keep the article excerpt under ~20k tokens. */
const MAX_ARTICLE_CHARS = 80_000;

/** System prompt for a saved web article's side-chat: the extracted
 *  markdown goes in verbatim (truncated for very long pages). */
export function buildArticleSystemPrompt(input: {
  title: string;
  url: string;
  content: string | null;
}): string {
  let text = (input.content ?? "").trim();
  let truncated = false;
  if (text.length > MAX_ARTICLE_CHARS) {
    text = text.slice(0, MAX_ARTICLE_CHARS);
    truncated = true;
  }
  const contextBlock = text
    ? `Below is the article as extracted from the page (markdown; some site chrome may remain, ignore it).${truncated ? " It was cut for length; say so if the user asks about the end." : ""}

<article>
${text}
</article>`
    : `The article's text could not be extracted. Work from the title, the URL and what the user pastes in, and say when you don't know.`;
  return `You are Pnyxy's AI study assistant. The user is a student reading a web article inside the app and wants help understanding it, summarizing it, questioning it or connecting it to what they study.

Article: "${input.title}"
URL: ${input.url}

Match the user's language: reply in Hungarian when they write in Hungarian, English otherwise. Use markdown: **bold** key terms, lists for enumerations, short paragraphs. When you refer to a part of the article, quote a short phrase from it in quotes so the reader can find it; don't invent quotes.

${contextBlock}

${INLINE_QUIZ_SPEC}${teacherBlock()}`;
}

export interface VideoPromptInput {
  title: string;
  /** Uploader / channel name when known. */
  author?: string | null;
  mode: VideoContextMode;
  clip: VideoClip;
  /** Full transcript; sliced here. Ignored in "video" mode. */
  transcript?: TranscriptSegment[] | null;
}

function clipLabel(clip: VideoClip): string {
  if (clip.startSec === null && clip.endSec === null) return "the whole video";
  const from = clip.startSec !== null ? formatTimestamp(clip.startSec) : "the start";
  const to = clip.endSec !== null ? formatTimestamp(clip.endSec) : "the end";
  return `the part from ${from} to ${to}`;
}

/**
 * System prompt for a video-scoped conversation. Carries the inline-quiz
 * spec so the Pnyxy proxy recognises it as a chat prompt (and appends the
 * teaching guardrail); BYOK routes get the same text verbatim.
 */
export function buildVideoSystemPrompt(input: VideoPromptInput): string {
  const header = `You are Pnyxy's AI study assistant. The user is a student watching a YouTube video inside the app and wants help understanding it, taking notes on it, or checking their understanding.

Video: "${input.title}"${input.author ? ` (channel: ${input.author})` : ""}
Scope: ${clipLabel(input.clip)}.

Match the user's language: reply in Hungarian when they write in Hungarian, English otherwise. Use markdown: **bold** key terms, lists for enumerations and steps, short paragraphs. Don't over-structure trivial replies.

When you refer to a moment in the video, cite it inline as [mm:ss] (or [h:mm:ss] past an hour), e.g. "the definition is introduced at [12:40]". The player jumps there when the user clicks the citation, so only cite timestamps you actually have evidence for.`;

  let contextBlock: string;
  if (input.mode === "video") {
    contextBlock = `You receive the video itself (frames and audio) for the scope above. Ground your answers in what is actually shown and said; when something is unclear or outside the scope, say so instead of guessing.`;
  } else {
    const segments = sliceTranscript(input.transcript ?? [], input.clip);
    let text = transcriptToText(segments);
    let truncated = false;
    if (text.length > MAX_TRANSCRIPT_CHARS) {
      text = text.slice(0, MAX_TRANSCRIPT_CHARS);
      truncated = true;
    }
    contextBlock = segments.length
      ? `Below is the video's transcript for the scope above, as timestamped captions (auto-generated captions may contain recognition errors; read through them charitably). You cannot see the picture, only what is said.${truncated ? " The transcript was cut for length; say so if the user asks about the part after the last timestamp." : ""}

<transcript>
${text}
</transcript>`
      : `No transcript is available for this video (or for the selected range). Say so when asked about its content, and work from the title, the user's own description and what they paste in.`;
  }

  return `${header}

${contextBlock}

${INLINE_QUIZ_SPEC}${teacherBlock()}`;
}
