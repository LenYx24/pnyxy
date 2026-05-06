import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import "@/lib/i18n";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { initLaunchedFiles } from "@/lib/launched-files";

// Initialize auth listener once at startup (Zustand stores work outside React)
useAuthStore.getState().initialize();

// Register the PWA launchQueue consumer ASAP so file handlers work
// from a cold start (the queue buffers until React mounts a listener).
initLaunchedFiles();

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
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);
