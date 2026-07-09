/** A saved web page or YouTube link that lives in the library (migration 00053). */
export type ResourceKind = "web" | "youtube";

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
  sort_order: number;
  created_at: string;
  updated_at: string;
}
