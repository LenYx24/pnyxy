import { supabase } from "@/lib/supabase";
import {
  registerEntityHandler,
  PermanentSyncError,
  type SyncOp,
  type SyncContext,
} from "@/lib/sync-queue";

/**
 * Entity handlers for the sync queue.
 *
 * Each handler receives `(op, payload, ctx)` and is responsible
 * for translating the local mutation into a Supabase write. The
 * queue owns retry / backoff / dead-lettering; handlers just need
 * to throw on failure. Throw a `PermanentSyncError` for things
 * that will never succeed (RLS denied, malformed row, …) so the
 * row goes to dead letters instead of looping forever.
 *
 * Called once from main.tsx before the orchestrator starts.
 */

// ── Notes ───────────────────────────────────────────────────────
//
// Payload shape mirrors `StoredNote` from annotation-storage:
// `{ id, title, content, createdAt, updatedAt }` for insert/update,
// `{ id }` for delete. Note: book_id is intentionally null for
// every locally-created note — the existing Note UI is book-
// agnostic ("Notes are shared across books" per the i18n hint).
// If/when we add per-book notes the payload can grow a book_id.

export interface NoteSyncPayload {
  id: string;
  title?: string;
  content?: string;
  createdAt?: number;
  updatedAt?: number;
}

async function handleNote(
  op: SyncOp,
  payload: NoteSyncPayload,
  ctx: SyncContext,
): Promise<void> {
  if (op === "delete") {
    const { error } = await supabase
      .from("notes")
      .delete()
      .eq("id", payload.id)
      .eq("user_id", ctx.userId);
    if (error) throwClassifiedSupabaseError(error.message, error.code);
    return;
  }
  // Insert and update collapse into a single upsert keyed by id —
  // the local note-store created the UUID up front, so the same id
  // round-trips through every replay. Cleaner than tracking which
  // ops have happened first.
  const row = {
    id: payload.id,
    user_id: ctx.userId,
    book_id: null,
    title: payload.title ?? "",
    content: payload.content ?? "",
    // Server-side `created_at` defaults to now(); we still mirror
    // the client timestamp so cross-device sort order matches
    // what the user saw locally.
    created_at: payload.createdAt
      ? new Date(payload.createdAt).toISOString()
      : new Date().toISOString(),
    updated_at: payload.updatedAt
      ? new Date(payload.updatedAt).toISOString()
      : new Date().toISOString(),
  };
  const { error } = await supabase
    .from("notes")
    .upsert(row, { onConflict: "id" });
  if (error) throwClassifiedSupabaseError(error.message, error.code);
}

// ── Folders ─────────────────────────────────────────────────────
//
// Payload shape:
//   insert: { id, name, parent_id, org_id, sort_order }
//   update: { id, name?, parent_id? }  — partial patch
//   delete: { id }

export interface FolderSyncPayload {
  id: string;
  name?: string;
  parent_id?: string | null;
  org_id?: string;
  sort_order?: number;
}

async function handleFolder(
  op: SyncOp,
  payload: FolderSyncPayload,
  ctx: SyncContext,
): Promise<void> {
  if (op === "delete") {
    const { error } = await supabase
      .from("folders")
      .delete()
      .eq("id", payload.id)
      .eq("user_id", ctx.userId);
    if (error) throwClassifiedSupabaseError(error.message, error.code);
    return;
  }
  if (op === "insert") {
    if (!payload.org_id) {
      // org_id is required by the folders schema. If we got here
      // without one, the caller forgot to capture it — treat as
      // permanent so it doesn't loop.
      throw new PermanentSyncError(
        "Folder insert is missing org_id; cannot replay.",
      );
    }
    const row = {
      id: payload.id,
      user_id: ctx.userId,
      org_id: payload.org_id,
      name: payload.name ?? "Untitled",
      parent_id: payload.parent_id ?? null,
      sort_order: payload.sort_order ?? 0,
    };
    const { error } = await supabase
      .from("folders")
      .upsert(row, { onConflict: "id" });
    if (error) throwClassifiedSupabaseError(error.message, error.code);
    return;
  }
  // op === "update" — partial patch (rename, move-to-parent).
  const patch: Record<string, unknown> = {};
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.parent_id !== undefined) patch.parent_id = payload.parent_id;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("folders")
    .update(patch)
    .eq("id", payload.id)
    .eq("user_id", ctx.userId);
  if (error) throwClassifiedSupabaseError(error.message, error.code);
}

// ── Error classification ────────────────────────────────────────
// PostgREST surfaces structured codes for the things that won't
// resolve on retry: `42501` RLS denied, `23503` foreign-key violation,
// `23505` unique violation. Everything else is treated as transient
// (network glitch, 5xx, timeout) so the queue keeps retrying.

const PERMANENT_PG_CODES = new Set([
  "42501", // insufficient_privilege (RLS)
  "23503", // foreign_key_violation
  "23502", // not_null_violation
  "22P02", // invalid_text_representation (bad UUID, etc.)
]);

function throwClassifiedSupabaseError(
  message: string,
  code: string | undefined,
): never {
  if (code && PERMANENT_PG_CODES.has(code)) {
    throw new PermanentSyncError(`${code}: ${message}`);
  }
  throw new Error(message);
}

// ── Registration ────────────────────────────────────────────────

let registered = false;

export function registerSyncEntityHandlers(): void {
  if (registered) return;
  registered = true;
  registerEntityHandler<NoteSyncPayload>("note", handleNote);
  registerEntityHandler<FolderSyncPayload>("folder", handleFolder);
}
