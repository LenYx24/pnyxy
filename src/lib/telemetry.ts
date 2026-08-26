/**
 * Pilot telemetry: batched, best-effort event log into the
 * `telemetry_events` table (migration 00064). Signed-in users only;
 * registration requires the consent checkbox, so a session implies
 * consent. Never send content (no message text, no document titles),
 * only event names and small structured props.
 *
 * Session length falls out of `session_start` + `heartbeat` (fires
 * every 5 minutes while the tab is visible): length ≈ last heartbeat
 * of a session id minus its start.
 */
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

const FLUSH_MS = 30_000;
const HEARTBEAT_MS = 5 * 60_000;

interface QueuedEvent {
  event: string;
  props: Record<string, unknown>;
}

const sessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

let queue: QueuedEvent[] = [];
let started = false;

/** Queue one event. No-op while signed out. `props` must stay small
 *  and content-free (ids and counts, never text). */
export function track(event: string, props: Record<string, unknown> = {}): void {
  const user = useAuthStore.getState().user;
  if (!user) return;
  queue.push({
    event,
    // client timestamp: batching delays the insert by up to FLUSH_MS
    props: { ...props, sid: sessionId, at: new Date().toISOString() },
  });
}

async function flush(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user || queue.length === 0) return;
  const batch = queue;
  queue = [];
  const rows = batch.map((e) => ({
    user_id: user.id,
    event: e.event,
    props: e.props,
  }));
  const { error } = await supabase.from("telemetry_events").insert(rows);
  // best-effort: drop on failure (e.g. migration not applied, offline),
  // telemetry must never break or retry-spam the app
  if (error && import.meta.env.DEV) {
    console.warn("telemetry flush failed:", error.message);
  }
}

/** Start the session: fires `session_start`, then heartbeats while the
 *  tab is visible and flushes the queue periodically. Call once from
 *  the app shell when a user is present; repeat calls are no-ops. */
export function startTelemetry(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  track("session_start");
  window.setInterval(() => {
    if (document.visibilityState === "visible") track("heartbeat");
  }, HEARTBEAT_MS);
  window.setInterval(() => void flush(), FLUSH_MS);
  // flush what we have when the tab goes to background / closes
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
