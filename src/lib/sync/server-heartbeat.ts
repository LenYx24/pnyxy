import { supabase } from "@/lib/supabase";
import { useNetworkStore } from "@/stores/network-store";

/**
 * Probe whether Supabase is actually reachable. navigator.onLine lies on
 * captive portals / dead VPN tunnels, so we hit a tiny RLS-gated profiles
 * select. Result feeds markServerCheck in the network store.
 */

const PING_TIMEOUT_MS = 4_000;
const PING_INTERVAL_MS = 60_000;

async function pingOnce(): Promise<boolean> {
  // skip the fetch if the browser already knows we're offline
  if (!useNetworkStore.getState().browserOnline) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // anonymous: no profiles row, but getUser already round-tripped so success proves reachability
    if (!user) {
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

// need FAIL_STREAK_OFFLINE consecutive failures to go offline, but one success
// flips back online instantly. streak gate stops flaky wifi from dimming the UI.
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
    // below threshold: leave serverReachable alone, a single failure is likely a blip
  };

  // microtask defer avoids racing useAuthStore.initialize() in main.tsx
  void Promise.resolve().then(tick);

  if (typeof window !== "undefined") {
    window.addEventListener("focus", () => void tick());
    // confirm the online event with a real ping instead of trusting the OS
    window.addEventListener("online", () => void tick());
    window.setInterval(() => void tick(), PING_INTERVAL_MS);
  }
}
