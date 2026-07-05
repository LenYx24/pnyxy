import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";

/** Bumped whenever the export schema changes in a way an importer would
 *  need to handle. v1 is a flat dump of all user-owned tables. */
export const EXPORT_SCHEMA_VERSION = "pnyxy-export-v1";

/** Tables that hold user-owned rows. Forum/community content, the shared
 *  catalog, and admin tables are excluded, they are either public or not
 *  meaningful to dump per-user.
 *
 *  Some rows here are reachable via RLS without an explicit `user_id` filter
 *  (e.g. `comments` is gated by ownership of the parent book). For those
 *  tables we leave the filter off and trust RLS, Postgres will return only
 *  what this user can see, which is what an export should contain. */
type SectionSpec = {
  key: string;
  table: string;
  /** When set, adds an `eq("user_id", uid)` filter. False means RLS already
   *  scopes the rows to the caller. */
  userScoped: boolean;
  /** Some tables use a different column name for ownership. */
  userColumn?: string;
};

const SECTIONS: SectionSpec[] = [
  { key: "profile", table: "profiles", userScoped: true, userColumn: "id" },
  { key: "uploadedBooks", table: "books", userScoped: true },
  { key: "bookFiles", table: "book_files", userScoped: false },
  { key: "folders", table: "folders", userScoped: true },
  { key: "folderItems", table: "folder_items", userScoped: false },
  { key: "userLibrary", table: "user_library", userScoped: true },
  { key: "statusTags", table: "user_book_tags", userScoped: true },
  { key: "customTags", table: "user_book_custom_tags", userScoped: true },
  { key: "highlights", table: "highlights", userScoped: true },
  { key: "comments", table: "comments", userScoped: true },
  { key: "notes", table: "notes", userScoped: true },
  { key: "whiteboards", table: "whiteboards", userScoped: true },
  { key: "userWhiteboards", table: "user_whiteboards", userScoped: true },
  { key: "readingProgress", table: "reading_progress", userScoped: true },
  { key: "readingStats", table: "reading_stats", userScoped: true },
  { key: "bookResumeState", table: "book_resume_state", userScoped: true },
  { key: "vocabulary", table: "vocab_entries", userScoped: true },
  { key: "quizzes", table: "quizzes", userScoped: false },
  { key: "quizQuestions", table: "quiz_questions", userScoped: false },
  { key: "quizAttempts", table: "quiz_attempts", userScoped: true },
  { key: "quizAttemptAnswers", table: "quiz_attempt_answers", userScoped: false },
  { key: "quizReviews", table: "quiz_reviews", userScoped: true },
  { key: "readingPlans", table: "reading_plans", userScoped: true },
  { key: "readingPlanItems", table: "reading_plan_items", userScoped: false },
  // chat_folders was unified into the library `folders` table in
  // migration 00036; chat conversations now point at folder rows
  // exported alongside the library books, so no separate export
  // entry is needed.
  { key: "chatConversations", table: "chat_conversations", userScoped: true },
  { key: "chatMessages", table: "chat_messages", userScoped: false },
  { key: "bookRatings", table: "book_ratings", userScoped: true },
  { key: "aiUsage", table: "ai_usage_user", userScoped: true },
];

interface ExportPayload {
  schema: string;
  exportedAt: string;
  user: { id: string; email: string | null };
  /** Per-section row counts so the user can sanity-check at a glance. */
  counts: Record<string, number>;
  /** Non-fatal fetch errors; the export still completes if any section
   *  fails (the affected key is set to []). */
  errors: { key: string; message: string }[];
  data: Record<string, unknown[] | unknown | null>;
}

/**
 * Pull every user-owned row from Supabase, bundle into one JSON file, and
 * trigger a browser download. Forum posts, organisations, and the shared
 * catalog are intentionally excluded, they're either public or not yours
 * to export. Uploaded files themselves aren't bundled (they can be many
 * GB); only their metadata + storage URLs land in the JSON.
 */
export async function exportUserData(): Promise<{
  filename: string;
  payload: ExportPayload;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const errors: ExportPayload["errors"] = [];

  const results = await Promise.all(
    SECTIONS.map(async (section) => {
      try {
        const column = section.userColumn ?? "user_id";
        let q = supabase.from(section.table).select("*");
        if (section.userScoped) {
          q = q.eq(column, user.id);
        }
        const { data, error } = await q;
        if (error) {
          logError(`export:${section.key}`, error.message);
          errors.push({ key: section.key, message: error.message });
          return [section.key, null] as const;
        }
        return [section.key, data ?? []] as const;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logError(`export:${section.key}`, message);
        errors.push({ key: section.key, message });
        return [section.key, null] as const;
      }
    }),
  );

  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  for (const [key, value] of results) {
    if (key === "profile") {
      // Single-row table, surface as object instead of an array of one.
      const arr = Array.isArray(value) ? value : null;
      data[key] = arr && arr.length > 0 ? arr[0] : null;
      counts[key] = arr ? arr.length : 0;
    } else {
      const arr = Array.isArray(value) ? value : [];
      data[key] = arr;
      counts[key] = arr.length;
    }
  }

  const payload: ExportPayload = {
    schema: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email ?? null },
    counts,
    errors,
    data,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `pnyxy-export-${stamp}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { filename, payload };
}
