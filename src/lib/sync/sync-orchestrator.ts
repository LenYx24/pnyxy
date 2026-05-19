import {
  drainQueue,
  subscribeToQueueChanges,
  type SyncContext,
} from "@/lib/sync/sync-queue";
import { useNetworkStore } from "@/stores/network-store";
import { useAuthStore } from "@/stores/auth-store";
import { logError } from "@/lib/logger";

/**
 * Single-process glue between the queue, the network store, and
 * the auth store.
 *
 * Triggers a drain whenever any of these happen, but only while
 * online and signed in:
 *   1. Browser flips back to online (event-driven).
 *   2. A new mutation is enqueued (queue change bus).
 *   3. The user finishes signing in (auth subscription).
 *   4. Every {@link POLL_INTERVAL_MS} as a safety-net poll for
 *      rows whose backoff window has just elapsed.
 *
 * Concurrency: a single in-flight drain at a time, guarded by
 * `draining`. If a wake-up arrives mid-drain we set `wakeAgain`
 * and re-run after the current drain completes — newer rows queue
 * up during drain time and need a second pass to ship.
 */

const POLL_INTERVAL_MS = 30_000;

let draining = false;
let wakeAgain = false;
let started = false;

async function runDrain(ctx: SyncContext): Promise<void> {
  if (draining) {
    wakeAgain = true;
    return;
  }
  draining = true;
  try {
    await drainQueue(ctx);
  } catch (err) {
    // drainQueue is best-effort and per-row tolerant, but the
    // overall IDB read could still fail (storage quota, browser
    // killing the worker, …). Log and let the next wake-up retry.
    logError("sync-orchestrator:drain", err);
  } finally {
    draining = false;
    if (wakeAgain) {
      wakeAgain = false;
      void runDrain(ctx);
    }
  }
}

function currentContext(): SyncContext | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;
  return { userId: user.id };
}

function maybeDrain(): void {
  const online = useNetworkStore.getState().online();
  if (!online) return;
  const ctx = currentContext();
  if (!ctx) return;
  void runDrain(ctx);
}

/**
 * Idempotent startup. Called once from main.tsx after auth init.
 */
export function startSyncOrchestrator(): void {
  if (started) return;
  started = true;

  // Wake when a mutation is enqueued — first-write latency drops
  // from "next poll tick" to "next event-loop tick."
  subscribeToQueueChanges(maybeDrain);

  // Wake when the browser reports we're back online.
  useNetworkStore.subscribe((state, prev) => {
    if (state.browserOnline && !prev.browserOnline) maybeDrain();
  });

  // Wake when the user signs in. We don't drain for signed-out
  // users because every Supabase mutation would 401 anyway — RLS
  // policies require auth.uid().
  useAuthStore.subscribe((state, prev) => {
    if (state.user?.id && state.user.id !== prev.user?.id) maybeDrain();
  });

  // Safety-net poll: rows whose retryAfter just elapsed need
  // someone to notice and re-attempt them. 30s is a balance —
  // tighter than a typical transient blip, loose enough to not
  // burn battery polling.
  if (typeof window !== "undefined") {
    window.setInterval(maybeDrain, POLL_INTERVAL_MS);
  }

  // First wake on boot — clear any backlog left over from the
  // previous session before the user sees anything.
  maybeDrain();
}
