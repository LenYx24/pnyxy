import { create } from "zustand";

/**
 * Online/offline state for the whole app.
 *
 * `navigator.onLine` is the cheap signal, true when the browser
 * has any kind of connection. It's notoriously unreliable for "can
 * I actually reach Supabase?" though: a captive portal, a flaky
 * VPN, or a router with no upstream all flip onLine to true while
 * fetches still fail. The store therefore tracks two things:
 *
 *   - `browserOnline`: navigator.onLine, flips on the native
 *     online/offline events. Source of truth for "the user's
 *     network adapter has a link."
 *   - `serverReachable`: did the most recent best-effort heartbeat
 *     to Supabase succeed? null = haven't tried yet.
 *
 * The exposed `online` flag is `browserOnline && serverReachable !== false`,
 * so we err on the side of "trust the browser" until a heartbeat
 * explicitly fails, and we never block the UI on a heartbeat result.
 *
 * Consumers (sync queue, mutation UIs, offline banner) read `online`.
 */

interface NetworkState {
  browserOnline: boolean;
  serverReachable: boolean | null;
  /** Last time `markServerCheck` was called, used by the heartbeat
   *  loop to throttle pings. */
  lastCheckedAt: number;

  /** Computed: true unless the browser thinks it's offline OR the
   *  last server check explicitly failed. */
  online: () => boolean;

  setBrowserOnline: (v: boolean) => void;
  markServerCheck: (reachable: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  browserOnline:
    typeof navigator !== "undefined" ? navigator.onLine : true,
  serverReachable: null,
  lastCheckedAt: 0,

  online: () => {
    const { browserOnline, serverReachable } = get();
    return browserOnline && serverReachable !== false;
  },

  setBrowserOnline: (v) => {
    set({ browserOnline: v });
    // Coming back online, clear the stale "unreachable" flag so
    // consumers retry instead of treating the page as offline until
    // the next heartbeat happens to run.
    if (v) set({ serverReachable: null });
  },

  markServerCheck: (reachable) =>
    set({ serverReachable: reachable, lastCheckedAt: Date.now() }),
}));

// One-time module-level wiring
// Listen for the native online/offline events once. The store is a
// singleton so this only runs once per page load.
if (typeof window !== "undefined") {
  window.addEventListener("online", () =>
    useNetworkStore.getState().setBrowserOnline(true),
  );
  window.addEventListener("offline", () =>
    useNetworkStore.getState().setBrowserOnline(false),
  );
}

/** Convenience hook, strongly preferred over reading the store
 *  directly because it subscribes to the right slice. */
export function useIsOnline(): boolean {
  return useNetworkStore(
    (s) => s.browserOnline && s.serverReachable !== false,
  );
}
