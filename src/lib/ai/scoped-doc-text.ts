/**
 * Text context for a doc-scoped conversation whose document is NOT open
 * in the reader (a PDF dropped into the chat composer, or "New chat"
 * started from a library row). Downloads the stored file once, extracts
 * the first pages' text with pdfjs and caches the result per doc id for
 * the session, so follow-up turns don't re-download or re-parse.
 */
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { extractPdfText } from "@/lib/ai/ai-client";

/** Page/char budget: ~45k chars is roughly 11k tokens, cheap on Flash and
 *  far below the proxy's context window, while covering a full lecture
 *  note. Longer books get a truncation notice so the model says so
 *  instead of hallucinating the tail. */
const MAX_PAGES = 60;
const MAX_CHARS = 45_000;

const cache = new Map<string, Promise<string>>();

/** Extracted text for `docId` ("" when the doc has no extractable text). */
export function getScopedDocText(docId: string): Promise<string> {
  let entry = cache.get(docId);
  if (!entry) {
    entry = extract(docId).catch((err) => {
      // failed attempts don't poison the cache; the next turn retries
      cache.delete(docId);
      logError("ai:scopedDocText", err);
      return "";
    });
    cache.set(docId, entry);
  }
  return entry;
}

async function extract(docId: string): Promise<string> {
  const { data, error } = await supabase
    .from("books")
    .select("storage_path, format, title")
    .eq("id", docId)
    .maybeSingle();
  if (error || !data?.storage_path) return "";
  const format = (data.format ?? "").toLowerCase();
  if (format && format !== "pdf") return "";

  const { data: blob, error: dlError } = await supabase.storage
    .from("book-files")
    .download(data.storage_path);
  if (dlError || !blob) return "";

  const url = URL.createObjectURL(blob);
  try {
    let text = await extractPdfText(url, 1, MAX_PAGES);
    if (!text.trim()) return "";
    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncated = true;
    }
    const note = truncated
      ? `\n\n[Document truncated here; tell the user when their question is likely about a later part.]`
      : "";
    return `[Attached document: full text of the first pages]\n${text}${note}`;
  } finally {
    URL.revokeObjectURL(url);
  }
}
