import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { ReadingSession } from "@/types/database";

// Per-book reading session timer (DB layer). Active session has ended_at = null.
// The reading_sessions_one_active partial unique index enforces one active
// session per user, so a second start throws at the DB.

// active sessions older than this are treated as abandoned and auto-closed on next start
export const STALE_SESSION_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

export async function fetchActiveSession(): Promise<ReadingSession | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("reading_sessions")
      .select("*")
      .eq("user_id", user.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logError("reading-sessions:fetchActive", error);
      return null;
    }
    return (data as ReadingSession | null) ?? null;
  } catch (err) {
    logError("reading-sessions:fetchActive:exception", err);
    return null;
  }
}

/** Start a session for docId. Throws at the DB if one is already active. */
export async function startSession(
  docId: string,
  startPage: number | null,
): Promise<ReadingSession | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("reading_sessions")
      .insert({
        user_id: user.id,
        doc_id: docId,
        started_at: new Date().toISOString(),
        start_page: startPage,
      })
      .select("*")
      .single();
    if (error) {
      logError("reading-sessions:start", error);
      return null;
    }
    return data as ReadingSession;
  } catch (err) {
    logError("reading-sessions:start:exception", err);
    return null;
  }
}

/** Close a session. Duration computed client-side from started_at. */
export async function stopSession(
  sessionId: string,
  startedAtIso: string,
  endPage: number | null,
  endedAt: Date = new Date(),
): Promise<void> {
  try {
    const startedAt = new Date(startedAtIso).getTime();
    const durationMs = Math.max(0, endedAt.getTime() - startedAt);
    const durationSeconds = Math.floor(durationMs / 1000);
    const { error } = await supabase
      .from("reading_sessions")
      .update({
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds,
        end_page: endPage,
      })
      .eq("id", sessionId);
    if (error) logError("reading-sessions:stop", error);
  } catch (err) {
    logError("reading-sessions:stop:exception", err);
  }
}

/** Stop-on-pagehide via the REST endpoint directly (SDK is async, unusable in a pagehide handler). */
export function stopSessionBeacon(
  sessionId: string,
  startedAtIso: string,
  endPage: number | null,
): void {
  try {
    if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
    const startedAt = new Date(startedAtIso).getTime();
    const durationSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000),
    );
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
      | string
      | undefined;
    if (!supabaseUrl || !anonKey) return;
    // read the access token synchronously from the cached session; getSession() is async
    const raw = localStorage.getItem(
      `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    );
    let accessToken: string | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        accessToken = parsed?.access_token ?? null;
      } catch {
        // malformed token blob; foreground stopSession() will handle it
      }
    }
    if (!accessToken) return;
    const payload = JSON.stringify({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      end_page: endPage,
    });
    const blob = new Blob([payload], { type: "application/json" });
    // fire-and-forget keepalive fetch, not sendBeacon: sendBeacon can't send the auth header
    void fetch(
      `${supabaseUrl}/rest/v1/reading_sessions?id=eq.${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        keepalive: true,
        headers: {
          "content-type": "application/json",
          apikey: anonKey,
          authorization: `Bearer ${accessToken}`,
          prefer: "return=minimal",
        },
        body: blob,
      },
    ).catch(() => {});
  } catch (err) {
    logError("reading-sessions:stopBeacon:exception", err);
  }
}

/** Recently-closed sessions for docId, newest first (streak + pace calcs). */
export async function fetchSessionsForDoc(
  docId: string,
  limit = 60,
): Promise<ReadingSession[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("reading_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("doc_id", docId)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) {
      logError("reading-sessions:fetchForDoc", error);
      return [];
    }
    return (data as ReadingSession[]) ?? [];
  } catch (err) {
    logError("reading-sessions:fetchForDoc:exception", err);
    return [];
  }
}
