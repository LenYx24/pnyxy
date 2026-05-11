import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { ReadingSession } from "@/types/database";

/**
 * Per-book reading session timer — DB layer.
 *
 * Sessions are open-ended (ended_at = null while active). The
 * `reading_sessions_one_active` partial unique index in the
 * migration guarantees one active session per user, so starting a
 * second one while another is open will fail at the DB; the store
 * surfaces that as "switch to the existing session" rather than
 * silently overwriting.
 *
 * Stale-session safety net: any active session older than this
 * threshold is treated as abandoned (user closed the tab without
 * stopping) and auto-closed on the next start attempt.
 */
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

/**
 * Start a new session for `docId`. If there's already an active
 * session, the partial unique index will throw — the caller is
 * responsible for closing or surfacing the existing one first.
 * Returns the created row or null on failure.
 */
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

/**
 * Close an active session. Duration is computed client-side from
 * the row's `started_at` — keeps the math out of the DB and the
 * client and server agree without a trigger.
 */
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

/**
 * Best-effort sendBeacon-based stop for `pagehide`. Uses the
 * supabase-js REST endpoint directly because sendBeacon can't
 * carry custom headers from the JS client; the apikey + bearer
 * are baked into the URL/blob.
 */
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
    // Pull the current access token synchronously from the locally
    // cached session — `supabase.auth.getSession()` is async and
    // can't run inside a pagehide handler reliably.
    const raw = localStorage.getItem(
      `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    );
    let accessToken: string | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        accessToken = parsed?.access_token ?? null;
      } catch {
        // Token blob isn't where we expected — fall back to the
        // foreground stopSession() which uses the SDK.
      }
    }
    if (!accessToken) return;
    const payload = JSON.stringify({
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      end_page: endPage,
    });
    const blob = new Blob([payload], { type: "application/json" });
    // PATCH via sendBeacon — Supabase REST honors X-Client-Info,
    // apikey, and Authorization as URL params, but sendBeacon
    // only sends a Content-Type. Use the postgrest endpoint with
    // `select=*` + filters in the URL. To avoid auth issues with
    // sendBeacon dropping the bearer, we use a fire-and-forget
    // fetch with keepalive — that DOES carry headers.
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
    ).catch(() => {
      // Ignore — pagehide handlers can't surface errors anyway.
    });
  } catch (err) {
    logError("reading-sessions:stopBeacon:exception", err);
  }
}

/**
 * Fetch recently-closed sessions for `docId`, newest first. Used
 * by the streak + pace calculators on the book overview.
 */
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
