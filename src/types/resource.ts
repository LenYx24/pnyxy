/** A saved web page or YouTube link that lives in the library (migration 00053). */
export type ResourceKind = "web" | "youtube";

/** One caption cue of a YouTube transcript (migration 00074). */
export interface TranscriptSegment {
  /** Seconds from the start of the video. */
  start: number;
  /** Cue duration in seconds. */
  dur: number;
  text: string;
}

export interface Resource {
  id: string;
  user_id: string;
  /** null = library root. */
  folder_id: string | null;
  kind: ResourceKind;
  url: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  /** Extracted article markdown for web pages; null for YouTube / not yet ingested. */
  content: string | null;
  /** Caption cues for YouTube resources; null = not fetched / none available.
   *  Optional: absent until migration 00074 is applied. */
  transcript?: TranscriptSegment[] | null;
  /** Language tag of `transcript` ("hu", "en"); null when unknown. */
  transcript_lang?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
