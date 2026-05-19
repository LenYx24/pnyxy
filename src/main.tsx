import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import "@/lib/i18n";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useReadingSessionStore } from "@/stores/reading-session-store";
import { initLaunchedFiles } from "@/lib/launched-files";
import { startSyncOrchestrator } from "@/lib/sync/sync-orchestrator";
import { startServerHeartbeat } from "@/lib/sync/server-heartbeat";
import { registerSyncEntityHandlers } from "@/lib/sync/sync-entity-handlers";
import { loadUserCss } from "@/lib/user-css";

// Suppress one class of unhandled promise rejection that's
// recoverable but spammy: pdf.js's "Worker was terminated", which
// fires when a `<Document>` unmounts mid-load (e.g. the library
// cover-thumbnail when the user switches folders). react-pdf doesn't
// catch the post-unmount rejection and it lands here as an unhandled
// error. `preventDefault()` swallows it; everything else still
// surfaces normally.
window.addEventListener("unhandledrejection", (event) => {
  const err = event.reason;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  if (!message) return;
  if (message.includes("Worker was terminated")) {
    event.preventDefault();
  }
});

// Initialize auth listener once at startup (Zustand stores work outside React)
useAuthStore.getState().initialize();

// Register entity handlers BEFORE the orchestrator starts —
// otherwise a queued mutation drained on boot would dead-letter
// for "no handler registered."
registerSyncEntityHandlers();

// Sync orchestrator — subscribes to network + auth + queue changes
// and drains pending local mutations to Supabase whenever we're
// online and signed in. Idempotent; safe to call early because it
// gates internally on having a user id.
startSyncOrchestrator();

// Probe the Supabase API on boot + on focus + every 60s so the
// offline banner reflects real reachability, not just the OS's
// best guess of `navigator.onLine`.
startServerHeartbeat();

// Register the PWA launchQueue consumer ASAP so file handlers work
// from a cold start (the queue buffers until React mounts a listener).
initLaunchedFiles();

// Apply user-supplied CSS overrides as early as possible so the
// first React paint already reflects the user's customizations
// — otherwise there's a visible flash from default → custom.
loadUserCss();

// When the user transitions from signed-out to signed-in and the
// profile is available, pull theme/plugin preferences down from
// Supabase — once. We deliberately don't re-hydrate on every later
// profile update: auth-store's profile snapshot is updated locally
// when the user edits their display name, but its `preferences` blob
// can be stale relative to whatever the user has changed in the
// settings store since sign-in. Re-hydrating in that case clobbered
// the user's recent theme pick (and any other preference) with an old
// value. Settings store is the source of truth after the initial
// hydrate; subsequent changes are pushed up via syncPreferences.
let hydratedForUser: string | null = null;
useAuthStore.subscribe((state) => {
  const id = state.user?.id ?? null;
  if (!id) {
    hydratedForUser = null;
    return;
  }
  if (state.profile && hydratedForUser !== id) {
    hydratedForUser = id;
    useSettingsStore.getState().hydrateFromRemote(state.profile.preferences);
    // Rehydrate any reading session that was active in another tab
    // / before the last crash. Cheap query (filtered by user_id +
    // ended_at IS NULL, both indexed) so we fire-and-forget it.
    void useReadingSessionStore.getState().hydrate();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);

// Fade the boot splash out once React has painted its first frame. Two
// rAFs: the first lets React commit, the second runs after the browser
// has painted. setTimeout fallback removes the node even if the
// transitionend event is dropped (some mobile browsers do that under
// load).
const splash = document.getElementById("boot-splash");
if (splash) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add("is-hidden");
      setTimeout(() => splash.remove(), 320);
    });
  });
}
