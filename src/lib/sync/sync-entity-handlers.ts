import { supabase } from "@/lib/supabase";
import {
  registerEntityHandler,
  PermanentSyncError,
  type SyncOp,
  type SyncContext,
} from "@/lib/sync/sync-queue";

/**
 * Entity handlers for the sync queue. Throw PermanentSyncError for failures that
 * will never resolve (RLS denied, bad row) so the entry dead-letters.
 */

// Upserts the whole row keyed by id, so a partial payload resets omitted columns.

export interface NoteSyncPayload {
  id: string;
  title?: string;
  content?: string;
  folder_id?: string | null;
  sort_order?: number;
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
  // insert and update collapse into one upsert; store mints the id up front.
  const row = {
    id: payload.id,
    user_id: ctx.userId,
    book_id: null,
    title: payload.title ?? "",
    content: payload.content ?? "",
    folder_id: payload.folder_id ?? null,
    sort_order: payload.sort_order ?? 0,
    // use client timestamp so cross-device sort order stays consistent
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

export interface FolderSyncPayload {
  id: string;
  name?: string;
  parent_id?: string | null;
  org_id?: string;
  sort_order?: number;
}

// catalog rows live in `user_library`, uploaded rows in `books`; `source` picks
// the target. insert is not queued (uploads and catalog-adds write directly).
export interface BookSyncPayload {
  id: string;
  source: "catalog" | "uploaded";
  // title is uploaded-only; catalog titles are shared community metadata
  folder_id?: string | null;
  title?: string;
  // storage key to remove before the DB row (uploaded delete)
  storage_path?: string;
}

async function handleBook(
  op: SyncOp,
  payload: BookSyncPayload,
  _ctx: SyncContext,
): Promise<void> {
  const table = payload.source === "catalog" ? "user_library" : "books";
  if (op === "delete") {
    if (payload.source === "uploaded" && payload.storage_path) {
      // not transactional with the DB delete; orphans get swept by a cleanup job
      await supabase.storage
        .from("book-files")
        .remove([payload.storage_path]);
    }
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", payload.id);
    if (error) throwClassifiedSupabaseError(error.message, error.code);
    return;
  }
  if (op === "update") {
    const patch: Record<string, unknown> = {};
    if (payload.folder_id !== undefined) patch.folder_id = payload.folder_id;
    // rename is uploaded-only; catalog titles are shared
    if (payload.title !== undefined && payload.source === "uploaded") {
      patch.title = payload.title;
    }
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabase
      .from(table)
      .update(patch)
      .eq("id", payload.id);
    if (error) throwClassifiedSupabaseError(error.message, error.code);
    return;
  }
  // insert isn't queued for books; drain any stray entry
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
      // org_id is required by the schema; without it the entry can never replay
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
  // update: partial patch
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

// PostgREST codes that won't resolve on retry; everything else is transient.
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

let registered = false;

export function registerSyncEntityHandlers(): void {
  if (registered) return;
  registered = true;
  registerEntityHandler<NoteSyncPayload>("note", handleNote);
  registerEntityHandler<FolderSyncPayload>("folder", handleFolder);
  registerEntityHandler<BookSyncPayload>("book", handleBook);
}
