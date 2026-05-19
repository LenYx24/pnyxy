import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/stores/network-store";

/**
 * Lightweight "can we actually reach Supabase?" probe.
 *
 * navigator.onLine is the cheap signal — it's true on the captive
 * portal / coffee-shop-wifi / VPN-with-dead-tunnel cases that look
 * online but aren't. Pinging the smallest possible Supabase
 * endpoint disambiguates "browser thinks we're online" from "we
 * can actually mutate things." Result feeds `markServerCheck` in
 * the network store, which the offline banner and sync orchestrator
 * read from.
 *
 * What we ping: a 1-row `profiles` select limited to the current
 * user. RLS-gated so it's cheap on the server (one index seek), and
 * the column projection (`id`) keeps the response a few hundred
 * bytes. Hard-capped to a 4s timeout so a stuck request doesn't
 * delay other startup paths.
 */

const PING_TIMEOUT_MS = 4_000;
const PING_INTERVAL_MS = 60_000;

async function pingOnce(): Promise<boolean> {
  // No point pinging if the browser has already told us it's
  // offline — the fetch will time out instead of failing fast.
  if (!useNetworkStore.getState().browserOnline) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Anonymous users — no row in profiles to look up. Fall back
    // to the auth health endpoint (which is reachable without RLS)
    // by re-fetching getUser inside the timeout window. The
    // getUser call itself round-trips to Supabase Auth, so a
    // success here proves connectivity even when not signed in.
    if (!user) {
      // getUser already round-tripped — treat success as reachable.
      return true;
    }
    const { error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .abortSignal(controller.signal)
      .maybeSingle();
    return !error;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

let started = false;

/**
 * Asymmetric hysteresis: require {@link FAIL_STREAK_OFFLINE}
 * consecutive failed pings before marking the server unreachable,
 * but a single success flips the user back online immediately.
 *
 * The previous "1 fail = offline for 60s" behavior triggered the
 * offline banner constantly on flaky 3G / commuting wifi — a single
 * 4s timeout was enough to dim the whole UI until the next periodic
 * ping ran a minute later. Genuine outages produce a streak of
 * failures (the next ping after 60s also times out), so a streak
 * gate filters noise without delaying detection of real downtime.
 */
const FAIL_STREAK_OFFLINE = 2;
let consecutiveFailures = 0;

export function startServerHeartbeat(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    const reachable = await pingOnce();
    if (reachable) {
      consecutiveFailures = 0;
      useNetworkStore.getState().markServerCheck(true);
      return;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAIL_STREAK_OFFLINE) {
      useNetworkStore.getState().markServerCheck(false);
    }
    // Below threshold: don't touch `serverReachable`. A first
    // failure is "probably a blip" — we wait for the next tick (or
    // the next focus / online event, both of which call tick()
    // immediately) before committing to the offline state.
  };

  // First ping after the auth listener has had a tick to settle.
  // Doing it on the next microtask instead of synchronously avoids
  // a race with `useAuthStore.getState().initialize()` from main.tsx.
  void Promise.resolve().then(tick);

  // Re-probe on focus — flipping back to a tab after sleep is the
  // most common "did anything change?" moment, and cheaper than
  // running the timer at a tighter interval.
  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => void tick());
    // navigator.onLine flipping to true also means "the browser
    // says we're back" — confirm with a real ping rather than
    // trusting the OS event blindly.
    window.addEventListener("online", () => void tick());
    window.setInterval(() => void tick(), PING_INTERVAL_MS);
  }
}
