import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { BookResumeState } from "@/types/database";

/**
 * Cross-device sync for the reader's "last position" so opening
 * the same book on phone after reading on desktop drops you exactly
 * where you left off. Both reads and writes are best-effort, a
 * network failure just means the local IndexedDB copy stays
 * authoritative for the session.
 */

export interface ResumeStatePatch {
  page: number;
  scrollOffset?: number | null;
  cfi?: string | null;
}

/** Fetch the cloud's resume state for a doc. Returns null when the
 *  user is signed out, when there's no row yet, or on any error. */
export async function fetchResumeState(
  docId: string,
): Promise<BookResumeState | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("book_resume_state")
      .select("*")
      .eq("user_id", user.id)
      .eq("doc_id", docId)
      .maybeSingle();
    if (error) {
      logError("resume-state:fetch", error);
      return null;
    }
    return (data as BookResumeState | null) ?? null;
  } catch (err) {
    logError("resume-state:fetch:exception", err);
    return null;
  }
}

/** Upsert resume state for a doc. Best-effort. */
export async function saveResumeState(
  docId: string,
  patch: ResumeStatePatch,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("book_resume_state").upsert(
      {
        user_id: user.id,
        doc_id: docId,
        page: patch.page,
        scroll_offset: patch.scrollOffset ?? null,
        cfi: patch.cfi ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,doc_id" },
    );
    if (error) logError("resume-state:save", error);
  } catch (err) {
    logError("resume-state:save:exception", err);
  }
}
