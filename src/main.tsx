import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import "@/lib/i18n";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";

// Initialize auth listener once at startup (Zustand stores work outside React)
useAuthStore.getState().initialize();

// When the user transitions from signed-out to signed-in (or the
// profile loads), pull theme/plugin preferences down from Supabase.
let lastUserId: string | null = useAuthStore.getState().user?.id ?? null;
useAuthStore.subscribe((state) => {
  const id = state.user?.id ?? null;
  if (id && id !== lastUserId) {
    lastUserId = id;
    // Profile may load slightly after the user appears; hydrate
    // again once it lands.
    useSettingsStore.getState().hydrateFromRemote(state.profile?.preferences);
  } else if (!id) {
    lastUserId = null;
  }
});
useAuthStore.subscribe((state, prev) => {
  if (state.profile && state.profile !== prev.profile) {
    useSettingsStore.getState().hydrateFromRemote(state.profile.preferences);
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);
