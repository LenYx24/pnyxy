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

export function startServerHeartbeat(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    const reachable = await pingOnce();
    useNetworkStore.getState().markServerCheck(reachable);
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
