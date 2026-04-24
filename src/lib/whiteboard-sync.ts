import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { WhiteboardData } from "@/types/whiteboard";

/**
 * Cross-device sync for whiteboards. IndexedDB stays the local
 * cache — this module adds Supabase as the authoritative backup.
 *
 * Writes are fire-and-forget: the in-memory + IDB update is the
 * fast path so drawing never blocks on network. Failures log
 * quietly; the next write retries.
 *
 * Reads happen on sign-in via `pullAllWhiteboards` — the store
 * merges cloud rows with local ones, cloud wins on conflict
 * (assumes server clock is trustworthy enough for this low-stakes
 * merge).
 */

export interface WhiteboardQuotaError {
  kind: "quota";
  message: string;
}

export async function pushWhiteboard(
  wb: WhiteboardData,
): Promise<WhiteboardQuotaError | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // signed-out users stay IDB-only

  const { error } = await supabase.from("user_whiteboards").upsert({
    id: wb.id,
    user_id: user.id,
    title: wb.title,
    data: wb,
  });

  if (error) {
    // Postgres raises our custom exception on quota overrun. The
    // code is P0001 and the message starts with our sentinel string.
    if (error.message?.includes("whiteboard_quota_exceeded")) {
      return { kind: "quota", message: error.message };
    }
    logError("whiteboard-sync:push", error);
  }
  return null;
}

export async function deleteWhiteboardCloud(id: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("user_whiteboards")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) logError("whiteboard-sync:delete", error);
}

export async function pullAllWhiteboards(): Promise<WhiteboardData[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("user_whiteboards")
    .select("data")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    logError("whiteboard-sync:pull", error);
    return [];
  }
  return (data ?? []).map((r) => r.data as WhiteboardData);
}
