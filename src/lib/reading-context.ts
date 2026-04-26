import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";

interface ReadingActivityRow {
  doc_id: string;
  page: number;
  updated_at: string;
}

interface BookTitleRow {
  id: string;
  title: string | null;
}

/**
 * One book the user has been reading recently. Title is best-effort
 * — if we can't resolve it (book deleted, catalog unreachable), we
 * fall back to a short slug of the doc id so the AI prompt still
 * has something to anchor on.
 */
export interface RecentBook {
  docId: string;
  title: string;
  page: number;
  lastSeen: string;
}

/**
 * Fetch the user's reading activity over the past `days` days from
 * `book_resume_state` (the cross-device resume table the reader
 * writes on every page change). Joins against `books` and
 * `catalog_books` for human titles.
 *
 * Returns at most `limit` rows ordered most-recent first. Empty
 * array on auth failure or query error — callers degrade silently.
 */
export async function fetchRecentReading(
  options: { days?: number; limit?: number } = {},
): Promise<RecentBook[]> {
  const { days, limit = 10 } = options;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let q = supabase
    .from("book_resume_state")
    .select("doc_id, page, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    q = q.gte("updated_at", cutoff.toISOString());
  }

  const { data, error } = await q;
  if (error) {
    logError("reading-context:fetch", error);
    return [];
  }
  const rows = (data ?? []) as ReadingActivityRow[];
  if (rows.length === 0) return [];

  // Resolve titles. doc_ids are either UUIDs (catalog) or text
  // hashes (uploaded PDFs); books.id is uuid only — but `books` has
  // a `file_hash` column for uploaded PDFs (tied to the reader's
  // adapter id). Try both lookup paths and merge.
  const ids = rows.map((r) => r.doc_id);
  const [uploadedRes, catalogRes, hashRes] = await Promise.all([
    supabase.from("books").select("id, title").in("id", ids),
    supabase.from("catalog_books").select("id, title").in("id", ids),
    supabase.from("books").select("id, title, file_hash").in("file_hash", ids),
  ]);

  const titleByDocId = new Map<string, string>();
  for (const r of (uploadedRes.data ?? []) as BookTitleRow[]) {
    if (r.title) titleByDocId.set(r.id, r.title);
  }
  for (const r of (catalogRes.data ?? []) as BookTitleRow[]) {
    if (r.title) titleByDocId.set(r.id, r.title);
  }
  for (const r of (hashRes.data ?? []) as (BookTitleRow & { file_hash: string })[]) {
    if (r.title && r.file_hash) titleByDocId.set(r.file_hash, r.title);
  }

  return rows.map((r) => ({
    docId: r.doc_id,
    title:
      titleByDocId.get(r.doc_id) ??
      `Untitled (${r.doc_id.slice(0, 8)})`,
    page: r.page,
    lastSeen: r.updated_at,
  }));
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Format a recent-reading list as a compact prompt block the user
 * can paste into the composer. The shape is plain text — markdown
 * pollutes the textbox feel and the AI handles plain bullet lists
 * fine. Keep it self-explanatory: the AI sees the same text the
 * user does, so no special prelude needed.
 */
export function formatReadingContextPrompt(
  books: RecentBook[],
  intro: string,
): string {
  if (books.length === 0) return intro + "\n\n(no recent reading found)";
  const lines = books.map(
    (b) => `- "${b.title}" — page ${b.page} (${relativeDate(b.lastSeen)})`,
  );
  return `${intro}\n\n${lines.join("\n")}\n\n`;
}
