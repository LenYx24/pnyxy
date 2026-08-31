// Pnyxy: GDPR self-service account deletion. The signed-in caller
// permanently deletes their own account: their storage objects are
// removed first (book-files, avatars, and space-files for spaces they
// OWN), then the auth user is hard-deleted via the admin API, which
// cascades through every user-owned table back to `auth.users` (each
// table's `ON DELETE CASCADE` was verified against the migrations,
// see ../README.md for the full table-by-table list). No confirmation
// token here: the browser gates this behind a typed-confirmation
// modal before ever calling it.

import "../_shared/deno-shim.ts";
import {
  corsFor,
  handleOptions,
  json,
  jsonErrorPublic,
  sanitizeErrorForClient,
} from "../_shared/http.ts";
import { requireUser, serviceClient, type UserClient } from "../_shared/auth.ts";

// Supabase storage's `list()` returns at most this many entries per
// call; the account's own storage footprint is small (a handful of
// books/exams/an avatar), so one page per folder is always enough in
// practice, and a short listing is treated as "done" rather than
// paginated further.
const STORAGE_LIST_LIMIT = 1000;
// Batch size for `remove()` calls so one oversized request can't fail
// the whole purge outright.
const REMOVE_CHUNK_SIZE = 100;

/**
 * Recursively list every object under `prefix` in `bucket`. Storage's
 * `list()` only returns one level; a folder placeholder comes back as
 * an entry with `id: null`, a real object has a non-null id. Returns
 * full object paths (e.g. `"<uid>/<orgId>/<hash>.pdf"`).
 */
async function listAllObjects(
  admin: UserClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, {
    limit: STORAGE_LIST_LIMIT,
  });
  if (error || !data) {
    if (error) {
      console.error(`delete-account: list ${bucket}/${prefix} failed`, error);
    }
    return [];
  }
  const paths: string[] = [];
  for (const entry of data as { name: string; id: string | null }[]) {
    const entryPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      paths.push(...(await listAllObjects(admin, bucket, entryPath)));
    } else {
      paths.push(entryPath);
    }
  }
  return paths;
}

/**
 * Best-effort recursive delete of every object under `prefix` in
 * `bucket`. Never throws: a storage cleanup failure is logged
 * server-side but must not block the account deletion itself, since
 * the user asked to be erased and the auth user + DB rows going away
 * is the part that matters most.
 */
async function purgeBucketPrefix(
  admin: UserClient,
  bucket: string,
  prefix: string,
): Promise<void> {
  try {
    const paths = await listAllObjects(admin, bucket, prefix);
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK_SIZE) {
      const chunk = paths.slice(i, i + REMOVE_CHUNK_SIZE);
      const { error } = await admin.storage.from(bucket).remove(chunk);
      if (error) {
        console.error(`delete-account: remove ${bucket}/${prefix} chunk failed`, error);
      }
    }
  } catch (err) {
    console.error(`delete-account: purge ${bucket}/${prefix} failed`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }
  const corsHeaders = corsFor(req);
  const errPublic = (status: number, code: string): Response =>
    jsonErrorPublic(status, code, corsHeaders);

  if (req.method !== "POST") {
    return errPublic(405, "method_not_allowed");
  }

  // ── Auth: require a signed-in user (deletes only their own account) ──
  const auth = await requireUser(req, {
    persistSession: false,
    onError: (reason) =>
      reason === "misconfigured"
        ? errPublic(500, "server_misconfigured")
        : errPublic(401, "not_authenticated"),
  });
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const admin = serviceClient();
  if (!admin) {
    console.error(
      "delete-account: service client unavailable, missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY",
    );
    return errPublic(500, "misconfigured");
  }

  // ── 1. Storage cleanup (best-effort, and BEFORE the DB rows / auth
  // user are gone: we need `spaces.owner_id` to still exist to find
  // this user's own space-files prefixes) ───────────────────────
  // book-files/<uid>/... : uploaded books (`<uid>/<orgId>/<hash>.pdf`)
  // and exams (`<uid>/exams/<examId>.pdf`), one recursive walk covers
  // both.
  await purgeBucketPrefix(admin, "book-files", user.id);
  // avatars/<uid>/... : profile picture (`<uid>/avatar.<ext>`).
  await purgeBucketPrefix(admin, "avatars", user.id);
  // space-files/<space_id>/... for every space this user OWNS. Never
  // touches a space this user merely belongs to as a member.
  const { data: ownedSpaces, error: spacesErr } = await admin
    .from("spaces")
    .select("id")
    .eq("owner_id", user.id);
  if (spacesErr) {
    console.error("delete-account: owned-spaces lookup failed", spacesErr);
  } else {
    for (const space of (ownedSpaces ?? []) as { id: string }[]) {
      await purgeBucketPrefix(admin, "space-files", space.id);
    }
  }

  // ── 2. DB rows + the auth user itself ──────────────────────────
  // Every user-owned table cascades from `auth.users`, either
  // directly (`references auth.users on delete cascade`) or
  // transitively through `profiles.id references auth.users on
  // delete cascade` plus that table's own `user_id references
  // profiles(id) on delete cascade`. Verified table-by-table against
  // the migrations (see ../README.md), so a single hard delete of the
  // auth user removes books, book_files, folders, notes, whiteboards,
  // highlights, comments, reading_progress, quizzes and their
  // questions/attempts, chat_conversations/chat_messages,
  // chat_folders, resources, shared_answers (+ votes), spaces owned
  // by this user (and, by the schema's existing design, everything
  // nested under them), space_members, ai_usage_user,
  // telemetry_events, user_reports, vocab_entries, reading_plans,
  // book_ratings, etc. in one cascading transaction. The handful of
  // deliberate exceptions (`catalog_books.submitted_by/verified_by`,
  // `upload_attempts.user_id`, `client_errors.user_id`) are `ON
  // DELETE SET NULL` by design for provenance / anonymised records,
  // not orphan bugs, so nothing else needs an explicit delete here.
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteUserError) {
    console.error("delete-account: deleteUser failed", deleteUserError);
    return errPublic(500, sanitizeErrorForClient(deleteUserError));
  }

  return json(200, { ok: true }, corsHeaders);
});
