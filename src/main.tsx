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
import { isTauri } from "@/lib/tauri";
import { installGlobalErrorCapture } from "@/lib/error-report";
import { initSentry } from "@/lib/sentry";

// Error monitoring first, so it's live before any other bootstrap runs.
// No-op unless VITE_SENTRY_DSN is set; events still flow through
// reportClientError, so this only adds a Sentry mirror when configured.
initSentry();

// native app: mark <html> so the custom title bar's height offset (the
// --titlebar-h var) kicks in. No-op in the browser.
if (isTauri) document.documentElement.classList.add("tauri-app");

// pdf.js throws "Worker was terminated" when a <Document> unmounts mid-load; react-pdf leaks it here as an unhandled rejection, so swallow just that one.
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

// pilot crash/error capture (best-effort, content-free), see error-report.ts
installGlobalErrorCapture();

useAuthStore.getState().initialize();

// must register handlers before the orchestrator, or a mutation drained on boot dead-letters as "no handler registered"
registerSyncEntityHandlers();

// gates internally on user id, safe to call early
startSyncOrchestrator();

// probes reachability instead of trusting navigator.onLine
startServerHeartbeat();

// PWA launchQueue buffers until React mounts a listener, so register early
initLaunchedFiles();

// load user css before first paint to avoid a default->custom flash
loadUserCss();

// hydrate preferences from the profile once per sign-in. Don't re-run on later profile updates: settings store is the source of truth after this and the profile's preferences blob can be stale.
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
    // pick up a reading session left open in another tab or before a crash
    void useReadingSessionStore.getState().hydrate();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);

// double rAF so the fade starts after React's first paint; setTimeout removes the node in case transitionend never fires (some mobile browsers drop it)
const splash = document.getElementById("boot-splash");
if (splash) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add("is-hidden");
      setTimeout(() => splash.remove(), 320);
    });
  });
}
